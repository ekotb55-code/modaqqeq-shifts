import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { logAct } from '../activity.js';
import { Avatar, Modal, useToast } from '../ui.jsx';
import { WEEKDAYS, isAdminRole, todayKey, toDate } from '../lib';
import { FALLBACK, KIND_LABEL, LATE_SYNC_MIN } from '../attendance.js';
import { EXTRA_LABEL, computeDay, dayAt, deductStr, effMs, isVoid, lateDeduct, minStr, nextDay, otHours, rulesOf } from '../attDay.js';
import { addManual, decideClaim, fixRecord, setExtra, setOneDay, voidRecord, deletePhoto, deleteRecord, deleteFace } from '../attAdmin.js';

// الحضور والانصراف: مين حضر ومين انصرف في يوم معيّن، بالصورة ووقت السيرفر، والحساب على حسب الميعاد.
// ⚠️ = محتاج مراجعة. ⏳ = محتاج قرار (الساعات الزيادة، أو «جيت الساعة كام»).
// تعديل الأوقات وإلغاء التسجيلات وإضافة تسجيل = صاحب الشغل بس، ومعاه السبب، وكله بيتسجل في «سجل التعديلات».

const hm = (d) => (d ? new Date(d).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '—');
const hm24 = (s) => { if (!s) return '—'; const [h, m] = s.split(':').map(Number); const d = new Date(2000, 0, 1, h, m); return hm(d.getTime()); };
const localInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const flagsOf = (r) => {
  const f = [];
  if (!r.photo && r.method !== 'manual') f.push('من غير صورة');
  if (r.method === 'pin' && r.fallback) f.push(`بالرقم السري: ${FALLBACK[r.fallback] || r.fallback}`);
  const at = toDate(r.at);
  if (!at) f.push('لسه مستني النت');
  else if (r.method !== 'manual' && Math.abs(at.getTime() - (r.atLocalMs || 0)) > LATE_SYNC_MIN * 60000) f.push(`اتسجل من غير نت أو ساعة الجهاز غلط (الجهاز قال ${hm(r.atLocalMs)})`);
  return f;
};

// نافذة صغيرة: وقت (اختياري) + السبب (إجباري)
function FixModal({ title, atMs, needTime = true, extra, onSave, onClose }) {
  const [v, setV] = useState(atMs ? localInput(atMs) : '');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (needTime && !v) { toast('اختار الوقت', 'err'); return; }
    if (!why.trim()) { toast('اكتب السبب', 'err'); return; }
    setBusy(true);
    try { await onSave(needTime ? new Date(v).getTime() : null, why.trim()); onClose(); } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        {extra}
        {needTime && <label className="field">الوقت<input type="datetime-local" className="input" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} /></label>}
        <label className="field">السبب (بيتسجل في سجل التعديلات)<input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="مثلاً: نسي يسجّل وأنا شايفه جه" /></label>
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'لحظة…' : 'حفظ'}</button>
      </div>
    </Modal>
  );
}

