import { useState } from 'react';
import { Avatar, Icon, Modal, useDraft, useToast } from '../ui.jsx';
import { fmt, num } from '../lib';
import { jardFinish, jardStart, shiftJardOf } from '../shiftJard.js';
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
  const [invoice, setInvoice] = useDraft(dkey, 'invoice', false);
  // على الكمبيوتر: العد بيتحوّل على موبايل الكاشير لوحده (زي التصوير) - ويقدر يعدّ من هنا لو عايز
  const [viaPhone, setViaPhone] = useDraft(dkey, 'viaPhone', () => isDesktop());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pinOut, setPinOut] = useState('');
  const [pinIn, setPinIn] = useState('');

  const others = cashiers.filter((c) => c.uid !== profile.id);
  const selfUser = { uid: profile.id, username: cashiers.find((c) => c.uid === profile.id)?.username || profile.username || '', name: profile.name };
  const incoming = others.find((c) => c.uid === inUid) || null;
  const items = sess?.items || [];
  const left = items.filter((it) => String(counts[it.n] ?? '').trim() === '').length;

  const toConfirm = () => { setStep('confirm'); setOkOut(false); setOkIn(false); };
  const phoneState = useJardOnPhone({
    uid: profile.id, on: step === 'count' && viaPhone, sess, counts,
    onCounts: (c) => setCounts(c),
    onDone: (c) => { setCounts(c); clearJardOnPhone(profile.id); toConfirm(); toast('العد وصل من الموبايل · أكّدوا بالرقم السري'); },
    onBack: () => { setViaPhone(false); clearJardOnPhone(profile.id); },
  });
  const countHere = () => { setViaPhone(false); clearJardOnPhone(profile.id); };

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const j = await jardStart(cfg, { shiftId: shift.id, user: profile.name });
      setSess({ id: j.open.id, items: j.items || [] });
      // لو نفس الجرد اتبدأ قبل كده (النت قطع) بنسيب الأرقام اللي اتكتبت
      if (!j.resumed) setCounts({});
      setStep('count');
      logAct('shift_jard', `بدأ جرد الوردية · ${(j.items || []).length} صنف`, { shopId: shop.id, shiftId: shift.id });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

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
      const c = Object.fromEntries(items.map((it) => [it.n, num(counts[it.n])]));
      const j = await jardFinish(cfg, { id: sess.id, counts: c, user: `${profile.name} + ${incoming?.name || ''}` });
      if (!j.lines) throw new Error('الفروقات ماوصلتش · جرّب تاني');
      setRes({ session: j.session, lines: j.lines });
      setStep('result');
      const s = jardSummary(j);
      logAct('shift_jard', `خلّص جرد الوردية مع ${incoming?.name || ''} · نواقص ${s.shortCount} (${fmt(s.shortValue)} ج) · زيادة ${s.overCount}`, { shopId: shop.id, shiftId: shift.id });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const summary = res ? jardSummary(res, { outName: profile.name, outUid: profile.id, inName: incoming?.name || '', inUid: incoming?.uid || '', invoice: !!invoice, test: !!cfg.test }) : null;
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
        <button type="button" className="btn full" style={{ height: 60, fontSize: 18 }} disabled={busy} onClick={start}>{busy ? 'بنسحب الأصناف من البرنامج… (ممكن ياخد دقيقة)' : '📋 ابدأ جرد الوردية'}</button>
      </>
    );
  } else if (step === 'count' && viaPhone) {
    const filled = items.length - left;
    body = (
      <>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10, padding: '8px 0' }}>
          <span className={'pshot-phone' + (phoneState === 'opened' ? ' on' : '')} aria-hidden="true">📲</span>
          <strong style={{ fontSize: 20 }}>{phoneState === 'opened' ? 'العد شغال على الموبايل…' : 'كمّل العد من الموبايل'}</strong>
          {phoneState === 'opened' ? (
            <span className="pshot-what">اتعد {filled} من {items.length} صنف</span>
          ) : (
            <ol className="pshot-steps">
              <li>افتح تطبيق مدقق على موبايلك بنفس الحساب.</li>
              <li>شاشة «جرد الوردية» هتفتح لوحدها · اعدّوا واكتبوا الكميات.</li>
              <li>لما تدوسوا «خلّصنا العد» الشاشة دي هتكمّل لوحدها.</li>
            </ol>
          )}
          <span className="pshot-wait"><i /><i /><i /> مستنيين الموبايل</span>
        </div>
        <button type="button" className="btn soft full" onClick={countHere}>هعدّ من هنا على الكمبيوتر</button>
      </>
    );
  } else if (step === 'count') {
    body = (
      <>
        <span className="small muted">اعدّوا كل صنف واكتبوا العدد اللي قدامكم. لو الصنف خلصان اكتب 0.</span>
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
        <button type="button" className="btn full" style={{ height: 56 }} disabled={left > 0} onClick={toConfirm}>
          {left > 0 ? `فاضل ${left} صنف` : 'خلّصنا العد · نأكد'}
        </button>
        {isDesktop() && <button type="button" className="link" onClick={() => setViaPhone(true)}>📲 كمّل العد من الموبايل</button>}
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
            <span className="small" style={{ lineHeight: 1.8 }}>اضرب <b>فاتورة مبيعات</b> بالنواقص دي على برنامج البيع دلوقتي على حسابك. قيمتها هتطلع <b>عجز وردية</b> عليك عند التقفيل.</span>
            <button type="button" className={'btn full' + (invoice ? ' soft' : '')} style={{ height: 54 }} onClick={() => setInvoice(!invoice)}>
              {invoice ? '✓ ضربت الفاتورة على حسابي (عجز وردية)' : 'ضربت الفاتورة دي على حسابي'}
            </button>
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
            <span className="small">الأصناف الزيادة هيتعملها تسوية وتتعدل كميتها (من الدعم أو المحل).</span>
          </section>
        )}
        <span className="tiny muted">اتجرد مع {s.inName} · التقرير اتسجل في الجرد العشوائي بتاع الفرع.</span>
        <button type="button" className="btn full" style={{ height: 58 }} disabled={s.shortCount > 0 && !invoice} onClick={done}>
          {s.shortCount > 0 && !invoice ? 'اضرب فاتورة النواقص الأول' : 'تمام · كمّل التسليم'}
        </button>
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
