import { useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, useToast } from '../ui.jsx';
import { billsTotal, durationStr, emptyBills, fmt, num, pickImage, sideExpected, timeStr } from '../lib';
import { Bills, MachineRows, SideBox } from './parts.jsx';

function Split({ title, mark, color, amount, value, set }) {
  return (
    <div className="spread" style={{ background: 'rgba(255,255,255,.8)', borderRadius: 24, padding: '14px 16px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 46, height: 46, borderRadius: 16, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{mark}</span>
        <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span><span style={{ fontSize: 22, fontWeight: 800 }}>{fmt(amount)} ج</span></span>
      </span>
      <span style={{ display: 'flex', gap: 6, background: '#fff', borderRadius: 999, padding: 5 }}>
        <button type="button" className={'chip' + (value === 'stay' ? ' on' : '')} onClick={() => set('stay')}>يفضل في الدرج</button>
        <button type="button" className={'chip' + (value === 'shop' ? ' on' : '')} onClick={() => set('shop')}>يتسلّم للمحل</button>
      </span>
    </div>
  );
}

export default function Handover({ shop, shift, entries, profile, onBack, onDone }) {
  const toast = useToast();
  const machines = shop.machines || [];
  const [bills, setBills] = useState(emptyBills());
  const [side, setSide] = useState('');
  const [mvals, setMvals] = useState(machines.map(() => ''));
  const [photos, setPhotos] = useState({});
  const [keepDrawer, setKeepDrawer] = useState('stay');
  const [keepSide, setKeepSide] = useState('stay');
  const [busy, setBusy] = useState(false);
  const [sideFix, setSideFix] = useState(null);

  const drawerTotal = billsTotal(bills);
  const expSide = sideExpected(shift, entries);
  const sideDiff = side === '' ? 0 : Math.round((num(side) - expSide) * 100) / 100;
  const sideOk = side !== '' && Math.abs(sideDiff) < 0.01;
  const fixSide = () => {
    setSideFix({ diff: sideDiff, typed: num(side) });
    setSide(String(expSide));
    toast(sideDiff < 0 ? `حط ${fmt(-sideDiff)} ج من درجك في الجانبي، وبعدين عدّ الدرج تاني` : `رجّع ${fmt(sideDiff)} ج من الجانبي لدرجك، وبعدين عدّ الدرج تاني`);
  };
  const addPhoto = async (i) => {
    const data = await pickImage(1000, 0.65);
    if (data) { setPhotos((p) => ({ ...p, [i]: data })); toast('الصورة اترفعت · كمّل عادي'); }
  };

  const send = async () => {
    if (side === '') { toast('اكتب مبلغ الدرج الجانبي (ولو صفر اكتب 0)', 'err'); return; }
    if (!sideOk) { toast(`الجانبي لازم يبقى ${fmt(expSide)} ج · ظبطه الأول`, 'err'); return; }
    const missing = mvals.findIndex((v) => String(v).trim() === '');
    if (missing >= 0) { toast(`اكتب رصيد ${machines[missing].machine} · ${machines[missing].account}`, 'err'); return; }
    setBusy(true);
    const now = new Date();
    const handover = {
      bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, num(v)])),
      drawerTotal, side: num(side),
      machines: machines.map((m, i) => ({ ...m, value: num(mvals[i]), photo: !!photos[i] })),
      keepDrawer, keepSide, sideExpected: expSide, sideFix: sideFix || null,
    };
    try {
      const b = writeBatch(db);
      Object.entries(photos).forEach(([i, data]) => {
        b.set(doc(collection(db, 'shifts', shift.id, 'photos')), { kind: 'machine', stage: 'handover', label: `${machines[i].machine} · ${machines[i].account}`, data, check: 'pending', createdAt: serverTimestamp() });
      });
      b.update(doc(db, 'shifts', shift.id), { status: 'submitted', submittedAt: serverTimestamp(), submittedAtLocal: now.toISOString(), handover, entryCount: entries.length });
      b.update(doc(db, 'shops', shop.id), {
        openShift: null,
        lastHandover: { shiftId: shift.id, cashierName: profile.name, cashierUid: profile.id, at: now.toISOString(), ...handover },
      });
      const p = b.commit();
      const offline = !navigator.onLine;
      if (offline) p.catch(() => {}); else await p;
      onDone({
        offline,
        stats: [
          { label: `من ${timeStr(shift.openedAt || shift.openedAtLocal)} لـ ${timeStr(now)}`, value: `اشتغلت ${durationStr(shift.openedAt || shift.openedAtLocal, now)}` },
          { label: 'عملياتك', value: `${entries.length} عملية` },
          { label: `درج الكاشير · ${fmt(drawerTotal)} ج`, value: keepDrawer === 'stay' ? 'فضل في الدرج' : 'اتسلّم للمحل' },
          { label: `الجانبي · ${fmt(side)} ج`, value: keepSide === 'stay' ? 'فضل في الدرج' : 'اتسلّم للمحل' },
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
          <span className="sub">عدّ الدرج، اكتب الجانبي وقراية المكن، وقول كل درج هيفضل ولا هيتسلّم للمحل</span>
        </div>
        <button type="button" className="btn soft sm" onClick={onBack}>رجوع للعمليات</button>
      </div>
      <div className="row">
        <div className="grow">
          <section className="card tint-orange" style={{ gap: 16 }}>
            <div className="spread">
              <h2 className="h2"><span className="dot" style={{ background: 'var(--orange)' }} />عدّ درج الكاشير</h2>
              <span className="big-num">{fmt(drawerTotal)}<small> ج</small></span>
            </div>
            <Bills bills={bills} setBills={setBills} />
          </section>
          <section className="card tint-violet" style={{ gap: 14 }}>
            <h2 className="h2">الفلوس هتروح فين؟</h2>
            <Split title="درج الكاشير" mark="د" color="#FFD3B5" amount={drawerTotal} value={keepDrawer} set={setKeepDrawer} />
            <Split title="الدرج الجانبي" mark="ج" color="var(--lime)" amount={num(side)} value={keepSide} set={setKeepSide} />
          </section>
        </div>
        <div className="side">
          <SideBox value={side} setValue={(v) => { setSide(v); }} hint={`المفروض يبقى فيه ${fmt(expSide)} ج`} />
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
          <section className="card tint-yellow">
            <h2 className="h2"><span className="dot" style={{ background: 'var(--yellow)' }} />قراية المكن دلوقتي</h2>
            <span className="tiny muted">اكتب الرقم وصوّر الشاشة، وكمّل. المحاسب هيراجع الصور.</span>
            <MachineRows machines={machines} values={mvals} setValues={setMvals} photos={photos} onPhoto={addPhoto} />
          </section>
          <button type="button" className="btn full" style={{ height: 66, fontSize: 20 }} onClick={send} disabled={busy}>
            <span className="ic"><Icon d="send" size={18} /></span>{busy ? 'لحظة…' : 'سلّم وابعت للمحاسب'}
          </button>
          <span className="small muted" style={{ textAlign: 'center' }}>العجز أو الزيادة بيطلعوا عند المحاسب</span>
        </div>
      </div>
    </div>
  );
}