// مسح نهائي: الصورة بس أو التسجيل كله (صاحب الشغل بس، ومالوش رجوع)
function DelModal({ r, onClose, profile }) {
  const [what, setWhat] = useState(r.photo ? 'photo' : 'rec');
  const [why, setWhy] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    if (!why.trim()) { toast('اكتب السبب', 'err'); return; }
    setBusy(true);
    try { await (what === 'photo' ? deletePhoto : deleteRecord)(profile, r, why.trim()); toast('اتمسح نهائي'); onClose(); } catch (e) { console.error(e); toast('مش قادرين نمسح، اتأكد من النت', 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={`مسح نهائي · ${KIND_LABEL[r.kind]} ${r.name}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        {r.photo && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" checked={what === 'photo'} onChange={() => setWhat('photo')} /> امسح الصورة بس (الوقت يفضل متسجل)</label>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" checked={what === 'rec'} onChange={() => setWhat('rec')} /> امسح التسجيل كله (الوقت والصورة)</label>
        <label className="field">السبب (بيتسجل في سجل التعديلات)<input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="مثلاً: تسجيل تجربة" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> فاهم إن المسح ده مالوش رجوع</label>
        <button type="button" className="btn red" disabled={busy || !sure} onClick={go}>{busy ? 'لحظة…' : '🗑 امسح نهائي'}</button>
      </div>
    </Modal>
  );
}

// مسح بصمة الوش: لازم صاحب الشغل يكتب الباسورد بتاعه
function FaceDelModal({ r, profile, onClose }) {
  const [pw, setPw] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    if (!pw) { toast('اكتب الباسورد بتاعك', 'err'); return; }
    if (!why.trim()) { toast('اكتب السبب', 'err'); return; }
    setBusy(true);
    try { await deleteFace(profile, r, pw, why.trim()); toast('البصمة اتمسحت'); onClose(); }
    catch (e) { console.error(e); toast(['auth/invalid-credential', 'auth/wrong-password'].includes(e.code) ? 'الباسورد غلط' : e.code === 'auth/too-many-requests' ? 'محاولات كتير، استنى شوية' : 'مش قادرين نمسح، اتأكد من النت', 'err'); setBusy(false); }
  };
  return (
    <Modal title={`مسح بصمة وش ${r.name}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        <span className="small">البصمة هتتمسح نهائي. {r.name} هيسجّل وشّه من جديد، ولحد ما يعمل كده هيسجّل حضوره بالرقم السري.</span>
        <label className="field">السبب (بيتسجل في سجل التعديلات)<input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="مثلاً: البصمة مش بتتعرف عليه" /></label>
        <label className="field">الباسورد بتاعك (للتأكيد)<input type="password" className="input" dir="ltr" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <button type="button" className="btn red" disabled={busy} onClick={go}>{busy ? 'لحظة…' : '🗑 امسح البصمة'}</button>
      </div>
    </Modal>
  );
}

// تغيير الميعاد (العادي أو ليوم واحد)
function SchedModal({ title, person, cur, oneDay, onSave, onClose }) {
  const [f, setF] = useState({ start: cur?.start || cur?.startHM || '', end: cur?.end || cur?.endHM || '', dayOff: cur?.dayOff ?? null, off: !!cur?.off });
  const [why, setWhy] = useState('');
  const toast = useToast();
  const save = async (reset) => {
    try { await onSave(reset ? null : oneDay ? (f.off ? { off: true } : { start: f.start, end: f.end }) : { start: f.start, end: f.end, dayOff: f.dayOff }, why.trim()); onClose(); } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); }
  };
  return (
    <Modal title={`${title} · ${person.name}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        {oneDay && <label className="chips" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.off} onChange={(e) => setF({ ...f, off: e.target.checked })} style={{ width: 20, height: 20 }} />إجازة اليوم ده</label>}
        {!f.off && (
          <div className="chips" style={{ gap: 10 }}>
            <label className="field" style={{ width: 130 }}>بيبدأ<input type="time" className="input" dir="ltr" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            <label className="field" style={{ width: 130 }}>بيخلص<input type="time" className="input" dir="ltr" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
            {!oneDay && (
              <label className="field" style={{ width: 130 }}>يوم الإجازة
                <select className="input" value={f.dayOff ?? ''} onChange={(e) => setF({ ...f, dayOff: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">—</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {oneDay && <label className="field">السبب (اختياري)<input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="مثلاً: بلّغناه ييجي بدري" /></label>}
        <div className="chips" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => save(false)}>حفظ</button>
          {oneDay && cur?.oneDay && <button type="button" className="btn soft" onClick={() => save(true)}>رجّع ميعاده العادي</button>}
        </div>
        <span className="tiny muted">لو الميعاد بيخلص بعد نص الليل (زي 5 العصر لـ 12 بالليل) اكتبه عادي، والتطبيق هيفهم.</span>
      </div>
    </Modal>
  );
}

// تايم لاين اليوم: لكل واحد خط. الرمادي = ميعاده، الأخضر = كان موجود فعلًا (من الحضور للانصراف)،
// البرتقالي = وقت زيادة عن الميعاد، والأحمر المقطّع = تأخير. الضغط على أي خط بيوديك لتفاصيله تحت.
export function DayTimeline({ items, day }) {
  const now = Date.now();
  const pts = [];
  items.forEach(({ c }) => {
    if (c.sched && !c.sched.off) pts.push(c.sched.start, c.sched.end);
    if (c.firstIn) pts.push(c.firstIn, c.lastOut && !c.openNow ? c.lastOut : Math.min(now, c.firstIn + 18 * 3600e3));
  });
  if (!pts.length) return null;
  const H = 3600e3, base = dayAt(day, '00:00');
  let from = Math.floor((Math.min(...pts) - base) / H), to = Math.ceil((Math.max(...pts) - base) / H);
  if (to - from < 6) to = from + 6;
  const span = (to - from) * H, x = (ms) => `${Math.max(0, Math.min(100, ((ms - base - from * H) / span) * 100))}%`;
  const w = (a, b) => `calc(${x(b)} - ${x(a)})`;
  const step = to - from > 14 ? 2 : 1;
  const hours = []; for (let h = from; h <= to; h += step) hours.push(h);
  const nowIn = now > base + from * H && now < base + to * H;
  const bar = (a, b, style) => b <= a ? null : <span style={{ position: 'absolute', insetInlineStart: x(a), width: w(a, b), borderRadius: 6, ...style }} />;
  return (
    <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 12 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ width: 100, flex: 'none' }} />
        <span dir="ltr" style={{ position: 'relative', flex: 1, height: 16 }}>
          {hours.map((h) => <span key={h} className="tiny muted" style={{ position: 'absolute', left: x(base + h * H), transform: 'translateX(-50%)' }}>{((h % 24) + 24) % 24 % 12 || 12}</span>)}
        </span>
      </div>
      {items.map(({ p, c }) => {
        const s = c.sched && !c.sched.off ? c.sched : null;
        const end = c.firstIn ? (c.lastOut && !c.openNow ? c.lastOut : Math.min(now, c.firstIn + 18 * H)) : null;
        return (
          <button key={p.uid} type="button" onClick={() => document.getElementById('att-' + p.uid)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'start' }}>
            <span className="small" style={{ width: 100, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}{c.sched?.off ? ' · إجازة' : ''}
            </span>
            <span dir="ltr" style={{ position: 'relative', flex: 1, height: 26, background: 'rgba(0,0,0,.03)', borderRadius: 8 }}>
              {hours.map((h) => <span key={h} style={{ position: 'absolute', left: x(base + h * H), top: 0, bottom: 0, borderLeft: '1px solid rgba(0,0,0,.06)' }} />)}
              {s && bar(s.start, s.end, { top: 3, height: 20, background: 'rgba(0,0,0,.10)' })}
              {s && c.late > 0 && bar(s.start, c.firstIn, { top: 3, height: 20, background: 'repeating-linear-gradient(45deg, rgba(229,57,53,.55) 0 4px, transparent 4px 8px)' })}
              {s && !c.firstIn && (c.absent || c.forgotIn) && bar(s.start, Math.min(now, s.end), { top: 3, height: 20, background: 'repeating-linear-gradient(45deg, rgba(229,57,53,.55) 0 4px, transparent 4px 8px)' })}
              {c.flex != null && !s && (c.pairs || []).map(([x, y, open], i) => <span key={'p' + i} style={{ display: 'contents' }}>{bar(x, y, { top: 8, height: 10, background: '#2e9e5b', opacity: open ? 0.6 : 1 })}</span>)}
              {c.flex != null && !s && !c.firstIn && <span className="tiny muted" style={{ position: 'absolute', insetInlineStart: 6, top: 5 }}>مرن</span>}
              {!(c.flex != null && !s) && c.firstIn && bar(c.firstIn, end, { top: 8, height: 10, background: '#2e9e5b', opacity: c.openNow ? 0.6 : 1 })}
              {c.firstIn && s && c.firstIn < s.start && bar(c.firstIn, Math.min(s.start, end), { top: 8, height: 10, background: '#f59e0b' })}
              {c.firstIn && s && end > s.end && bar(Math.max(s.end, c.firstIn), end, { top: 8, height: 10, background: '#f59e0b' })}
              {c.firstIn && !s && c.flex == null && bar(c.firstIn, end, { top: 8, height: 10, background: '#f59e0b' })}
              {nowIn && <span style={{ position: 'absolute', left: x(now), top: -2, bottom: -2, borderLeft: '2px solid var(--blue)' }} />}
            </span>
          </button>
        );
      })}
      <span className="tiny muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>▬ <span style={{ color: 'rgba(0,0,0,.35)' }}>الميعاد</span></span>
        <span style={{ color: '#2e9e5b' }}>▬ كان موجود</span>
        <span style={{ color: '#f59e0b' }}>▬ وقت زيادة</span>
        <span style={{ color: '#e53935' }}>▨ تأخير / مجاش</span>
        <span style={{ color: 'var(--blue)' }}>│ دلوقتي</span>
      </span>
    </div>
  );
}

function ShopDay({ shop, day, profile }) {
  const toast = useToast();
  const role = profile.role;
  const canOwn = isAdminRole(role) || role === 'owner';
  const canBoss = canOwn || role === 'manager';
  const [rows, setRows] = useState(null);
  const [next, setNext] = useState([]);
  const [pub, setPub] = useState(null);
  const [sched, setSched] = useState(null);
  const [dayDoc, setDayDoc] = useState(null);
  const [rules, setRules] = useState(null);
  const [big, setBig] = useState(null);
  const [modal, setModal] = useState(null);
  const nd = nextDay(day);
  useEffect(() => { getDoc(doc(db, 'shopsPublic', shop.id)).then((s) => setPub(s.data() || {})).catch(() => setPub({})); }, [shop.id]);
  useEffect(() => onSnapshot(doc(db, 'attSched', shop.id), (s) => setSched(s.data() || {}), () => setSched({})), [shop.id]);
  useEffect(() => onSnapshot(doc(db, 'attRules', shop.id), (s) => setRules(rulesOf(s.data())), () => setRules(rulesOf(null))), [shop.id]);
  useEffect(() => onSnapshot(doc(db, 'attDays', `${shop.id}_${day}`), (s) => setDayDoc(s.data() || {}), () => setDayDoc({})), [shop.id, day]);
  useEffect(() => onSnapshot(query(collection(db, 'attendance'), where('shopId', '==', shop.id), where('day', '==', day)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('attendance', e.code); setRows([]); }), [shop.id, day]);
  useEffect(() => onSnapshot(query(collection(db, 'attendance'), where('shopId', '==', shop.id), where('day', '==', nd)),
    (s) => setNext(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setNext([])), [shop.id, nd]);

  if (!rows || !pub || !sched || !dayDoc || !rules) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const people = [...(pub.cashiers || []), ...(pub.workers || [])].filter((p, i, a) => p.uid && !p.disabled && a.findIndex((x) => x.uid === p.uid) === i);
  const shown = people.filter((p) => rows.some((r) => r.uid === p.uid) || sched.people?.[p.uid] || dayDoc.sched?.[p.uid]);
  const silent = people.filter((p) => !shown.includes(p));
  const run = (fn, ok = 'اتحفظ') => fn().then(() => toast(ok)).catch((e) => { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); });

  return (
    <section className="card">
      <h2 className="h2">{pub.name || shop.name}{!pub.attendance && <span className="tiny muted"> · الحضور مش شغال في الفرع ده (من الإعداد ← العمال)</span>}</h2>
      <DayTimeline day={day} items={shown.map((p) => {
        const c = computeDay({ uid: p.uid, day, records: [...rows, ...next].filter((r) => r.uid === p.uid), sched, dayDoc });
        const mine = [...rows, ...next].filter((r) => r.uid === p.uid && !isVoid(r)).sort((a, b) => effMs(a) - effMs(b));
        return { p, c: { ...c, openNow: mine.length > 0 && mine[mine.length - 1].kind === 'in' } };
      })} />
      <div className="stack" style={{ gap: 10 }}>
        {shown.map((p) => {
          const mine = [...rows, ...next].filter((r) => r.uid === p.uid);
          const list = rows.filter((r) => r.uid === p.uid).sort((a, b) => effMs(a) - effMs(b));
          const c = computeDay({ uid: p.uid, day, records: mine, sched, dayDoc });
          const s = c.sched;
          return (
            <div key={p.uid} id={'att-' + p.uid} className="stack" style={{ background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 10, gap: 8 }}>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="chips" style={{ gap: 10, alignItems: 'center' }}>
                  <Avatar name={p.name} photo={pub.photos?.[p.uid]} color={p.color} size={40} /><strong>{p.name}</strong>
                  <span className="badge" style={{ background: 'rgba(0,0,0,.06)' }}>{!s ? (c.flex != null ? `⏳ مرن · ${c.flex} ${c.flex === 1 ? 'ساعة' : 'ساعات'} في اليوم · اشتغل النهارده ${minStr(c.workedMin)}` : 'مالوش ميعاد') : s.off ? 'إجازة' : <>الميعاد <bdi>{hm(s.start)} – {hm(s.end)}</bdi></>}{s?.oneDay ? ' (ليوم واحد)' : ''}</span>
                </span>
                <span className="chips" style={{ gap: 6 }}>
                  {canBoss && <button type="button" className="link small" onClick={() => setModal({ t: 'oneday', p, cur: dayDoc.sched?.[p.uid] ? { ...dayDoc.sched[p.uid], oneDay: true } : s })}>تغيير الميعاد لليوم ده</button>}
                  {canOwn && <button type="button" className="link small" onClick={() => setModal({ t: 'add', p })}>+ تسجيل بإيدك</button>}
                </span>
              </div>
              <div className="chips" style={{ gap: 6 }}>
                {c.forgotIn && <span className="badge warn">⏰ لسه مسجلش حضور</span>}
                {c.absent && <span className="badge bad">غايب · خصم {deductStr({ v: rules.absentDays, unit: 'day' })}</span>}
                {c.late > 0 && <span className="badge warn">اتأخر {minStr(c.late)}{lateDeduct(c.late, rules) ? ` · خصم ${deductStr(lateDeduct(c.late, rules))}` : ''}</span>}
                {c.earlyLeave > 0 && <span className="badge warn">مشي بدري {minStr(c.earlyLeave)}</span>}
                {c.noOut && <span className="badge warn">⚠️ حضر ومنصرفش</span>}
                {c.extra > 0 && (
                  <span className={'badge' + (c.pending ? ' warn' : '')} style={{ whiteSpace: 'normal' }}>
                    {c.pending ? '⏳ ' : '✓ '}زيادة عن الميعاد {minStr(c.extra)}{c.earlyIn ? ` (جه بدري ${minStr(c.earlyIn)})` : ''}{c.stayLate ? ` (مشي متأخر ${minStr(c.stayLate)})` : ''}
                    {c.decision?.d === 'ot' && <> · بتتحسب {Math.round(otHours(c.extra, rules) * 10) / 10} ساعة</>}{c.decision && <> · {EXTRA_LABEL[c.decision.d]}{c.decision.byName ? ` (${c.decision.byName})` : ''}{c.covered ? ` غطّى ${minStr(c.covered)}` : ''}</>}
                  </span>
                )}
                {c.extra > 0 && canBoss && (c.pending ? (
                  <span className="chips" style={{ gap: 6 }}>
                    <button type="button" className="btn sm" onClick={() => run(() => setExtra(profile, { shopId: shop.id, day, person: p, d: 'ot', minutes: c.extra }))}>أوفر تايم</button>
                    <button type="button" className="btn sm soft" onClick={() => run(() => setExtra(profile, { shopId: shop.id, day, person: p, d: 'swap', minutes: c.extra }))}>تبديل</button>
                    <button type="button" className="btn sm soft" onClick={() => run(() => setExtra(profile, { shopId: shop.id, day, person: p, d: 'reject', minutes: c.extra }))}>رفض</button>
                  </span>
                ) : <button type="button" className="link small" onClick={() => run(() => setExtra(profile, { shopId: shop.id, day, person: p, d: null, minutes: c.extra }))}>غيّر القرار</button>)}
              </div>
              <div className="chips" style={{ gap: 10 }}>
                {list.map((r) => {
                  const fl = flagsOf(r);
                  const claimPending = r.claimAtMs && !r.fixState;
                  return (
                    <div key={r.id} className="stack" style={{ gap: 4, alignItems: 'center', width: 140, textAlign: 'center', opacity: isVoid(r) ? 0.45 : 1 }}>
                      {r.photo ? <button type="button" onClick={() => setBig(r)} style={{ border: 0, padding: 0, background: 'none' }}><img src={r.photo} alt="" style={{ width: 120, borderRadius: 14 }} /></button>
                        : <span style={{ width: 120, height: 90, borderRadius: 14, background: r.method === 'manual' ? 'rgba(0,0,0,.05)' : 'var(--warn-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.method === 'manual' ? '✍️' : '📷✗'}</span>}
                      <strong style={{ textDecoration: isVoid(r) ? 'line-through' : 'none' }}>{KIND_LABEL[r.kind]} <bdi>{hm(effMs(r))}</bdi></strong>
                      {r.method === 'face' && <span className="badge tiny">✓ بالوش</span>}
                      {r.method === 'manual' && <span className="badge tiny">✍️ اتضاف بإيد {r.fixByName}</span>}
                      {r.fixState === 'ok' && r.method !== 'manual' && <span className="tiny muted" style={{ whiteSpace: 'normal' }}>اتعدّل من <bdi>{hm(toDate(r.at)?.getTime() || r.atLocalMs)}</bdi> · {r.fixReason} ({r.fixByName})</span>}
                      {r.method === 'manual' && r.fixReason && <span className="tiny muted" style={{ whiteSpace: 'normal' }}>{r.fixReason}</span>}
                      {isVoid(r) && <span className="tiny muted" style={{ whiteSpace: 'normal' }}>اتلغى: {r.fixReason} ({r.fixByName})</span>}
                      {r.fixState === 'rejected' && <span className="tiny muted">اترفض الوقت اللي قاله</span>}
                      {claimPending && (
                        <span className="badge warn" style={{ whiteSpace: 'normal' }}>⏳ قال إنه جه الساعة <bdi>{hm(r.claimAtMs)}</bdi> ونسي يسجّل</span>
                      )}
                      {claimPending && canOwn && (
                        <span className="chips" style={{ gap: 4 }}>
                          <button type="button" className="btn sm" onClick={() => run(() => decideClaim(profile, r, true))}>موافق</button>
                          <button type="button" className="btn sm soft" onClick={() => run(() => decideClaim(profile, r, false))}>رفض</button>
                        </span>
                      )}
                      {fl.map((x) => <span key={x} className="badge warn tiny" style={{ whiteSpace: 'normal' }}>⚠️ {x}</span>)}
                      {canOwn && !isVoid(r) && (
                        <span className="chips" style={{ gap: 8 }}>
                          <button type="button" className="link small" onClick={() => setModal({ t: 'fix', r })}>تعديل</button>
                          <button type="button" className="link small" onClick={() => setModal({ t: 'void', r })}>إلغاء</button>
                        </span>
                      )}
                      {canOwn && <button type="button" className="link small" style={{ color: 'var(--red)' }} onClick={() => setModal({ t: 'del', r })}>🗑 مسح نهائي</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <span className="muted">مفيش تسجيلات في اليوم ده</span>}
        {silent.length > 0 && <span className="small muted">مالهمش ميعاد ومسجلوش: {silent.map((p) => p.name).join('، ')}</span>}
      </div>
      {big && (
        <Modal title={`${big.name} · ${KIND_LABEL[big.kind]} ${hm(effMs(big))}`} onClose={() => setBig(null)}>
          <img src={big.photo} alt="" style={{ width: '100%', borderRadius: 18 }} />
        </Modal>
      )}
      {modal?.t === 'fix' && <FixModal title={`تعديل ${KIND_LABEL[modal.r.kind]} ${modal.r.name}`} atMs={effMs(modal.r)} onClose={() => setModal(null)} onSave={(ms, why) => fixRecord(profile, modal.r, ms, why)} />}
      {modal?.t === 'del' && <DelModal r={modal.r} profile={profile} onClose={() => setModal(null)} />}
      {modal?.t === 'void' && <FixModal title={`إلغاء ${KIND_LABEL[modal.r.kind]} ${modal.r.name}`} needTime={false} onClose={() => setModal(null)} onSave={(_, why) => voidRecord(profile, modal.r, why)} />}
      {modal?.t === 'add' && <AddModal p={modal.p} day={day} sched={sched} dayDoc={dayDoc} onClose={() => setModal(null)}
        onSave={(kind, ms, why) => addManual(profile, { shopId: shop.id, shopName: pub.name || shop.name, person: modal.p, kind, day, atMs: ms, reason: why })} />}
      {modal?.t === 'oneday' && <SchedModal title={`ميعاد يوم ${day}`} person={modal.p} cur={modal.cur} oneDay onClose={() => setModal(null)}
        onSave={(s, why) => setOneDay(profile, { shopId: shop.id, day, person: modal.p, s, reason: why })} />}
    </section>
  );
}

function AddModal({ p, day, sched, dayDoc, onSave, onClose }) {
  const [kind, setKind] = useState('in');
  const s = sched.people?.[p.uid] || dayDoc.sched?.[p.uid];
  const def = s?.start ? dayAt(day, kind === 'in' ? s.start : s.end) : dayAt(day, '09:00');
  return (
    <FixModal key={kind} title={`تسجيل بإيدك · ${p.name}`} atMs={def} onClose={onClose} onSave={(ms, why) => onSave(kind, ms, why)}
      extra={(
        <div className="chips" style={{ gap: 8 }}>
          {['in', 'out'].map((k) => <button key={k} type="button" className={'btn sm' + (k === kind ? '' : ' soft')} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
      )} />
  );
}

// المواعيد العادية لكل الناس في الفرع (الكاشيرية والعمال)
function ShopLog({ shop }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    return onSnapshot(query(collection(db, 'attLog'), where('shopId', '==', shop.id)),
      // من غير ترتيب في السؤال (علشان ميحتاجش index)، وبنرتّب هنا
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.atLocalMs - a.atLocalMs).slice(0, 80)), (e) => { console.warn('attLog', e.code); setRows([]); });
  }, [shop.id, open]);
  return (
    <section className="card">
      <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>{open ? 'اقفل سجل التعديلات' : `📒 سجل تعديلات الحضور · ${shop.name}`}</button>
      {open && (rows === null ? <span className="muted">بنحمّل…</span> : rows.length === 0 ? <span className="muted">مفيش تعديلات</span> : (
        <div className="stack" style={{ gap: 4 }}>
          {rows.map((r) => (
            <span key={r.id} className="small"><bdi>{new Date(r.atLocalMs).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' })}</bdi> · <strong>{r.byName}</strong>: {r.text}{r.toMs ? <> ← <bdi>{hm(r.toMs)}</bdi></> : ''}{r.reason ? ` · السبب: ${r.reason}` : ''}</span>
          ))}
        </div>
      ))}
    </section>
  );
}

export default function AttendanceView({ shops, profile }) {
  const [day, setDay] = useState(todayKey());
  return (
    <div className="wrap stack" style={{ gap: 16 }}>
      <label className="field" style={{ width: 200 }}>اليوم<input type="date" className="input" dir="ltr" value={day} max={todayKey()} onChange={(e) => setDay(e.target.value || todayKey())} /></label>
      {shops.map((sh) => <ShopDay key={sh.id} shop={sh} day={day} profile={profile} />)}
      {shops.map((sh) => <ShopFaces key={'f' + sh.id} shop={sh} profile={profile} />)}
      {shops.map((sh) => <ShopLog key={'l' + sh.id} shop={sh} />)}
    </div>
  );
}

// الوشوش المتسجلة: صاحب المحل أو المدير يقارن صورة التسجيل بالشخص ويوافق. لو غلط يمسحها والشخص يسجّل تاني.
function ShopFaces({ shop, profile }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [del, setDel] = useState(null);
  const canOwn = isAdminRole(profile.role) || profile.role === 'owner';
  useEffect(() => onSnapshot(query(collection(db, 'faces'), where('shopId', '==', shop.id)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('faces', e.code); setRows([]); }), [shop.id]);
  if (!rows || rows.length === 0) return null;
  const approve = (r) => updateDoc(doc(db, 'faces', r.id), { approved: true, approvedBy: auth.currentUser?.uid || '', approvedAt: serverTimestamp() })
    .then(() => logAct('staff_edit', `وافق على تسجيل وش ${r.name}`, { shopId: shop.id })).catch(() => toast('مش قادرين نحفظ، اتأكد من النت', 'err'));
  const pending = rows.filter((r) => !r.approved);
  return (
    <section className="card">
      <h2 className="h2">الوشوش المتسجلة · {shop.name}{pending.length > 0 && <span className="badge warn" style={{ marginInlineStart: 8 }}>{pending.length} مستني موافقتك</span>}</h2>
      <span className="tiny muted">قارن الصورة بالشخص. لو هو، دوس «موافقة». لو مش هو (حد سجّل وش غيره)، امسحها.</span>
      <div className="chips" style={{ gap: 12 }}>
        {rows.sort((a, b) => Number(!!a.approved) - Number(!!b.approved)).map((r) => (
          <div key={r.id} className="stack" style={{ gap: 6, alignItems: 'center', width: 150, textAlign: 'center', background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 10 }}>
            {r.photo ? <img src={r.photo} alt="" style={{ width: 130, borderRadius: 14 }} /> : <Avatar name={r.name} size={80} />}
            <strong>{r.name}</strong>
            <span className="tiny muted">وافق على التصوير <bdi>{toDate(r.consentAt)?.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }) || '—'}</bdi></span>
            {r.approved ? <span className="badge">✓ متوافق عليه</span> : <button type="button" className="btn sm" onClick={() => approve(r)}>موافقة</button>}
            {canOwn && <button type="button" className="link small" style={{ color: 'var(--red)' }} onClick={() => setDel(r)}>🗑 امسح البصمة</button>}
          </div>
        ))}
      </div>
      {del && <FaceDelModal r={{ ...del, shopId: del.shopId || shop.id }} profile={profile} onClose={() => setDel(null)} />}
    </section>
  );
}
