import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Modal, useToast } from '../ui.jsx';
import { WEEKDAYS, isAdminRole, todayKey } from '../lib';
import { computeDay, dayAt, effMs, flexHours, isVoid, nextDay, schedFor, weekday } from '../attDay.js';
import { logPlan, saveShifts, setOneDay } from '../attAdmin.js';

// جدول مواعيد الأسبوع لكل فرع (صاحب المحل والمدير): صف لكل واحد وعمود لكل يوم.
// الخانة بتوري ميعاده في اليوم ده (الوردية، إجازة، أو ميعاد خاص) وتحتها كان موجود فعلًا إمتى.
// الضغط على الخانة بيغيّر ميعاد اليوم ده بس (attDays.sched)، و«كرر الأسبوع» بينسخ الأسبوع على اللي بعده.

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#84cc16', '#f97316'];
const addDays = (day, n) => { let d = day; for (let i = 0; i < n; i++) d = nextDay(d); return d; };
const weekStart = (day) => { let d = day; while (weekday(d) !== 6) d = prevDay(d); return d; };
function prevDay(day) { const [y, m, d] = day.split('-').map(Number); return todayKey(new Date(y, m - 1, d - 1)); }
const h12 = (s) => { if (!s) return ''; const [h, m] = s.split(':').map(Number); const x = h % 12 || 12; return m ? `${x}:${String(m).padStart(2, '0')}` : String(x); };
const shortDay = (day) => { const [, m, d] = day.split('-').map(Number); return `${d}/${m}`; };

