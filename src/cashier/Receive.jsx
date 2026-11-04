import { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, useToast, WalletField } from '../ui.jsx';
import { MAIN_REG, WALLETS, machineGroupsOf, machinePhotoLabel, walletModeOf, walletModesOf, billsTotal, emptyBills, fmt, lastOf, num, openKey, pickImage, regName, timeStr, todayKey } from '../lib';
import { Bills, MachineRows, SideBox } from './parts.jsx';

export default function Receive({ shop, reg = MAIN_REG, profile, onStarted, editShift, onCancel }) {
  const toast = useToast();
  const last = lastOf(shop, reg);
  const isSub = reg !== MAIN_REG;
  const machines = shop.machines || [];

  const prevBills = useMemo(() => (last && last.keepDrawer !== 'shop' ? { ...emptyBills(), ...last.bills } : emptyBills()), [last]);
  const prevSide = last && last.keepSide !== 'shop' ? num(last.side) : 0;
  const prevMachines = machines.map((m) => {
    const f = (last?.machines || []).find((x) => x.machine === m.machine && x.account === m.account);
    return f ? String(f.value ?? '') : '';
  });

  const er = editShift?.receive;
  const [bills, setBills] = useState(er ? { ...emptyBills(), ...er.bills } : prevBills);
  const [side, setSide] = useState(String(er ? num(er.side) : prevSide));
  const [mvals, setMvals] = useState(er ? machines.map((m) => { const f = (er.machines || []).find((x) => x.machine === m.machine && x.account === m.account); return f ? String(f.value ?? '') : ''; }) : machines.map(() => ''));
  const [photos, setPhotos] = useState({});
  const [wphotos, setWphotos] = useState({});
  const [busy, setBusy] = useState(false);

  const changed = Object.keys(bills).filter((f) => num(bills[f]) !== num(prevBills[f])).length;
  const sideChanged = num(side) !== prevSide;
  const walletKeys = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key) && walletModeOf(shop, w.key) === 'shop');
  const prevWallets = Object.fromEntries(walletKeys.map((w) => [w.key, num(last?.walletsTyped?.[w.key] ?? last?.wallets?.[w.key])]));
  const [wallets, setWallets] = useState(() => Object.fromEntries(walletKeys.map((w) => [w.key, er ? String(num(er.wallets?.[w.key])) : ''])));
  const wChanged = walletKeys.filter((w) => String(wallets[w.key] ?? '').trim() !== '' && num(wallets[w.key]) !== prevWallets[w.key]).length;
  const walletsOut = () => Object.fromEntries(walletKeys.map((w) => [w.key, num(wallets[w.key])]));
  const mChanged = mvals.filter((v, i) => String(v).trim() !== '' && num(v) !== num(prevMachines[i])).length;
  // New receive: every wallet and machine number typed by hand, each with its photo.
  const missing = editShift ? [] : [
    ...walletKeys.filter((w) => String(wallets[w.key] ?? '').trim() === '').map((w) => `اكتب رصيد ${w.label}`),
    ...walletKeys.filter((w) => !wphotos[w.key]).map((w) => `صوّر ${w.label}`),
    ...machines.map((m, i) => (String(mvals[i] ?? '').trim() === '' ? `اكتب رصيد ${m.machine} · ${m.account}` : null)).filter(Boolean),
    ...machineGroupsOf(machines).filter((g) => !photos[g.items[0]]).map((g) => `صوّر ${g.name}`),
  ];

  const addWalletPhoto = async (k) => {
    const data = await pickImage(1000, 0.65);
    if (data) { setWphotos((p) => ({ ...p, [k]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };
  const walletPhotoDocs = (pb, shiftId) => Object.entries(wphotos).forEach(([k, data]) => {
    const w = walletKeys.find((x) => x.key === k);
    pb.set(doc(collection(db, 'shifts', shiftId, 'photos')), { kind: 'wallet', stage: 'receive', wallet: k, label: w?.label || k, amount: num(wallets[k]), data, check: 'pending', createdAt: serverTimestamp() });
  });
  const addPhoto = async (i) => {
    const data = await pickImage(1000, 0.65);
    if (data) { setPhotos((p) => ({ ...p, [i]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const receive = {
        ...er,
        bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, num(v)])),
        drawerTotal: billsTotal(bills), side: num(side),
        machines: machines.map((m, i) => ({ ...m, value: num(mvals[i]), photo: !!photos[i] || !!(er.machines || [])[i]?.photo })),
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
      toast('الاستلام اتعدّل · المحاسب هيشوف التعديل');
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
        machines: machines.map((m, i) => ({ ...m, value: num(mvals[i]), photo: !!photos[i] })),
        prevShiftId: last?.shiftId || null,
        prevCashier: last?.cashierName || null,
        prevDrawerTotal: billsTotal(prevBills),
        prevSide,
        wallets: walletsOut(), prevWallets, walletModes: walletModesOf(shop),
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
      if (!navigator.onLine) toast('اتحفظ على الجهاز وهيترفع لما النت يرجع');
      else { await p; toast('اتأكد الاستلام · الوردية بدأت'); }
      onStarted();
    } catch (e) {
      console.error(e);
      toast('حصلت مشكلة، جرّب تاني', 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <div className="stack" style={{ gap: 4 }}>
        <div className="spread"><h1 className="title">{editShift ? 'تعديل الاستلام' : 'استلم الوردية'}{isSub ? ` · ${regName(shop, reg)}` : ''}</h1>{onCancel && <button type="button" className="btn soft sm" onClick={onCancel}>{editShift ? 'رجوع للعمليات' : 'اختار درج تاني'}</button>}</div>
        <span className="sub">
          {last ? <>الأرقام دي من تسليم {last.cashierName} الساعة {timeStr(last.at)}. لو تمام دوس «تمام، استلمت»، ولو في فرق عدّله وهيتسجل.</> : isSub ? 'اكتب اللي في درجك دلوقتي قبل فكة الأساسي (غالبًا صفر). الفكة اللي الأساسي هيديهالك هتظهرلك بعد ما تستلم وتأكدها.' : 'دي أول وردية في المحل. عدّ الدرج واكتب الأرقام.'}
        </span>
      </div>
      <section className="card tint-orange" style={{ gap: 12 }}>
        <div className="spread">
          <h2 className="h2"><span className="dot" style={{ background: 'var(--orange)' }} />درج الكاشير</h2>
          <span className="big-num">{fmt(billsTotal(bills))}<small> ج</small></span>
        </div>
        <Bills bills={bills} setBills={setBills} orig={last ? prevBills : null} noSteppers />
      </section>
      {!shop.noSide && <SideBox value={side} setValue={setSide} hint={sideChanged && last ? `اتعدّل · كان ${fmt(prevSide)} ج` : 'المبلغ كله · من غير فئات'} />}
      {(walletKeys.length > 0 || machines.length > 0) && (
        <section className="card" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="h2"><span className="dot" style={{ background: 'var(--violet)' }} />المحافظ والمكن</h2>
            <span className="tiny muted">اكتب رصيد كل واحدة بإيدك وصوّر شاشتها. المحاسب هيراجع الصور.</span>
          </div>
          <div className="assets-grid" style={{ '--cols': Math.max(1, Math.min(4, walletKeys.length + machineGroupsOf(machines).length)) }}>
            {walletKeys.map((w) => (
              <WalletField key={w.key} k={w.key} label={w.label} value={wallets[w.key]} onChange={(v) => setWallets({ ...wallets, [w.key]: v })}
                hint={last ? `${last.cashierName} سلّم ${fmt(prevWallets[w.key])}` : 'الرصيد اللي في المحفظة دلوقتي'} warn={last && String(wallets[w.key] ?? '').trim() !== '' && num(wallets[w.key]) !== prevWallets[w.key] ? `مختلف عن اللي اتسلّم (${fmt(prevWallets[w.key])})` : null}
                onPhoto={() => addWalletPhoto(w.key)} photo={wphotos[w.key]} />
            ))}
            <MachineRows inline machines={machines} values={mvals} setValues={setMvals} photos={photos} onPhoto={addPhoto} prev={last ? prevMachines : null} prevName={last?.cashierName} />
          </div>
        </section>
      )}
      <div className="recv-done">
        {missing.length > 0 && (
          <span className="badge warn" style={{ whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.7, padding: '8px 14px' }}>
            فاضل: {missing.slice(0, 4).join(' · ')}{missing.length > 4 ? ` و${missing.length - 4} كمان` : ''}
          </span>
        )}
        <button type="button" className="btn full" style={{ height: 66, fontSize: 20 }} onClick={confirm} disabled={busy || missing.length > 0}>
          <span className="ic"><Icon d="check" size={18} stroke={3} /></span>{busy ? 'لحظة…' : editShift ? 'حفظ التعديل' : 'تمام، استلمت'}
        </button>
        <span className="small muted" style={{ textAlign: 'center' }}>
          {changed || sideChanged || mChanged || wChanged ? `عدّلت ${changed + (sideChanged ? 1 : 0) + mChanged + wChanged} رقم · هيتسجل فرق في الاستلام ويوصل للمحاسب` : last ? `كل الأرقام زي ما ${last.cashierName} سلّمها` : ''}
        </span>
      </div>
    </div>
  );
}
