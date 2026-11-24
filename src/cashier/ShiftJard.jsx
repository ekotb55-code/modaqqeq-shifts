import { useState } from 'react';
import { Avatar, Icon, Modal, useDraft, useToast } from '../ui.jsx';
import { fmt, num } from '../lib';
import { jardBillsCheck, jardFinish, jardRecheck, jardStart, shiftJardOf } from '../shiftJard.js';
import { verifyCashierPin } from '../sessions.js';
import { logAct } from '../activity.js';
import { isDesktop } from '../remoteDraft';
import { clearJardOnPhone, useJardOnPhone } from '../phoneJard.jsx';

// جرد الوردية (من مهام التقفيل): الكاشير اللي بيسلّم واللي بيستلم بيعدّوا الأصناف الثابتة مع بعض.
// 1) ابدأ: الكميات بتتسحب من برنامج البيع لحظتها (من غير ما تظهر لهم)
// 2) العد  3) الاتنين بيأكدوا بالرقم السري  4) الفروقات: النواقص بتتضرب فاتورة على حساب الكاشير (عجز وردية)،
//    والزيادة بيتعملها تسوية من الدعم أو المحل.
// كل حاجة بتتحفظ على الجهاز علشان لو التطبيق اتقفل يكمّل من مكانه.

const PIN_MSG = (c) => (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'bad-pin' ? 'الرقم السري غلط'
  : c === 'offline-first' || c === 'auth/network-request-failed' ? 'الكاشير ده محتاج نت أول مرة يتأكد على الجهاز ده'
    : c === 'auth/too-many-requests' ? 'محاولات كتير غلط · استنى شوية وجرّب تاني' : 'مش قادرين نتأكد من الرقم السري · جرّب تاني');

export const jardDraftKey = (shiftId) => `mdq-draft-jard-${shiftId}`;

// ملخص الجرد اللي بيتحفظ مع التسليم ويظهر للمحاسب
export function jardSummary(res, extra = {}) {
  const lines = res?.lines || [];
  const short = lines.filter((l) => num(l.diff) < -0.0001);
  const over = lines.filter((l) => num(l.diff) > 0.0001);
  const sum = (a) => Math.round(a.reduce((s, l) => s + Math.abs(num(l.value)), 0) * 100) / 100;
  return {
    id: res?.session?.id || '', count: lines.length, at: new Date().toISOString(),
    shortCount: short.length, shortValue: sum(short), overCount: over.length, overValue: sum(over),
    short: short.map((l) => ({ name: l.name, code: l.code, diff: num(l.diff), sale: num(l.sale), value: Math.abs(num(l.value)) })),
    over: over.map((l) => ({ name: l.name, code: l.code, diff: num(l.diff), sale: num(l.sale), value: Math.abs(num(l.value)) })),
    ...extra,
  };
}

// نتيجة التأكد من فاتورة في برنامج البيع
function BillState({ b, okText }) {
  if (!b) return null;
  if (b.ok === true) return <span className="small" style={{ color: '#0E7A4F', fontWeight: 700 }}>{okText}</span>;
  if (b.ok === null) return <span className="small" style={{ color: '#8A5A00', fontWeight: 700 }}>⚠️ مقدرناش نتأكد من برنامج البيع · هيتكتب للمحاسب «الفاتورة ماتأكدتش»</span>;
  if (b.ok === 'skip') return <span className="small" style={{ color: '#8A5A00', fontWeight: 700 }}>⚠️ كمّلت من غير تطابق · المحاسب هيراجع الفاتورة</span>;
  return (
    <div className="stack" style={{ gap: 4, background: '#fff', borderRadius: 12, padding: '8px 10px' }} role="alert">
      <strong className="small" style={{ color: '#9B1C1C' }}>✗ {b.msg || `فاتورة ${b.no || ''} مش مطابقة`}</strong>
      {(b.bad || []).map((x) => (
        <span key={x.name} className="tiny">{x.name}: المطلوب {fmt(x.need)} · في الفاتورة {fmt(x.got)}</span>
      ))}
    </div>
  );
}

