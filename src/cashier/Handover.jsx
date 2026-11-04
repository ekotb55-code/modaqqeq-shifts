import { useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, useToast, WalletField, WalletMark } from '../ui.jsx';
import { MAIN_REG, WALLETS, machineGroupsOf, machinePhotoLabel, walletModeOf, walletModesOf, billsTotal, computeShift, durationStr, emptyBills, fmt, lastKey, num, openKey, pickImage, timeStr } from '../lib';
import { newTransfer } from './Transfers.jsx';
import { Bills, MachineRows, SideBox } from './parts.jsx';

const WHERE = { stay: 'يفضل في الدرج', shop: 'يتسلّم للمحل', main: 'يتسلّم للأساسي' };
function Split({ title, mark, color, amount, value, set, options = ['stay', 'shop'] }) {
  return (
    <div className="spread" style={{ background: 'rgba(255,255,255,.8)', borderRadius: 24, padding: '14px 16px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 46, height: 46, borderRadius: 16, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{mark}</span>
        <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span><span style={{ fontSize: 22, fontWeight: 800 }}>{fmt(amount)} ج</span></span>
      </span>
      <span style={{ display: 'flex', gap: 6, background: '#fff', borderRadius: 999, padding: 5 }}>
        {options.map((o) => <button key={o} type="button" className={'chip' + (value === o ? ' on' : '')} onClick={() => set(o)}>{WHERE[o]}</button>)}
      </span>
    </div>
  );
}

export default function Handover({ shop, shift, entries, incoming = [], profile, onBack, onDone }) {
  const toast = useToast();
  const reg = shift.register || MAIN_REG;
  const isSub = reg !== MAIN_REG;
  const noSide = !!shop.noSide;
  const machines = shop.machines || [];
  const [bills, setBills] = useState(emptyBills());
  const [side, setSide] = useState(noSide ? '0' : '');
  const [mvals, setMvals] = useState(machines.map(() => ''));
  const [photos, setPhotos] = useState({});
  const [keepDrawer, setKeepDrawer] = useState(isSub ? 'main' : 'stay');
  const [keepSide, setKeepSide] = useState('stay');
  const opts = isSub ? ['main', 'stay'] : ['stay', 'shop'];
  const [busy, setBusy] = useState(false);
  const [sideFix, setSideFix] = useState(null);

  const drawerTotal = billsTotal(bills);
  const calc = computeShift(shift, entries, shop);
  const filled = machines.some((_, i) => String(mvals[i]).trim() !== '');
  const preview = filled ? computeShift({ ...shift, handover: { machines: machines.map((m, i) => ({ ...m, value: String(mvals[i]).trim() === '' ? null : num(mvals[i]) })) } }, entries, shop) : null;
  const feeGroups = preview ? preview.machineGroups.filter((g) => g.affects && g.sales && g.rateFrom === 'cashier' && g.fee) : [];
  const expSide = calc.side.expected;
  // The shop's current setting decides; a wallet that wasn't "shop" at receive also needs its opening balance.
  const modeOf = (k) => walletModeOf(shop, k);
  const needsOpen = (k) => shift.receive?.walletModes?.[k] !== 'shop';
  const walletKeys = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key) || num(shift.receive?.wallets?.[w.key]) || calc.safes[w.key]?.lines.length);
  const shopWallets = walletKeys.filter((w) => modeOf(w.key) === 'shop');
  const ownerWallets = walletKeys.filter((w) => modeOf(w.key) !== 'shop');
  const [wtyped, setWtyped] = useState(() => Object.fromEntries(shopWallets.map((w) => [w.key, ''])));
  const [wopen, setWopen] = useState(() => Object.fromEntries(shopWallets.filter((w) => needsOpen(w.key)).map((w) => [w.key, shift.receive?.wallets?.[w.key] !== undefined ? String(num(shift.receive.wallets[w.key])) : ''])));
  const walletsClose = Object.fromEntries(walletKeys.map((w) => [w.key, modeOf(w.key) === 'shop' ? num(wtyped[w.key]) : calc.safes[w.key].expected]));
  const sideDiff = side === '' ? 0 : Math.round((num(side) - expSide) * 100) / 100;
  const sideOk = side !== '' && Math.abs(sideDiff) < 0.01;
  const fixSide = () => {
    setSideFix({ diff: sideDiff, typed: num(side) });
    setSide(String(expSide));
    toast(sideDiff < 0 ? `حط ${fmt(-sideDiff)} ج من درجك في الجانبي، وبعدين عدّ الدرج تاني` : `رجّع ${fmt(sideDiff)} ج من الجانبي لدرجك، وبعدين عدّ الدرج تاني`);
  };
  const [wphotos, setWphotos] = useState({});
  const addWalletPhoto = async (k) => {
    const data = await pickImage(1000, 0.65);
    if (data) { setWphotos((p) => ({ ...p, [k]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };
  const addPhoto = async (i) => {
    const data = await pickImage(1000, 0.65);
    if (data) { setPhotos((p) => ({ ...p, [i]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };

  const send = async () => {
    if (side === '') { toast('اكتب مبلغ الدرج الجانبي (ولو صفر اكتب 0)', 'err'); return; }
    if (!sideOk) { toast(`الجانبي لازم يبقى ${fmt(expSide)} ج · ظبطه الأول`, 'err'); return; }
    const wMissing = shopWallets.find((w) => String(wtyped[w.key] ?? '').trim() === '');
    if (wMissing) { toast(`اكتب رصيد ${wMissing.label} دلوقتي`, 'err'); return; }
    const oMissing = shopWallets.find((w) => needsOpen(w.key) && String(wopen[w.key] ?? '').trim() === '');
    if (oMissing) { toast(`اكتب رصيد ${oMissing.label} أول الوردية`, 'err'); return; }
    const missing = mvals.findIndex((v) => String(v).trim() === '');
    if (missing >= 0) { toast(`اكتب رصيد ${machines[missing].machine} · ${machines[missing].account}`, 'err'); return; }
    setBusy(true);
    const now = new Date();
    const handover = {
      bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, num(v)])),
      drawerTotal, side: num(side),
      machines: machines.map((m, i) => ({ ...m, value: num(mvals[i]), photo: !!photos[i] })),
      keepDrawer, keepSide, sideExpected: expSide, sideFix: sideFix || null, wallets: walletsClose,
      walletsTyped: Object.fromEntries(shopWallets.map((w) => [w.key, num(wtyped[w.key])])),
      walletModes: walletModesOf(shop),
      walletsOpenFix: Object.fromEntries(shopWallets.filter((w) => needsOpen(w.key)).map((w) => [w.key, num(wopen[w.key])])),
    };
    try {
      const b = writeBatch(db);
      Object.entries(photos).forEach(([i, data]) => {
        b.set(doc(collection(db, 'shifts', shift.id, 'photos')), { kind: 'machine', stage: 'handover', label: machinePhotoLabel(machines, i), data, check: 'pending', createdAt: serverTimestamp() });
      });
      Object.entries(wphotos).forEach(([k, data]) => {
        const w = shopWallets.find((x) => x.key === k);
        b.set(doc(collection(db, 'shifts', shift.id, 'photos')), { kind: 'wallet', stage: 'handover', wallet: k, label: w?.label || k, amount: num(wtyped[k]), data, check: 'pending', createdAt: serverTimestamp() });
      });
      b.update(doc(db, 'shifts', shift.id), { status: 'submitted', submittedAt: serverTimestamp(), submittedAtLocal: now.toISOString(), handover, entryCount: entries.length });
      b.update(doc(db, 'shops', shop.id), {
        [openKey(reg)]: null,
        [lastKey(reg)]: { shiftId: shift.id, cashierName: profile.name, cashierUid: profile.id, at: now.toISOString(), ...handover },
      });
      const toMain = (keepDrawer === 'main' ? drawerTotal : 0) + (keepSide === 'main' ? num(side) : 0);
      if (isSub && toMain > 0) b.set(doc(collection(db, 'transfers')), newTransfer({ shop, shift, profile, toReg: MAIN_REG, amount: toMain, kind: 'handover' }));
      const p = b.commit();
      const offline = !navigator.onLine;
      if (offline) p.catch(() => {}); else await p;
      onDone({
        offline,
        stats: [
          { label: `من ${timeStr(shift.openedAt || shift.openedAtLocal)} لـ ${timeStr(now)}`, value: `اشتغلت ${durationStr(shift.openedAt || shift.openedAtLocal, now)}` },
          { label: 'عملياتك', value: `${entries.length} عملية` },
          { label: `درج الكاشير · ${fmt(drawerTotal)} ج`, value: keepDrawer === 'stay' ? 'فضل في الدرج' : keepDrawer === 'main' ? 'اتسلّم للأساسي · مستني تأكيده' : 'اتسلّم للمحل' },
          ...(noSide ? [] : [{ label: `الجانبي · ${fmt(side)} ج`, value: keepSide === 'stay' ? 'فضل في الدرج' : keepSide === 'main' ? 'اتسلّم للأساسي · مستني تأكيده' : 'اتسلّم للمحل' }]),
        ],
      });
    } catch (e) {
      console.error(e);
      toast('حصلت مشكلة في التسليم، جرّب تاني', 'err');
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <div className="spread" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="title">سلّم الوردية</h1>
          <span className="sub">{isSub ? 'عدّ فلوسك كلها، وقول هتتسلّم للكاشير الأساسي ولا هتفضل في الدرج' : 'عدّ الدرج، اكتب الجانبي وقراية المكن، وقول كل درج هيفضل ولا هيتسلّم للمحل'}</span>
        </div>
        <button type="button" className="btn soft sm" onClick={onBack}>رجوع للعمليات</button>
      </div>
      <div className="row">
        <div className="grow" style={{ flex: '3 1 520px' }}>
          <section className="card tint-orange" style={{ gap: 16 }}>
            <div className="spread">
              <h2 className="h2"><span className="dot" style={{ background: 'var(--orange)' }} />عدّ درج الكاشير</h2>
              <span className="big-num">{fmt(drawerTotal)}<small> ج</small></span>
            </div>
            <Bills bills={bills} setBills={setBills} noSteppers />
          </section>
          <section className="card tint-violet" style={{ gap: 14 }}>
            <h2 className="h2">الفلوس هتروح فين؟</h2>
            <Split title="درج الكاشير" mark="د" color="#FFD3B5" amount={drawerTotal} value={keepDrawer} set={setKeepDrawer} options={opts} />
            {!noSide && <Split title="الدرج الجانبي" mark="ج" color="var(--lime)" amount={num(side)} value={keepSide} set={setKeepSide} options={opts} />}
            {isSub && (keepDrawer === 'main' || keepSide === 'main') && <span className="small muted">الكاشير الأساسي هيأكد إنه استلم المبلغ.</span>}
          </section>
        </div>
        <div className="side" style={{ flex: '2 1 380px' }}>
          {incoming.length > 0 && <div className="alert warn small">فيه {incoming.length} مبلغ جاي ليك من كاشير تاني لسه ما أكدتهوش ({incoming.map((t) => `${t.fromName}: ${fmt(t.amount)} ج`).join('، ')}). أكّده من شاشة العمليات قبل ما تعدّ، أو هيفضل للوردية اللي بعدك.</div>}
          {!noSide && <SideBox value={side} setValue={(v) => { setSide(v); }} hint={`المفروض يبقى فيه ${fmt(expSide)} ج`} />}
          {side !== '' && !sideOk && (
            <div className="alert bad" role="alert">
              <strong style={{ fontSize: 16 }}>الجانبي {sideDiff < 0 ? 'ناقص' : 'زيادة'} {fmt(Math.abs(sideDiff))} ج</strong>
              <span className="small" style={{ lineHeight: 1.7 }}>
                استلمت {fmt(shift.receive?.side)} ج، والمفروض يبقى فيه دلوقتي {fmt(expSide)} ج بعد اللي دخل وطلع منه.
                {sideDiff < 0 ? ` كمّل الناقص من درج الكاشير.` : ` رجّع الزيادة لدرج الكاشير.`}
              </span>
              <button type="button" className="btn dark full" style={{ height: 52, fontSize: 16 }} onClick={fixSide}>
                {sideDiff < 0 ? `كمّلت ${fmt(-sideDiff)} ج من درجي` : `رجّعت ${fmt(sideDiff)} ج لدرجي`}
              </button>
              <span className="tiny">لو شايف إن الحسبة مش مظبوطة، كمّل التسليم وكلّم المحاسب.</span>
            </div>
          )}
          {sideFix && sideOk && <div className="alert ok small">✓ الجانبي اتظبط · افتكر تعدّ درج الكاشير تاني بعد ما {sideFix.diff < 0 ? 'طلّعت منه' : 'حطيت فيه'} {fmt(Math.abs(sideFix.diff))} ج</div>}
          {ownerWallets.length > 0 && ownerWallets.some((w) => calc.safes[w.key]?.inn) && (
            <section className="card tint-violet" style={{ gap: 8 }}>
              <h2 className="h2"><span className="dot" style={{ background: 'var(--violet)' }} />تحويلات المحافظ</h2>
              {ownerWallets.filter((w) => calc.safes[w.key]?.inn).map((w) => {
                const x = calc.safes[w.key];
                return (
                  <div key={w.key} className="m-row" style={{ padding: '8px 14px 8px 8px' }}>
                    <WalletMark k={w.key} size={40} />
                    <span className="lbl"><span className="small"><b>{w.label}</b></span><span className="tiny muted">{x.lines.length} تحويل · بتروح لصاحب المحل</span></span>
                    <strong style={{ fontSize: 18 }}>{fmt(x.inn)}</strong>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
      {(shopWallets.length > 0 || machines.length > 0) && (
        <section className="card" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="h2"><span className="dot" style={{ background: 'var(--violet)' }} />المحافظ والمكن دلوقتي</h2>
            <span className="tiny muted">اكتب رصيد كل واحدة وصوّر شاشتها. المحاسب هيراجع الصور.</span>
          </div>
          <div className="assets-grid" style={{ '--cols': Math.max(1, Math.min(4, shopWallets.length + shopWallets.filter((w) => needsOpen(w.key)).length + machineGroupsOf(machines).length)) }}>
            {shopWallets.map((w) => [
              needsOpen(w.key) && <WalletField key={w.key + ':o'} k={w.key} label={`${w.label} · أول الوردية`} hint="كان فيها كام لما استلمت؟" value={wopen[w.key] ?? ''} onChange={(v) => setWopen({ ...wopen, [w.key]: v })} ariaLabel={`رصيد ${w.label} أول الوردية`} />,
              <WalletField key={w.key} k={w.key} label={w.label} hint={needsOpen(w.key) ? 'الرصيد اللي فيها دلوقتي' : `استلمت ${fmt(calc.safes[w.key].open)} · اكتب اللي فيها دلوقتي`} value={wtyped[w.key] ?? ''} onChange={(v) => setWtyped({ ...wtyped, [w.key]: v })} ariaLabel={`رصيد ${w.label} دلوقتي`} onPhoto={() => addWalletPhoto(w.key)} photo={wphotos[w.key]} />,
            ])}
            <MachineRows inline machines={machines} values={mvals} setValues={setMvals} photos={photos} onPhoto={addPhoto} />
          </div>
        </section>
      )}
          {feeGroups.length > 0 && (
        <section className="card" style={{ background: '#FFE4E4', gap: 8 }}>
          <h2 className="h2">مصاريف المكن</h2>
          {feeGroups.map((g) => (
            <div key={g.machine} className="m-row" style={{ padding: '10px 14px', background: '#fff' }}>
              <span className="lbl">
                <span className="small"><b>مصاريف {g.machine}</b> ({fmt(g.rate)}%)</span>
                <span className="tiny muted">استلمت {fmt(g.open)} · بتسلّم {fmt(g.close ?? 0)} · {g.sales > 0 ? 'مبيعات' : 'خدمات'} {fmt(Math.abs(g.sales))}</span>
              </span>
              <strong style={{ fontSize: 18, color: '#9B1C1C' }}>{fmt(g.fee)} ج</strong>
            </div>
          ))}
          <span className="tiny muted">المصاريف دي بتتحسب من درجك كبند لوحده، مش عجز عليك.</span>
        </section>
      )}
      <div className="recv-done">
          <button type="button" className="btn full" style={{ height: 66, fontSize: 20 }} onClick={send} disabled={busy}>
            <span className="ic"><Icon d="send" size={18} /></span>{busy ? 'لحظة…' : 'سلّم وابعت للمحاسب'}
          </button>
          <span className="small muted" style={{ textAlign: 'center' }}>العجز أو الزيادة بيطلعوا عند المحاسب</span>
      </div>
    </div>
  );
}