export default function WeekPlan({ shops, profile }) {
  const [start, setStart] = useState(() => weekStart(todayKey()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="wrap stack" style={{ gap: 16 }}>
      <div className="chips" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn sm soft" onClick={() => setStart(prevWeek(start))}>→ الأسبوع اللي فات</button>
        <strong>من {shortDay(days[0])} لـ {shortDay(days[6])}</strong>
        <button type="button" className="btn sm soft" onClick={() => setStart(addDays(start, 7))}>الأسبوع الجاي ←</button>
        {start !== weekStart(todayKey()) && <button type="button" className="link small" onClick={() => setStart(weekStart(todayKey()))}>الأسبوع ده</button>}
      </div>
      {shops.map((sh) => <ShopWeek key={sh.id + start} shop={sh} days={days} profile={profile} />)}
    </div>
  );
}
function prevWeek(day) { let d = day; for (let i = 0; i < 7; i++) d = prevDay(d); return d; }

const H = 3600e3;
const hOf = (day, ms) => (ms - dayAt(day, '00:00')) / H;
const hmOf = (h) => { const m = Math.round(h * 60); const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const hLabel = (h) => { const x = ((Math.round(h) % 24) + 24) % 24; return x === 0 ? '12 بالليل' : x === 12 ? '12 الضهر' : String(x % 12); };
const shiftSpan = (x) => { const [a1, a2] = x.start.split(':').map(Number), [b1, b2] = x.end.split(':').map(Number); const a = a1 + a2 / 60; let b = b1 + b2 / 60; if (b <= a) b += 24; return [a, b]; };

function ShopWeek({ shop, days, profile }) {
  const toast = useToast();
  const [pub, setPub] = useState(null);
  const [sched, setSched] = useState(null);
  const [dayDocs, setDayDocs] = useState({});
  const [recs, setRecs] = useState({});
  const [cell, setCell] = useState(null);
  const [defs, setDefs] = useState(false);
  const [rep, setRep] = useState(false);
  const [cp, setCp] = useState(false);
  const today = todayKey();
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const allDays = [...days, nextDay(days[6])];
  useEffect(() => { getDoc(doc(db, 'shopsPublic', shop.id)).then((s) => setPub(s.data() || {})).catch(() => setPub({})); }, [shop.id]);
  useEffect(() => onSnapshot(doc(db, 'attSched', shop.id), (s) => setSched(s.data() || {}), () => setSched({})), [shop.id]);
  useEffect(() => {
    const offs = days.map((d) => onSnapshot(doc(db, 'attDays', `${shop.id}_${d}`), (s) => setDayDocs((o) => ({ ...o, [d]: s.data() || {} })), () => setDayDocs((o) => ({ ...o, [d]: {} }))));
    const offs2 = allDays.map((d) => onSnapshot(query(collection(db, 'attendance'), where('shopId', '==', shop.id), where('day', '==', d)),
      (s) => setRecs((o) => ({ ...o, [d]: s.docs.map((x) => ({ id: x.id, ...x.data() })) })), () => setRecs((o) => ({ ...o, [d]: [] }))));
    return () => [...offs, ...offs2].forEach((f) => f());
  }, [shop.id, days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pub || !sched || days.some((d) => !dayDocs[d])) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const people = [...(pub.cashiers || []), ...(pub.workers || [])].filter((p, i, a) => p.uid && !p.disabled && a.findIndex((x) => x.uid === p.uid) === i);
  const shifts = sched.shifts || [];
  const colorOf = (uid) => COLORS[Math.max(0, people.findIndex((p) => p.uid === uid)) % COLORS.length];
  const save = (p, d, s) => setOneDay(profile, { shopId: shop.id, day: d, person: p, s }).then(() => toast('اتحفظ')).catch((e) => { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); });

  return (
    <section className="card">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 className="h2">📅 {pub.name || shop.name}</h2>
        <span className="chips" style={{ gap: 8 }}>
          <button type="button" className="btn sm soft" onClick={() => setCp(true)}>📋 انسخ اليوم ده</button>
          <button type="button" className="btn sm" onClick={() => setRep(true)}>🔁 كرر الأسبوع ده</button>
          <button type="button" className="btn sm soft" onClick={() => setDefs(true)}>⚙️ الورديات ومواعيدها</button>
        </span>
      </div>
      <div className="chips" style={{ gap: 6 }}>
        {days.map((d) => (
          <button key={d} type="button" className={'btn sm ' + (d === day ? '' : 'soft')} onClick={() => setDay(d)} style={{ minWidth: 70, outline: d === today ? '2px solid var(--blue)' : 'none' }}>
            {WEEKDAYS[weekday(d)]} <span className="tiny" style={{ opacity: 0.7 }}>{shortDay(d)}</span>
          </button>
        ))}
      </div>
      <DayEditor key={day} day={day} people={people} shifts={shifts} sched={sched} dayDoc={dayDocs[day]} colorOf={colorOf}
        records={[...(recs[day] || []), ...(recs[nextDay(day)] || [])]} onSave={(p, s) => save(p, day, s)} onOpen={(p, s, own) => setCell({ p, d: day, s, own })} />
      <WeekGlance days={days} day={day} setDay={setDay} people={people} sched={sched} dayDocs={dayDocs} colorOf={colorOf} />
      {people.length === 0 && <span className="muted">مفيش عمال أو كاشيرية في الفرع ده</span>}
      {cell && <CellModal cell={cell} shifts={shifts} onClose={() => setCell(null)} onSave={(s) => save(cell.p, cell.d, s).then(() => setCell(null))} />}
      {defs && <ShiftsModal shifts={shifts} onClose={() => setDefs(false)}
        onSave={(list) => saveShifts(profile, shop.id, list).then(() => { toast('اتحفظ'); setDefs(false); }).catch(() => toast('مش قادرين نحفظ، اتأكد من النت', 'err'))} />}
      {cp && <CopyDayModal day={day} days={days} people={people} sched={sched} dayDoc={dayDocs[day]} shop={shop} profile={profile} onClose={() => setCp(false)} />}
      {rep && <RepeatModal days={days} dayDocs={dayDocs} shop={shop} profile={profile} onClose={() => setRep(false)} />}
    </section>
  );
}

// خط اليوم: الوقت ماشي من اليمين للشمال زي الداش بورد. كل واحد ليه صف: الشريط الملوّن = ميعاده
// (اسحبه تنقله، اسحب طرفه تطوّله أو تقصّره، دوس عليه تختار وردية أو إجازة)، والخط الرفيع تحته = كان موجود فعلًا.
export function DayEditor({ day, people, shifts, sched, dayDoc, records, colorOf, onSave, onOpen }) {
  const [drag, setDrag] = useState(null);
  const now = Date.now();
  const rows = people.map((p) => {
    const s = schedFor(p.uid, day, sched, dayDoc);
    const c = day <= todayKey() ? computeDay({ uid: p.uid, day, records: records.filter((r) => r.uid === p.uid), sched, dayDoc }) : null;
    const mine = records.filter((r) => r.uid === p.uid && !isVoid(r)).sort((a, b) => effMs(a) - effMs(b));
    const open = mine.length > 0 && mine[mine.length - 1].kind === 'in';
    return { p, s, c, open, own: dayDoc?.sched?.[p.uid] };
  });
  const pts = [8, 24];
  shifts.forEach((x) => pts.push(...shiftSpan(x)));
  rows.forEach(({ s, c }) => { if (s && !s.off) pts.push(hOf(day, s.start), hOf(day, s.end)); if (c?.firstIn) pts.push(hOf(day, c.firstIn), hOf(day, c.lastOut || Math.min(now, c.firstIn + 18 * H))); });
  const S = Math.max(0, Math.floor(Math.min(...pts))), E = Math.min(S + 30, Math.ceil(Math.max(...pts)));
  const span = E - S, pos = (h) => ((Math.min(E, Math.max(S, h)) - S) / span) * 100;
  const step = span > 16 ? 2 : 1;
  const ticks = []; for (let h = S; h <= E; h += step) ticks.push(h);
  // التغطية: كام واحد ميعاده شغال كل نص ساعة
  const cov = []; for (let h = S; h < E; h += 0.5) cov.push(rows.filter(({ s }) => s && !s.off && hOf(day, s.start) <= h && hOf(day, s.end) >= h + 0.5).length);
  const covColor = (n) => (n === 0 ? '#FDECEA' : n === 1 ? '#FFE9A8' : '#BFE8CB');
  const nowH = hOf(day, now);

  const startDrag = (ev, row, mode) => {
    if (ev.button > 0) return;
    ev.stopPropagation();
    const track = ev.currentTarget.closest('[data-track]');
    const w = track.getBoundingClientRect().width;
    const a0 = hOf(day, row.s.start), b0 = hOf(day, row.s.end);
    const st = { uid: row.p.uid, a: a0, b: b0, moved: false };
    const x0 = ev.clientX;
    const el = ev.currentTarget; el.setPointerCapture?.(ev.pointerId);
    const move = (e) => {
      const dh = Math.round((-(e.clientX - x0) / w) * span * 4) / 4; // ربع ساعة
      if (Math.abs(e.clientX - x0) > 4) st.moved = true;
      if (!st.moved) return;
      if (mode === 'move') { const L = b0 - a0; st.a = Math.min(Math.max(S, a0 + dh), E - L, 23.75); st.b = st.a + L; }
      else if (mode === 'a') st.a = Math.max(S, Math.min(a0 + dh, st.b - 0.5, 23.75));
      else st.b = Math.min(E, st.a + 23.75, Math.max(b0 + dh, st.a + 0.5));
      setDrag({ ...st });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!st.moved) { onOpen(row.p, row.s, row.own); return; }
      if (st.a === a0 && st.b === b0) return;
      onSave(row.p, { start: hmOf(st.a), end: hmOf(st.b) });
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };

  return (
    <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 12 }}>
      <strong>{WEEKDAYS[weekday(day)]} {shortDay(day)}{day === todayKey() ? ' · النهارده' : ''}</strong>
      <span className="tiny muted">التغطية: كام واحد شغال في كل وقت</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ width: 96, flex: 'none' }} />
        <span style={{ position: 'relative', flex: 1, height: 10, display: 'flex', flexDirection: 'row', borderRadius: 5, overflow: 'hidden' }}>
          {cov.map((n, i) => <span key={i} title={`${hmOf(S + i / 2)}: ${n}`} style={{ flex: 1, background: covColor(n) }} />)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ width: 96, flex: 'none' }} />
        <span style={{ position: 'relative', flex: 1, height: 16 }}>
          {ticks.map((h) => <span key={h} className="tiny muted" style={{ position: 'absolute', right: pos(h) + '%', transform: 'translateX(50%)', whiteSpace: 'nowrap' }}>{hLabel(h)}</span>)}
        </span>
      </div>
      {rows.map((row) => {
        const { p, s, c, open, own } = row;
        const flexH = flexHours(p.uid, sched);
        const col = colorOf(p.uid);
        const d = drag?.uid === p.uid ? drag : null;
        const a = s && !s.off ? (d ? d.a : hOf(day, s.start)) : null, b = s && !s.off ? (d ? d.b : hOf(day, s.end)) : null;
        const inH = c?.firstIn ? hOf(day, c.firstIn) : null;
        const outH = c?.firstIn ? hOf(day, c.lastOut && !open ? c.lastOut : Math.min(now, c.firstIn + 18 * H)) : null;
        const seg = (x, y, style) => (y > x ? <span style={{ position: 'absolute', right: pos(x) + '%', width: (pos(y) - pos(x)) + '%', ...style }} /> : null);
        return (
          <div key={p.uid} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="small" style={{ width: 96, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, background: col, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flex: 'none' }}>{(p.name || '?')[0]}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </span>
            <span data-track="1" onClick={() => !s || s.off ? onOpen(p, s, own) : null}
              style={{ position: 'relative', flex: 1, height: 44, background: 'rgba(0,0,0,.03)', borderRadius: 10, cursor: !s || s.off ? 'pointer' : 'default' }}>
              {ticks.map((h) => <span key={h} style={{ position: 'absolute', right: pos(h) + '%', top: 0, bottom: 0, borderRight: '1px solid rgba(0,0,0,.06)' }} />)}
              {shifts.map((x, i) => { const [u, v] = shiftSpan(x); return <span key={x.id} style={{ position: 'absolute', right: pos(u) + '%', width: (pos(v) - pos(u)) + '%', top: 0, bottom: 0, background: i % 2 ? 'rgba(108,75,216,.04)' : 'rgba(20,121,211,.04)' }} />; })}
              {!s && <span className="tiny muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{flexH != null ? `⏳ مرن · ${flexH} ${flexH === 1 ? 'ساعة' : 'ساعات'} في اليوم${c?.workedMin ? ` · اشتغل ${Math.floor(c.workedMin / 60)}:${String(c.workedMin % 60).padStart(2, '0')}` : ''}` : '＋ دوس عشان تحط ميعاد'}</span>}
              {s?.off && <span className="tiny" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>🌴 إجازة · دوس تغيّر</span>}
              {a != null && (
                <span onPointerDown={(e) => startDrag(e, row, 'move')}
                  style={{ position: 'absolute', right: pos(a) + '%', width: (pos(b) - pos(a)) + '%', top: 4, height: 24, background: col, borderRadius: 8, color: '#fff', cursor: 'grab', touchAction: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: own ? '0 0 0 2px #fff, 0 0 0 3px ' + col : 'none' }}>
                  <span onPointerDown={(e) => startDrag(e, row, 'a')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, cursor: 'ew-resize', background: 'rgba(255,255,255,.25)' }} />
                  <span dir="ltr" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none', unicodeBidi: 'isolate' }}>{h12(hmOf(a))} – {h12(hmOf(b))}</span>
                  <span onPointerDown={(e) => startDrag(e, row, 'b')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 12, cursor: 'ew-resize', background: 'rgba(255,255,255,.25)' }} />
                </span>
              )}
              {flexH != null && a == null && (c?.pairs || []).map(([x, y, op], i) => <span key={'p' + i} style={{ display: 'contents' }}>{seg(hOf(day, x), hOf(day, y), { top: 32, height: 7, borderRadius: 4, background: '#2e9e5b', opacity: op ? 0.6 : 1 })}</span>)}
              {!(flexH != null && a == null) && inH != null && seg(inH, outH, { top: 32, height: 7, borderRadius: 4, background: '#2e9e5b', opacity: open ? 0.6 : 1 })}
              {inH != null && a != null && inH < a && seg(inH, Math.min(a, outH), { top: 32, height: 7, borderRadius: 4, background: '#f59e0b' })}
              {inH != null && a != null && outH > b && seg(Math.max(b, inH), outH, { top: 32, height: 7, borderRadius: 4, background: '#f59e0b' })}
              {inH != null && a == null && flexH == null && seg(inH, outH, { top: 32, height: 7, borderRadius: 4, background: '#f59e0b' })}
              {a != null && c?.late > 0 && seg(a, inH, { top: 32, height: 7, borderRadius: 4, background: 'repeating-linear-gradient(45deg, rgba(229,57,53,.7) 0 3px, transparent 3px 6px)' })}
              {a != null && c && !c.firstIn && (c.absent || c.forgotIn) && seg(a, Math.min(hOf(day, now), b), { top: 32, height: 7, borderRadius: 4, background: 'repeating-linear-gradient(45deg, rgba(229,57,53,.7) 0 3px, transparent 3px 6px)' })}
              {nowH > S && nowH < E && <span style={{ position: 'absolute', right: pos(nowH) + '%', top: -2, bottom: -2, borderRight: '2px solid var(--blue)' }} />}
            </span>
          </div>
        );
      })}
      <span className="tiny muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>الشريط = الميعاد (اسحبه تنقله، اسحب طرفه تغيّر المدة، دوس عليه تختار وردية أو إجازة)</span>
        <span style={{ color: '#2e9e5b' }}>▬ كان موجود</span>
        <span style={{ color: '#f59e0b' }}>▬ وقت زيادة</span>
        <span style={{ color: '#e53935' }}>▨ تأخير / مجاش</span>
        <span style={{ color: 'var(--blue)' }}>│ دلوقتي</span>
      </span>
    </div>
  );
}