function PinRow({ title, who, pin, setPin, ok, busy, onCheck, children }) {
  return (
    <div className="stack" style={{ background: ok ? '#E3F9EC' : '#fff', borderRadius: 20, padding: '12px 14px', gap: 8 }}>
      <strong>{title}</strong>
      {children}
      {who && (ok ? (
        <span className="small" style={{ color: '#0E7A4F', fontWeight: 700 }}>✓ {who.name} أكّد</span>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" inputMode="numeric" type="password" maxLength={4} dir="ltr" placeholder="الرقم السري" aria-label={`الرقم السري بتاع ${who.name}`}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ flex: 1 }} />
          <button type="button" className="btn sm" disabled={busy || pin.length !== 4} onClick={onCheck}>{busy ? 'لحظة…' : 'تأكيد'}</button>
        </div>
      ))}
    </div>
  );
}

export default function ShiftJard({ shop, shift, profile, cashiers = [], onClose, onDone }) {
  const toast = useToast();
  const cfg = shiftJardOf(shop);
  const dkey = jardDraftKey(shift.id);
  const [step, setStep] = useDraft(dkey, 'step', 'start'); // start → count → confirm → result
  const [sess, setSess] = useDraft(dkey, 'sess', null); // { id, items }
  const [counts, setCounts] = useDraft(dkey, 'counts', {});
  const [inUid, setInUid] = useDraft(dkey, 'inUid', '');
  const [okOut, setOkOut] = useDraft(dkey, 'okOut', false);
  const [okIn, setOkIn] = useDraft(dkey, 'okIn', false);
  const [res, setRes] = useDraft(dkey, 'res', null);
  // التأكد من الفواتير في برنامج البيع: bills = { sale, ret } كل واحدة { ok: true | false | null(ماتأكدتش), no, bad, msg }
  const [billNo, setBillNo] = useDraft(dkey, 'billNo', '');
  const [bills, setBills] = useDraft(dkey, 'bills', null);
  const [tries, setTries] = useDraft(dkey, 'tries', 0);
  // على الكمبيوتر: العد بيتحوّل على موبايل الكاشير لوحده (زي التصوير) - ويقدر يعدّ من هنا لو عايز
  const [viaPhone, setViaPhone] = useDraft(dkey, 'viaPhone', () => isDesktop());
  // أصناف اتباع منها أثناء العد: بتتعد تاني هي بس (أرقام «م»)
  const [recount, setRecount] = useDraft(dkey, 'recount', null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pinOut, setPinOut] = useState('');
  const [pinIn, setPinIn] = useState('');

  const others = cashiers.filter((c) => c.uid !== profile.id);
  const selfUser = { uid: profile.id, username: cashiers.find((c) => c.uid === profile.id)?.username || profile.username || '', name: profile.name };
  const incoming = others.find((c) => c.uid === inUid) || null;
  const allItems = sess?.items || [];
  const items = recount ? allItems.filter((it) => recount.includes(it.n)) : allItems;
  const left = items.filter((it) => String(counts[it.n] ?? '').trim() === '').length;

  const toConfirm = () => { setRecount(null); setStep('confirm'); setOkOut(false); setOkIn(false); };
  // «خلّصنا العد»: نراجع كميات البرنامج تاني - اللي اتباع منه أثناء العد يتعد تاني (هو بس)
  const doneCounting = async (c = counts) => {
    setBusy(true); setErr('');
    try {
      const j = await jardRecheck(cfg, sess.id);
      const ch = (j.changed || []).map((x) => x.n);
      if (ch.length) {
        const next = { ...c };
        ch.forEach((n) => { delete next[n]; });
        setCounts(next);
        setRecount(ch);
        toast(`${ch.length} صنف اتباع منه وانتوا بتعدّوا · عدّوه تاني`, 'err');
      } else toConfirm();
    } catch (e) {
      // البرنامج مش بيرد: مانوقفش التسليم - بنكمّل على الكميات اللي اتسحبت
      toConfirm();
      // (سكريبت قديم لسه مافيهوش المراجعة: بنكمّل من غير رسالة)
      if (!/action/.test(e.message)) setErr('مقدرناش نراجع كميات البرنامج تاني (' + e.message + ') · كمّلنا على الكميات اللي اتسحبت أول الجرد');
    }
    setBusy(false);
  };
  const phoneState = useJardOnPhone({
    uid: profile.id, on: step === 'count' && viaPhone && !busy, sess, items, note: recount ? 'الأصناف دي اتباع منها وانتوا بتعدّوا · عدّوها تاني دلوقتي' : '', counts,
    onCounts: (c) => setCounts(c),
    onDone: (c) => { const all = { ...counts, ...c }; setCounts(all); doneCounting(all); clearJardOnPhone(profile.id); },
    onBack: () => { setViaPhone(false); clearJardOnPhone(profile.id); },
  });
  const countHere = () => { setViaPhone(false); clearJardOnPhone(profile.id); };

  // «ابدأ الجرد من الأول»: بنبعت رقم الوردية بعلامة #ن، فالسكريبت بيلغي الجرد القديم ويبدأ جديد بقايمة التاب الحالية
  const [again, setAgain] = useDraft(dkey, 'again', 0);
  const start = async (n = again) => {
    setBusy(true); setErr('');
    try {
      const j = await jardStart(cfg, { shiftId: n ? `${shift.id}#${n}` : shift.id, user: profile.name });
      setSess({ id: j.open.id, items: j.items || [] });
      // لو نفس الجرد اتبدأ قبل كده (النت قطع) بنسيب الأرقام اللي اتكتبت
      if (!j.resumed) setCounts({});
      setRecount(null);
      setStep('count');
      logAct('shift_jard', `${n ? 'بدأ جرد الوردية من الأول' : 'بدأ جرد الوردية'} · ${(j.items || []).length} صنف`, { shopId: shop.id, shiftId: shift.id });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const restart = async () => {
    if (!window.confirm('الجرد ده هيتلغي والأرقام اللي اتكتبت هتتمسح، ويبدأ جرد جديد بالأصناف الحالية وكميات البرنامج دلوقتي. متأكد؟')) return;
    const n = (again || 0) + 1;
    clearJardOnPhone(profile.id);
    setAgain(n);
    setCounts({});
    setOkOut(false); setOkIn(false);
    setViaPhone(isDesktop());
    await start(n);
  };
  const restartBtn = <button type="button" className="link" style={{ color: '#9B1C1C' }} disabled={busy} onClick={restart}>↺ ابدأ الجرد من الأول (لو الأصناف اتغيرت)</button>;

  const check = async (who, pin, setOk, setPin) => {
    setBusy(true); setErr('');
    try {
      await verifyCashierPin(who, pin);
      setOk(true);
    } catch (e) { setErr(`${who.name}: ${PIN_MSG(e.code)}`); setPin(''); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const c = Object.fromEntries(allItems.map((it) => [it.n, num(counts[it.n])]));
      const j = await jardFinish(cfg, { id: sess.id, counts: c, user: `${profile.name} + ${incoming?.name || ''}` });
      if (!j.lines) throw new Error('الفروقات ماوصلتش · جرّب تاني');
      setRes({ session: j.session, lines: j.lines });
      setStep('result');
      const s = jardSummary(j);
      logAct('shift_jard', `خلّص جرد الوردية مع ${incoming?.name || ''} · نواقص ${s.shortCount} (${fmt(s.shortValue)} ج) · زيادة ${s.overCount}`, { shopId: shop.id, shiftId: shift.id });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const base = res ? jardSummary(res) : null;
  const needSale = !!base && base.shortCount > 0;
  const needRet = !!base && base.overCount > 0;
  const stat = (need, b) => (!need ? '' : !b ? 'none' : b.ok === true ? 'ok' : b.ok === null ? 'unverified' : 'bad');
  const saleSt = stat(needSale, bills?.sale), retSt = stat(needRet, bills?.ret);
  const passed = (st) => st === '' || st === 'ok' || st === 'unverified' || st === 'skipped';
  const checkBills = async () => {
    setBusy(true); setErr('');
    let b;
    try {
      b = await jardBillsCheck(cfg, { id: sess.id, billNo: String(billNo).trim() });
    } catch (e) {
      // البرنامج مش بيرد أو مفيش نت: مانوقفش التسليم - بيتكتب للمحاسب «ماتأكدتش»
      const u = { ok: null, msg: e.message };
      b = { sale: needSale ? { ...u, no: String(billNo).trim() } : null, ret: needRet ? u : null };
    }
    setBills(b);
    setTries(tries + 1);
    setBusy(false);
  };
  const skipBills = () => setBills({
    sale: needSale ? (saleSt === 'ok' ? bills.sale : { ...(bills?.sale || {}), ok: 'skip', no: String(billNo).trim() }) : null,
    ret: needRet ? (retSt === 'ok' ? bills.ret : { ...(bills?.ret || {}), ok: 'skip' }) : null,
  });
  const st2 = (need, b) => (!need ? '' : b?.ok === 'skip' ? 'skipped' : stat(need, b));
  const saleFin = st2(needSale, bills?.sale), retFin = st2(needRet, bills?.ret);
  const summary = res ? jardSummary(res, {
    outName: profile.name, outUid: profile.id, inName: incoming?.name || '', inUid: incoming?.uid || '', test: !!cfg.test,
    invoice: saleFin === 'ok', saleNo: bills?.sale?.no || String(billNo).trim(), saleCheck: saleFin, retNo: bills?.ret?.no || '', retCheck: retFin,
  }) : null;
  const done = () => { onDone(summary); };

  let body;
  if (step === 'start') {
    body = (
      <>
        <div className="alert warn" style={{ lineHeight: 1.8 }}>
          <strong>قبل ما تسلّم لازم تجرد الأصناف الثابتة مع الكاشير اللي هيستلم منك.</strong>
          <span className="small">انتوا الاتنين تعدّوا وانتوا واقفين، وكل واحد يأكد بالرقم السري بتاعه. لو اللي هيستلم لسه ماوصلش، كمّل شغلك لحد ما ييجي.</span>
        </div>
        <span className="small muted">الكميات بتتسحب من برنامج البيع لحظة ما تدوس «ابدأ». محتاج نت.</span>
        <button type="button" className="btn full" style={{ height: 60, fontSize: 18 }} disabled={busy} onClick={() => start()}>{busy ? 'بنسحب الأصناف من البرنامج… (ممكن ياخد دقيقة)' : '📋 ابدأ جرد الوردية'}</button>
      </>
    );
  } else if (step === 'count' && viaPhone) {
    const filled = items.length - left;
    body = (
      <>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10, padding: '8px 0' }}>
          <span className={'pshot-phone' + (phoneState === 'opened' ? ' on' : '')} aria-hidden="true">📲</span>
          <strong style={{ fontSize: 20 }}>{phoneState === 'opened' ? 'العد شغال على الموبايل…' : recount ? 'عدّوا الأصناف دي تاني من الموبايل' : 'كمّل العد من الموبايل'}</strong>
          {recount && <span className="small" style={{ color: '#9B1C1C', fontWeight: 700 }}>الأصناف دي اتباع منها وانتوا بتعدّوا · عدّوها تاني دلوقتي</span>}
          {phoneState === 'opened' ? (
            <span className="pshot-what">اتعد {filled} من {items.length} صنف</span>
          ) : (
            <ol className="pshot-steps">
              <li>افتح تطبيق مدقق على موبايلك بنفس الحساب.</li>
              <li>شاشة «جرد الوردية» هتفتح لوحدها · اعدّوا واكتبوا الكميات.</li>
              <li>لما تدوسوا «خلّصنا العد» الشاشة دي هتكمّل لوحدها.</li>
            </ol>
          )}
          <span className="pshot-wait"><i /><i /><i /> {busy ? 'بنراجع كميات البرنامج…' : 'مستنيين الموبايل'}</span>
        </div>
        <button type="button" className="btn soft full" onClick={countHere}>هعدّ من هنا على الكمبيوتر</button>
        {restartBtn}
      </>
    );
  } else if (step === 'count') {
    body = (
      <>
        {recount
          ? <div className="alert warn small"><strong>الأصناف دي اتباع منها وانتوا بتعدّوا · عدّوها تاني دلوقتي</strong></div>
          : <span className="small muted">اعدّوا كل صنف واكتبوا العدد اللي قدامكم. لو الصنف خلصان اكتب 0.</span>}
        <div className="stack" style={{ gap: 8, maxHeight: '55vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
          {items.map((it) => {
            const v = String(counts[it.n] ?? '');
            return (
              <div key={it.n} className="m-row" style={{ padding: '8px 12px', background: v.trim() === '' ? '#fff' : '#EEF8E4' }}>
                <span className="lbl" style={{ minWidth: 0 }}>
                  <span className="small"><b>{it.n}. {it.name}</b></span>
                  {it.subs && <span className="tiny muted" dir="ltr" style={{ textAlign: 'right' }}>{String(it.subs).split(',')[0].trim()}</span>}
                </span>
                <input className="input" inputMode="decimal" dir="ltr" aria-label={`عدد ${it.name}`} placeholder="العدد" style={{ width: 110, height: 48, fontSize: 20, textAlign: 'center' }}
                  value={v} onChange={(e) => setCounts({ ...counts, [it.n]: e.target.value.replace(/[^0-9.]/g, '') })} />
              </div>
            );
          })}
        </div>
        <button type="button" className="btn full" style={{ height: 56 }} disabled={left > 0 || busy} onClick={() => doneCounting()}>
          {busy ? 'بنراجع كميات البرنامج…' : left > 0 ? `فاضل ${left} صنف` : 'خلّصنا العد · نأكد'}
        </button>
        {isDesktop() && <button type="button" className="link" onClick={() => setViaPhone(true)}>📲 كمّل العد من الموبايل</button>}
        {restartBtn}
      </>
    );
  } else if (step === 'confirm') {
    body = (
      <>
        <span className="small muted">الاتنين يراجعوا الأرقام ويأكدوا. بعد التأكيد الأرقام مش هتتغيّر.</span>
        <PinRow title="اللي بيسلّم" who={selfUser} pin={pinOut} setPin={setPinOut} ok={okOut} busy={busy}
          onCheck={() => check(selfUser, pinOut, setOkOut, setPinOut)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={profile.name} photo={profile.photo} size={36} /><span className="small">{profile.name}</span></span>
        </PinRow>
        <PinRow title="اللي بيستلم" who={incoming} pin={pinIn} setPin={setPinIn} ok={okIn} busy={busy}
          onCheck={() => check(incoming, pinIn, setOkIn, setPinIn)}>
          {okIn ? null : others.length ? (
            <div className="chips">
              {others.map((c) => (
                <button key={c.uid} type="button" className={'chip' + (inUid === c.uid ? ' on' : '')} aria-pressed={inUid === c.uid} onClick={() => { setInUid(c.uid); setPinIn(''); }}>{c.name}</button>
              ))}
            </div>
          ) : <span className="small" style={{ color: '#9B1C1C' }}>مفيش كاشير تاني في المحل · كلّم المحاسب</span>}
        </PinRow>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn soft" onClick={() => { setViaPhone(false); setStep('count'); }} disabled={busy}>رجوع للعد</button>
          <button type="button" className="btn" style={{ height: 56, flex: 1 }} disabled={busy || !okOut || !okIn} onClick={finish}>{busy ? 'لحظة…' : 'ابعت الجرد وطلّع الفروقات'}</button>
        </div>
        {restartBtn}
      </>
    );
  } else {
    const s = summary;
    body = (
      <>
        {s.shortCount === 0 && s.overCount === 0 && <div className="alert ok"><strong>مفيش فروقات ✅</strong><span className="small">الأصناف كلها مظبوطة.</span></div>}
        {s.shortCount > 0 && (
          <section className="stack" style={{ background: '#FFE4E4', borderRadius: 20, padding: 14, gap: 8 }}>
            <strong style={{ color: '#9B1C1C' }}>نواقص · {s.shortCount} صنف · {fmt(s.shortValue)} ج</strong>
            {s.short.map((l) => (
              <div key={l.code} className="spread small" style={{ background: '#fff', borderRadius: 12, padding: '6px 10px' }}>
                <span>{l.name}</span><span dir="ltr"><b>{fmt(l.diff)}</b> × {fmt(l.sale)} = {fmt(l.value)} ج</span>
              </div>
            ))}
            <span className="small" style={{ lineHeight: 1.8 }}>اضرب <b>فاتورة مبيعات</b> بالنواقص دي على برنامج البيع دلوقتي على حسابك، واكتب رقمها هنا. قيمتها هتطلع <b>عجز وردية</b> عليك عند التقفيل.</span>
            <input className="input" inputMode="numeric" dir="ltr" placeholder="رقم فاتورة المبيعات" aria-label="رقم فاتورة المبيعات" style={{ height: 54, fontSize: 20, textAlign: 'center' }}
              value={billNo} onChange={(e) => { setBillNo(e.target.value.replace(/\D/g, '')); if (bills) setBills({ ...bills, sale: null }); }} />
            <BillState b={bills?.sale} okText={`✓ فاتورة ${bills?.sale?.no || ''} مطابقة للنواقص`} />
          </section>
        )}
        {s.overCount > 0 && (
          <section className="stack" style={{ background: '#E4F0FF', borderRadius: 20, padding: 14, gap: 8 }}>
            <strong>زيادة · {s.overCount} صنف</strong>
            {s.over.map((l) => (
              <div key={l.code} className="spread small" style={{ background: '#fff', borderRadius: 12, padding: '6px 10px' }}>
                <span>{l.name}</span><span dir="ltr">+{fmt(l.diff)}</span>
              </div>
            ))}
            <span className="small" style={{ lineHeight: 1.8 }}>اضرب <b>فاتورة مرتجع واحدة</b> بكل الأصناف دي بنفس الكميات على برنامج البيع. مش محتاج تكتب رقمها · هنلاقيها لوحدنا.</span>
            <BillState b={bills?.ret} okText={`✓ فاتورة المرتجع ${bills?.ret?.no || ''} مطابقة للزيادة`} />
          </section>
        )}
        <span className="tiny muted">اتجرد مع {s.inName} · التقرير اتسجل في الجرد العشوائي بتاع الفرع.</span>
        {(needSale || needRet) && !(passed(saleFin) && passed(retFin)) && (
          <>
            <button type="button" className="btn full" style={{ height: 58 }} disabled={busy || (needSale && String(billNo).trim() === '')} onClick={checkBills}>
              {busy ? 'بنراجع الفواتير في برنامج البيع…' : needSale && String(billNo).trim() === '' ? 'اكتب رقم فاتورة المبيعات الأول' : 'اتأكد من الفواتير'}
            </button>
            {tries >= 2 && <button type="button" className="link" onClick={skipBills} disabled={busy}>الفواتير مضروبة ومش بتتطابق · كمّل والمحاسب يراجع</button>}
          </>
        )}
        {passed(saleFin) && passed(retFin) && (
          <button type="button" className="btn full" style={{ height: 58 }} onClick={done}>تمام · كمّل التسليم</button>
        )}
      </>
    );
  }

  const stepNo = { start: 1, count: 2, confirm: 3, result: 4 }[step];
  return (
    <Modal title="جرد الوردية" icon="search" color="var(--lime)" onClose={busy ? null : onClose} width={620}>
      <span className="tiny muted">خطوة {stepNo} من 4{cfg.test ? ' · وضع التجربة' : ''}</span>
      {err && <div className="alert bad small" role="alert"><Icon d="warn" size={16} /> {err}</div>}
      {body}
    </Modal>
  );
}
