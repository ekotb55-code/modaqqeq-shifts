import { useTour } from '../Tour.jsx';
import { CASHIER_RECEIVE } from '../tours.js';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, useToast, WalletField, clearDraft, useDraft } from '../ui.jsx';
import { captureDocument } from '../DocCamera.jsx';
import { clearRemoteDraft, isDesktop, saveRemoteDraft, useRemoteDraft } from '../remoteDraft';
import { MAIN_REG, WALLETS, vaultsOf, colsFor, machineGroupsOf, machinePhotoLabel, walletModeOf, walletModesOf, billsTotal, emptyBills, fmt, lastOf, num, openKey, regName, timeStr, todayKey } from '../lib';
import { Bills, MachineRows, SideBox } from './parts.jsx';
import { logAct } from '../activity.js';

export default function Receive({ shop, reg = MAIN_REG, profile, onStarted, editShift, onCancel }) {
  useTour('c-receive', CASHIER_RECEIVE, { uid: profile.id, enabled: !editShift });
  const toast = useToast();
  const last = lastOf(shop, reg);
  const isSub = reg !== MAIN_REG;
  const machines = shop.machines || [];
  // Machines that always start a shift at 0 (e.g. Geidea) are not shown here: no balance, no photo.
  // They are saved with 0 and only appear at handover.
  const vis = machines.map((m, i) => i).filter((i) => !machines[i].startZero);
  const vMachines = vis.map((i) => machines[i]);

  const prevBills = useMemo(() => (last && last.keepDrawer !== 'shop' ? { ...emptyBills(), ...last.bills } : emptyBills()), [last]);
  const prevSide = last && last.keepSide !== 'shop' ? num(last.side) : 0;
  const prevMachines = machines.map((m) => {
    if (m.startZero) return '';
    const f = (last?.machines || []).find((x) => x.machine === m.machine && x.account === m.account);
    return f ? String(f.value ?? '') : '';
  });

  const er = editShift?.receive;
  const dkey = `mdq-draft-recv-${shop.id}-${reg}-${profile.id}-${editShift ? editShift.id : last?.shiftId || 'first'}`;
  const [bills, setBills] = useDraft(dkey, 'bills', er ? { ...emptyBills(), ...er.bills } : prevBills);
  const [side, setSide] = useDraft(dkey, 'side', String(er ? num(er.side) : prevSide));
  const [mvals, setMvals] = useDraft(dkey, 'mvals', er ? machines.map((m) => { const f = (er.machines || []).find((x) => x.machine === m.machine && x.account === m.account); return f ? String(f.value ?? '') : ''; }) : machines.map(() => ''));
  const [photos, setPhotos] = useDraft(dkey, 'photos', {});
  const [wphotos, setWphotos] = useDraft(dkey, 'wphotos', {});
  const [busy, setBusy] = useState(false);

  // Edit mode: load the receive photos that were already saved with this shift,
  // so they show up in the boxes. They are kept apart from the newly taken photos
  // so saving the edit doesn't upload them a second time.
  const [oldM, setOldM] = useState({});
  const [oldW, setOldW] = useState({});
  useEffect(() => {
    if (!editShift) return undefined;
    return onSnapshot(collection(db, 'shifts', editShift.id, 'photos'), (q) => {
      const list = q.docs.map((d) => d.data())
        .filter((p) => p.stage === 'receive' && p.data)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      const m = {};
      const w = {};
      list.forEach((p) => {
        if (p.kind === 'wallet') { w[p.wallet] = p.data; return; }
        if (p.kind !== 'machine') return;
        for (let i = 0; i < machines.length; i += 1) {
          if (machinePhotoLabel(machines, i) === p.label) { m[i] = p.data; break; }
        }
      });
      setOldM(m);
      setOldW(w);
    }, (e) => console.warn('receive photos', e.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editShift?.id]);
  const shownPhotos = { ...oldM, ...photos };
  const shownWPhotos = { ...oldW, ...wphotos };

  const changed = Object.keys(bills).filter((f) => num(bills[f]) !== num(prevBills[f])).length;
  const sideChanged = num(side) !== prevSide;
  const walletKeys = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key) && walletModeOf(shop, w.key) === 'shop');
  const prevWallets = Object.fromEntries(walletKeys.map((w) => [w.key, num(last?.walletsTyped?.[w.key] ?? last?.wallets?.[w.key])]));
  const [wallets, setWallets] = useDraft(dkey, 'wallets', () => Object.fromEntries(walletKeys.map((w) => [w.key, er ? String(num(er.wallets?.[w.key])) : ''])));
  const wChanged = walletKeys.filter((w) => String(wallets[w.key] ?? '').trim() !== '' && num(wallets[w.key]) !== prevWallets[w.key]).length;
  const walletsOut = () => Object.fromEntries(walletKeys.map((w) => [w.key, num(wallets[w.key])]));
  const mChanged = mvals.filter((v, i) => vis.includes(i) && String(v).trim() !== '' && num(v) !== num(prevMachines[i])).length;
  // New receive: every wallet and machine number typed by hand, each with its photo.
  const missingNums = editShift ? [] : [
    ...walletKeys.filter((w) => String(wallets[w.key] ?? '').trim() === '').map((w) => `اكتب رصيد ${w.label}`),
    ...vis.map((i) => (String(mvals[i] ?? '').trim() === '' ? `اكتب رصيد ${machines[i].machine} · ${machines[i].account}` : null)).filter(Boolean),
  ];
  const missingPhotos = editShift ? [] : [
    ...walletKeys.filter((w) => !wphotos[w.key]).map((w) => `صوّر ${w.label}`),
    ...machineGroupsOf(machines).filter((g) => !machines[g.items[0]].startZero && !photos[g.items[0]]).map((g) => `صوّر ${g.name}`),
  ];
  const missing = [...missingNums, ...missingPhotos];
  const shownCards = walletKeys.length + machineGroupsOf(machines).filter((g) => !machines[g.items[0]].startZero).length;
  const [sentToPhone, setSentToPhone] = useState(false);
  const remote = useRemoteDraft(editShift ? null : profile.id, dkey, (v, ph) => {
    if (v.bills) setBills(v.bills);
    if (v.side !== undefined) setSide(v.side);
    if (v.mvals) setMvals(v.mvals);
    if (v.wallets) setWallets(v.wallets);
    if (ph.photos) setPhotos((p) => ({ ...ph.photos, ...p }));
    if (ph.wphotos) setWphotos((p) => ({ ...ph.wphotos, ...p }));
    toast('الأرقام اللي اتكتبت على الكمبيوتر وصلت هنا · صوّر وكمّل');
  });
  const sendToPhone = async () => {
    try {
      await saveRemoteDraft(profile.id, dkey, { bills, side, mvals, wallets }, { photos, wphotos });
      logAct('to_phone', 'حفظ أرقام الاستلام من الكمبيوتر علشان يكمّل الصور من الموبايل', { shopId: shop.id });
      setSentToPhone(true);
    } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); }
  };

  const addWalletPhoto = async (k) => {
    const data = await captureDocument({ maxSide: 1100, quality: 0.7, kind: 'phone', title: `صوّر شاشة ${walletKeys.find((x) => x.key === k)?.label || 'المحفظة'}` });
    if (data) { setWphotos((p) => ({ ...p, [k]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };
  const walletPhotoDocs = (pb, shiftId) => Object.entries(wphotos).forEach(([k, data]) => {
    const w = walletKeys.find((x) => x.key === k);
    pb.set(doc(collection(db, 'shifts', shiftId, 'photos')), { kind: 'wallet', stage: 'receive', wallet: k, label: w?.label || k, amount: num(wallets[k]), data, check: 'pending', createdAt: serverTimestamp() });
  });
  const addPhoto = async (i) => {
    const data = await captureDocument({ maxSide: 1100, quality: 0.7, kind: 'machine', title: 'صوّر شاشة المكنة' });
    if (data) { setPhotos((p) => ({ ...p, [i]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };

  // Hidden (start-at-zero) machines are always saved with 0.
  const machineValue = (m, i) => (m.startZero ? 0 : num(mvals[i]));

  const saveEdit = async () => {
    setBusy(true);
    try {
      const receive = {
        ...er,
        bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, num(v)])),
        drawerTotal: billsTotal(bills), side: num(side),
        machines: machines.map((m, i) => ({ ...m, value: machineValue(m, i), photo: !!photos[i] || !!oldM[i] || !!(er.machines || [])[i]?.photo })),
        wallets: walletsOut(), walletModes: er.walletModes || walletModesOf(shop),
        diffFromPrev: er.diffFromPrev || changed > 0 || sideChanged || mChanged > 0 || wChanged > 0,
        editedAtLocal: new Date().toISOString(),
      };
      const p = updateDoc(doc(db, 'shifts', editShift.id), { receive, receiveEdits: (editShift.receiveEdits || 0) + 1 });
      p.then(() => Promise.all([...Object.entries(photos).map(([i, data]) => {
        const pb = writeBatch(db);
        pb.set(doc(collection(db, 'shifts', editShift.id, 'photos')), { kind: 'machine', stage: 'receive', label: machinePhotoLabel(machines, i), data, check: 'pending', createdAt: serverTimestamp() });
        return pb.commit();
      }), (() => { const pb = writeBatch(db); walletPhotoDocs(pb, editShift.id); return pb.commit(); })()])).catch(() => {});
      if (navigator.onLine) await p; else p.catch(() => {});
      logAct('receive_edit', `عدّل أرقام الاستلام · الدرج ${fmt(billsTotal(bills))} ج`, { shopId: shop.id, shiftId: editShift.id });
      toast('الاستلام اتعدّل · المحاسب هيشوف التعديل');
      clearDraft(dkey);
      clearRemoteDraft(profile.id, dkey);
      onStarted();
    } catch (e) { console.error(e); toast('حصلت مشكلة، جرّب تاني', 'err'); }
    setBusy(false);
  };

  const confirm = async () => {
    if (editShift) { saveEdit(); return; }
    if (missing.length) { toast(missing[0], 'err'); return; }
    setBusy(true);
    try {
      const shiftRef = doc(collection(db, 'shifts'));
      const now = new Date();
      const receive = {
        bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, num(v)])),
        drawerTotal: billsTotal(bills),
        side: num(side),
        machines: machines.map((m, i) => ({ ...m, value: machineValue(m, i), photo: !!photos[i] })),
        prevShiftId: last?.shiftId || null,
        prevCashier: last?.cashierName || null,
        prevDrawerTotal: billsTotal(prevBills),
        prevSide,
        wallets: walletsOut(), prevWallets, walletModes: walletModesOf(shop),
        // رصيد كل خزنة رئيسية وقت بداية الوردية (بيتراكم من الورديات اللي قبلها)
        vaults: Object.fromEntries(vaultsOf(shop).map((v) => [v.id, num(shop.vaultBalances?.[v.id])])),
        diffFromPrev: changed > 0 || sideChanged || mChanged > 0 || wChanged > 0,
      };
      const b = writeBatch(db);
      b.set(shiftRef, {
        shopId: shop.id, cashierUid: profile.id, cashierName: profile.name, status: 'open',
        register: reg, registerName: regName(shop, reg), registerKind: shop.register?.kind || 'main',
        day: todayKey(now), month: todayKey(now).slice(0, 7), openedAt: serverTimestamp(), openedAtLocal: now.toISOString(), receive,
      });
      b.update(doc(db, 'shops', shop.id), { [openKey(reg)]: { id: shiftRef.id, cashierUid: profile.id, cashierName: profile.name, openedAt: now.toISOString() } });
      const p = b.commit();
      // Photos go after the shift so the security rules can see who owns it.
      p.then(() => Promise.all([...Object.entries(photos).map(([i, data]) => {
        const pb = writeBatch(db);
        pb.set(doc(collection(db, 'shifts', shiftRef.id, 'photos')), { kind: 'machine', stage: 'receive', label: machinePhotoLabel(machines, i), data, check: 'pending', createdAt: serverTimestamp() });
        return pb.commit();
      }), (() => { const pb = writeBatch(db); walletPhotoDocs(pb, shiftRef.id); return pb.commit(); })()])).catch(() => {});
      logAct('receive', `استلم الوردية${last ? ` من ${last.cashierName}` : ''} · الدرج ${fmt(billsTotal(bills))} ج${changed || sideChanged || mChanged || wChanged ? ' · عدّل في الأرقام' : ''}`, { shopId: shop.id, shiftId: shiftRef.id });
      if (!navigator.onLine) toast('اتحفظ على الجهاز وهيترفع لما النت يرجع');
      else { await p; toast('اتأكد الاستلام · الوردية بدأت'); }
      clearDraft(dkey);
      clearRemoteDraft(profile.id, dkey);
      onStarted();
    } catch (e) {
      console.error(e);
      toast('حصلت مشكلة، جرّب تاني', 'err');
    } finally { setBusy(false); }
  };

  // MachineRows only sees the visible machines; map its indexes back to the full list.
  const setVisValues = (arr) => setMvals((old) => {
    const next = [...old];
    const a = typeof arr === 'function' ? arr(vis.map((i) => old[i])) : arr;
    vis.forEach((i, j) => { next[i] = a[j]; });
    return next;
  });

  return (
    <div className="wrap">
      <div className="stack" style={{ gap: 4 }}>
        <div className="spread"><h1 className="title">{editShift ? 'تعديل الاستلام' : 'استلم الوردية'}{isSub ? ` · ${regName(shop, reg)}` : ''}</h1>{onCancel && <button type="button" className="btn soft sm" onClick={onCancel}>{editShift ? 'رجوع للعمليات' : 'اختار درج تاني'}</button>}</div>
        <span className="sub">
          {last ? <>الأرقام دي من تسليم {last.cashierName} الساعة {timeStr(last.at)}. لو تمام دوس «تمام، استلمت»، ولو في فرق عدّله وهيتسجل.</> : isSub ? 'اكتب اللي في درجك دلوقتي قبل فكة الأساسي (غالبًا صفر). الفكة اللي الأساسي هيديهالك هتظهرلك بعد ما تستلم وتأكدها.' : 'دي أول وردية في المحل. عدّ الدرج واكتب الأرقام.'}
        </span>
      </div>
      <section className="card tint-orange" style={{ gap: 12 }} data-tour="bills">
        <div className="spread">
          <h2 className="h2"><span className="dot" style={{ background: 'var(--orange)' }} />درج الكاشير</h2>
          <span className="big-num">{fmt(billsTotal(bills))}<small> ج</small></span>
        </div>
        <Bills bills={bills} setBills={setBills} orig={last ? prevBills : null} noSteppers />
      </section>
      {!shop.noSide && <SideBox value={side} setValue={setSide} hint={sideChanged && last ? `اتعدّل · كان ${fmt(prevSide)} ج` : 'المبلغ كله · من غير فئات'} />}
      {(walletKeys.length > 0 || vMachines.length > 0) && (
        <section className="card" style={{ gap: 12 }} data-tour="assets">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="h2"><span className="dot" style={{ background: 'var(--violet)' }} />المحافظ والمكن</h2>
            <span className="tiny muted">اكتب رصيد كل واحدة بإيدك وصوّر شاشتها. المحاسب هيراجع الصور.</span>
          </div>
          <div className="assets-grid" style={{ '--cols': colsFor(shownCards) }}>
            {walletKeys.map((w) => (
              <WalletField key={w.key} k={w.key} label={w.label} value={wallets[w.key]} onChange={(v) => setWallets({ ...wallets, [w.key]: v })}
                hint={last ? `${last.cashierName} سلّم ${fmt(prevWallets[w.key])}` : 'الرصيد اللي في المحفظة دلوقتي'} warn={last && String(wallets[w.key] ?? '').trim() !== '' && num(wallets[w.key]) !== prevWallets[w.key] ? `مختلف عن اللي اتسلّم (${fmt(prevWallets[w.key])})` : null}
                onPhoto={() => addWalletPhoto(w.key)} photo={shownWPhotos[w.key]} />
            ))}
            <MachineRows inline machines={vMachines} values={vis.map((i) => mvals[i])} setValues={setVisValues}
              photos={Object.fromEntries(vis.map((i, j) => [j, shownPhotos[i]]))} onPhoto={(j) => addPhoto(vis[j])}
              prev={last ? vis.map((i) => prevMachines[i]) : null} prevName={last?.cashierName} />
          </div>
        </section>
      )}
      <div className="recv-done">
        {remote && remote.device && !sentToPhone && missingPhotos.length > 0 && !isDesktop() && <span className="badge info" style={{ whiteSpace: 'normal', textAlign: 'center' }}>📲 الأرقام جت من الكمبيوتر · فاضل الصور بس</span>}
        {isDesktop() && missingNums.length === 0 && missingPhotos.length > 0 && (
          sentToPhone ? (
            <div className="phone-hand">
              <span className="ph-ic">📲</span>
              <span className="stack" style={{ gap: 2 }}>
                <strong>اتحفظ · كمّل من الموبايل</strong>
                <span className="small">افتح التطبيق على الموبايل بنفس الحساب، هتلاقي الأرقام متكتبة. صوّر الشاشات ودوس «تمام، استلمت» من هناك.</span>
              </span>
            </div>
          ) : (
            <button type="button" className="btn soft full" style={{ maxWidth: 520 }} onClick={sendToPhone} data-tour="to-phone">📲 احفظ وكمّل الصور من الموبايل</button>
          )
        )}
        {missing.length > 0 && (
          <span className="badge warn" style={{ whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.7, padding: '8px 14px' }}>
            فاضل: {missing.slice(0, 4).join(' · ')}{missing.length > 4 ? ` و${missing.length - 4} كمان` : ''}
          </span>
        )}
        <button type="button" className="btn full" style={{ height: 66, fontSize: 20 }} data-tour="done" onClick={confirm} disabled={busy || missing.length > 0}>
          <span className="ic"><Icon d="check" size={18} stroke={3} /></span>{busy ? 'لحظة…' : editShift ? 'حفظ التعديل' : 'تمام، استلمت'}
        </button>
        <span className="small muted" style={{ textAlign: 'center' }}>
          {changed || sideChanged || mChanged || wChanged ? `عدّلت ${changed + (sideChanged ? 1 : 0) + mChanged + wChanged} رقم · هيتسجل فرق في الاستلام ويوصل للمحاسب` : last ? `كل الأرقام زي ما ${last.cashierName} سلّمها` : ''}
        </span>
      </div>
    </div>
  );
}