// نظرة على الأسبوع: كل يوم خط صغير فيه مواعيد الكل، ودوس على اليوم تفتحه فوق
export function WeekGlance({ days, day, setDay, people, sched, dayDocs, colorOf }) {
  const S = 8, E = 32;
  return (
    <div className="stack" style={{ gap: 4, background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 12 }}>
      <strong className="small">نظرة على الأسبوع</strong>
      {days.map((d) => {
        const list = people.map((p) => ({ p, s: schedFor(p.uid, d, sched, dayDocs[d]) })).filter((x) => x.s && !x.s.off);
        const lane = 18 / Math.max(1, list.length);
        return (
          <button key={d} type="button" onClick={() => setDay(d)} style={{ display: 'flex', gap: 10, alignItems: 'center', border: 0, background: d === day ? 'rgba(59,130,246,.08)' : 'none', borderRadius: 8, padding: '2px 4px', cursor: 'pointer' }}>
            <span className="small" style={{ width: 92, flex: 'none', textAlign: 'start' }}>{WEEKDAYS[weekday(d)]} <span className="tiny muted">{shortDay(d)}</span></span>
            <span style={{ position: 'relative', flex: 1, height: 18, background: 'rgba(0,0,0,.03)', borderRadius: 4 }}>
              {list.map(({ p, s }, i) => {
                const a = Math.max(S, hOf(d, s.start)), b = Math.min(E, hOf(d, s.end));
                return b > a ? <span key={p.uid} title={p.name} style={{ position: 'absolute', right: ((a - S) / (E - S)) * 100 + '%', width: ((b - a) / (E - S)) * 100 + '%', top: i * lane, height: Math.max(2, lane - 1), background: colorOf(p.uid), borderRadius: 2 }} /> : null;
              })}
              {list.length === 0 && <span className="tiny muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>مفيش حد</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CellModal({ cell, shifts, onSave, onClose }) {
  const { p, d, s, own } = cell;
  const [f, setF] = useState({ start: s?.startHM || '09:00', end: s?.endHM || '17:00' });
  const [busy, setBusy] = useState(false);
  const go = (v) => { setBusy(true); onSave(v).finally(() => setBusy(false)); };
  return (
    <Modal title={`${p.name} · ${WEEKDAYS[weekday(d)]} ${shortDay(d)}`} onClose={onClose} width={420}>
      <div className="stack" style={{ gap: 10 }}>
        {shifts.map((x, i) => (
          <button key={x.id} type="button" className="btn soft" disabled={busy} onClick={() => go({ start: x.start, end: x.end })}
            style={{ justifyContent: 'space-between', borderInlineStart: `6px solid ${COLORS[i % COLORS.length]}` }}>
            <span>{x.name}</span><bdi className="small muted">{h12(x.start)} – {h12(x.end)}</bdi>
          </button>
        ))}
        <button type="button" className="btn soft" disabled={busy} onClick={() => go({ off: true })}>🌴 إجازة</button>
        <div className="chips" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 120 }}>من<input type="time" className="input" dir="ltr" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label className="field" style={{ width: 120 }}>لـ<input type="time" className="input" dir="ltr" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
          <button type="button" className="btn sm" disabled={busy || !f.start || !f.end || f.start === f.end} onClick={() => go({ start: f.start, end: f.end })}>ميعاد خاص</button>
        </div>
        {own && <button type="button" className="link small" disabled={busy} onClick={() => go(null)}>رجّعه لميعاده العادي</button>}
        {shifts.length === 0 && <span className="tiny muted">تقدر تعمل ورديات بأسامي (صباحي، مسائي…) من «⚙️ الورديات ومواعيدها» عشان تختار بضغطة.</span>}
      </div>
    </Modal>
  );
}

function ShiftsModal({ shifts, onSave, onClose }) {
  const [list, setList] = useState(shifts.length ? shifts : [{ id: 's1', name: 'صباحي', start: '09:00', end: '17:00' }, { id: 's2', name: 'مسائي', start: '17:00', end: '00:00' }]);
  const set = (i, k, v) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const ok = list.every((x) => x.name.trim() && x.start && x.end && x.start !== x.end);
  return (
    <Modal title="⚙️ الورديات ومواعيدها" onClose={onClose} width={480}>
      <div className="stack" style={{ gap: 8 }}>
        {list.map((x, i) => (
          <div key={x.id} className="chips" style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="اسم الوردية" value={x.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <input type="time" className="input" dir="ltr" style={{ width: 110 }} value={x.start} onChange={(e) => set(i, 'start', e.target.value)} />
            <input type="time" className="input" dir="ltr" style={{ width: 110 }} value={x.end} onChange={(e) => set(i, 'end', e.target.value)} />
            <button type="button" className="link small" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="btn sm soft" onClick={() => setList([...list, { id: 's' + Date.now(), name: '', start: '12:00', end: '20:00' }])}>＋ وردية زيادة</button>
        <span className="tiny muted">لو الوردية بتخلص بعد نص الليل (زي 5 لـ 12 بالليل) اكتبها عادي.</span>
        <button type="button" className="btn" disabled={!ok} onClick={() => onSave(list.map((x) => ({ ...x, name: x.name.trim() })))}>حفظ</button>
      </div>
    </Modal>
  );
}

// نسخ يوم على أيام تانية: اليوم اللي بيتنسخ عليه بيبقى شبهه بالظبط (ميعاد كل واحد أو إجازته).
// الأيام اللي اتعدلت قبل كده بتتساب، إلا لو اختار «اكتب عليها».
function CopyDayModal({ day, days, people, sched, dayDoc, shop, profile, onClose }) {
  const toast = useToast();
  const targets = [...days, ...days.map((d) => addDays(d, 7))].filter((d) => d !== day && d >= todayKey());
  const [sel, setSel] = useState(() => (targets.includes(nextDay(day)) ? [nextDay(day)] : []));
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const flip = (d) => setSel(sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d]);
  const src = {};
  people.forEach((p) => { const s = schedFor(p.uid, day, sched, dayDoc); if (s?.off) src[p.uid] = { off: true }; else if (s) src[p.uid] = { start: s.startHM, end: s.endHM }; });
  const go = async () => {
    if (!sel.length) { toast('اختار يوم واحد على الأقل', 'err'); return; }
    if (over && !window.confirm('متأكد؟ هيمسح التعديلات اللي في الأيام دي ويكتب عليها.')) return;
    setBusy(true);
    let copied = 0, skipped = 0;
    try {
      for (const to of sel.sort()) {
        const ref = doc(db, 'attDays', `${shop.id}_${to}`);
        const cur = (await getDoc(ref)).data() || {};
        if (!over && Object.keys(cur.sched || {}).length) { skipped++; continue; }
        await setDoc(ref, { shopId: shop.id, day: to, sched: src }, { mergeFields: ['shopId', 'day', 'sched'] });
        copied++;
      }
      await logPlan(profile, shop.id, `نسخ جدول يوم ${day} على: ${sel.join('، ')}${over ? ' (وكتب على المتعدّل)' : ''}`, day);
      toast(`اتنسخ ✅ ${copied} يوم${skipped ? ` · وسبت ${skipped} يوم كان متعدّل` : ''}`);
      onClose();
    } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); setBusy(false); }
  };
  return (
    <Modal title={`📋 انسخ يوم ${WEEKDAYS[weekday(day)]} ${shortDay(day)}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        <span className="small">اختار الأيام اللي عاوزها تبقى زي اليوم ده بالظبط:</span>
        <div className="chips" style={{ gap: 6 }}>
          {targets.map((d) => (
            <button key={d} type="button" className={'btn sm ' + (sel.includes(d) ? '' : 'soft')} onClick={() => flip(d)}>
              {sel.includes(d) ? '✓ ' : ''}{WEEKDAYS[weekday(d)]} <span className="tiny" style={{ opacity: 0.7 }}>{shortDay(d)}</span>
            </button>
          ))}
        </div>
        {targets.length === 0 && <span className="muted small">مفيش أيام جاية في الأسبوعين دول</span>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> اكتب على الأيام اللي اتعدلت قبل كده</label>
        <span className="tiny muted">من غير العلامة دي: أي يوم اتعدل قبل كده بيفضل زي ما هو.</span>
        <button type="button" className="btn" disabled={busy || !sel.length} onClick={go}>{busy ? 'لحظة…' : `انسخ على ${sel.length} ${sel.length === 1 ? 'يوم' : 'أيام'}`}</button>
      </div>
    </Modal>
  );
}

// نسخ تعديلات الأسبوع ده على الأسابيع اللي بعده. الأيام اللي اتعدلت قبل كده بتتساب، إلا لو اختار «اكتب عليها».
function RepeatModal({ days, dayDocs, shop, profile, onClose }) {
  const toast = useToast();
  const [y, m] = days[6].split('-').map(Number);
  const last = todayKey(new Date(y, m, 0));
  let def = 1; while (def < 8 && addDays(days[6], 7 * def) < last) def++;
  const [n, setN] = useState(def);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (over && !window.confirm('متأكد؟ هيمسح التعديلات اللي في الأيام دي ويكتب عليها.')) return;
    setBusy(true);
    let copied = 0, skipped = 0;
    try {
      for (let k = 1; k <= n; k++) {
        for (let i = 0; i < 7; i++) {
          const to = addDays(days[i], 7 * k);
          const ref = doc(db, 'attDays', `${shop.id}_${to}`);
          const cur = (await getDoc(ref)).data() || {};
          if (!over && Object.keys(cur.sched || {}).length) { skipped++; continue; }
          await setDoc(ref, { shopId: shop.id, day: to, sched: dayDocs[days[i]]?.sched || {} }, { mergeFields: ['shopId', 'day', 'sched'] });
          copied++;
        }
      }
      await logPlan(profile, shop.id, `كرر جدول أسبوع ${days[0]} على ${n} ${n === 1 ? 'أسبوع' : 'أسابيع'}${over ? ' (وكتب على المتعدّل)' : ''}`, days[0]);
      toast(`اتكرر ✅ ${copied} يوم${skipped ? ` · وسبت ${skipped} يوم كان متعدّل` : ''}`);
      onClose();
    } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); setBusy(false); }
  };
  return (
    <Modal title="🔁 كرر الأسبوع ده" onClose={onClose} width={440}>
      <div className="stack" style={{ gap: 12 }}>
        <span className="small">هينسخ جدول الأسبوع ده ({shortDay(days[0])} – {shortDay(days[6])}) على الأسابيع اللي بعده، وبعدها تقدر تغيّر أي يوم براحتك.</span>
        <label className="field">لحد إمتى
          <select className="input" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => <option key={k} value={k}>{k} {k === 1 ? 'أسبوع' : 'أسابيع'} (لحد {shortDay(addDays(days[6], 7 * k))})</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> اكتب على الأيام اللي اتعدلت قبل كده</label>
        <span className="tiny muted">من غير العلامة دي: أي يوم اتعدل قبل كده بيفضل زي ما هو.</span>
        <button type="button" className="btn" disabled={busy} onClick={go}>{busy ? 'لحظة…' : 'كرر'}</button>
      </div>
    </Modal>
  );
}

export const canPlan = (profile) => isAdminRole(profile.role) || ['owner', 'manager'].includes(profile.role);
