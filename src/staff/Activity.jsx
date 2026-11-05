import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, Icon } from '../ui.jsx';
import { ROLE_LABEL, dateStr, timeStr, toDate, todayKey } from '../lib';

// Login & activity log: who opened the app, from which device, and every important step.
// Only Modaqqeq's owner and support can open this page (also enforced by the database rules).

const GROUPS = [
  { id: 'all', label: 'الكل', roles: null },
  { id: 'acc', label: 'المحاسبين', roles: ['accountant', 'reviewer'] },
  { id: 'cash', label: 'الكاشيرية', roles: ['cashier'] },
  { id: 'own', label: 'الأونر والمدير', roles: ['owner', 'manager'] },
  { id: 'adm', label: 'إدارة مدقق والدعم', roles: ['admin', 'support'] },
];
const LOOK = {
  login: { icon: 'lock', bg: '#22B07D', label: 'دخول' },
  open: { icon: 'eye', bg: '#7FB5FF', label: 'فتح' },
  logout: { icon: 'logout', bg: '#8A8FA8', label: 'خروج' },
  view: { icon: 'eye', bg: '#C9CEE6', label: 'صفحة' },
  branch: { icon: 'shop', bg: '#C9CEE6', label: 'فرع' },
  review_start: { icon: 'check', bg: '#1565D8' },
  close: { icon: 'check', bg: '#0E9F6E' },
  force: { icon: 'warn', bg: '#E5484D' },
  reopen: { icon: 'undo', bg: '#FF7A1A' },
  reclose: { icon: 'check', bg: '#1565D8' },
  photo: { icon: 'cam', bg: '#A07CFF' },
  fix: { icon: 'gear', bg: '#FF7A1A' },
  fix_photo: { icon: 'gear', bg: '#FF7A1A' },
  correction: { icon: 'plus', bg: '#FF7A1A' },
  post: { icon: 'check', bg: '#9DB7E8' },
  sales: { icon: 'cash', bg: '#1565D8' },
  ledger: { icon: 'cash', bg: '#E5484D' },
  chat: { icon: 'send', bg: '#4CC3FF' },
  receive: { icon: 'down', bg: '#22B07D' },
  receive_edit: { icon: 'gear', bg: '#FFB020' },
  handover: { icon: 'up', bg: '#1565D8' },
  entry: { icon: 'plus', bg: '#FFB020' },
  delete: { icon: 'trash', bg: '#E5484D' },
  xfer_send: { icon: 'swap', bg: '#A07CFF' },
  xfer_accept: { icon: 'swap', bg: '#22B07D' },
  reopen_done: { icon: 'check', bg: '#22B07D' },
  to_phone: { icon: 'phone', bg: '#4CC3FF' },
  password: { icon: 'lock', bg: '#E5484D' },
  photo_self: { icon: 'cam', bg: '#C9CEE6' },
};
const lookOf = (a) => LOOK[a] || (a.startsWith('cashier') || a.startsWith('staff') || a === 'setup' || a === 'access' ? { icon: 'gear', bg: '#6F4E37' } : { icon: 'dots', bg: '#8A8FA8' });
const shiftDay = (k, n) => { const d = new Date(`${k}T12:00:00`); d.setDate(d.getDate() + n); return todayKey(d); };
const tOf = (r) => toDate(r.at || r.atLocal);

export default function Activity({ shops, branch }) {
  const [day, setDay] = useState(todayKey());
  const [rows, setRows] = useState(null);
  const [group, setGroup] = useState('all');
  const [who, setWho] = useState(null);
  const [hideViews, setHideViews] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    setRows(null);
    return onSnapshot(query(collection(db, 'activity'), where('day', '==', day)),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tOf(b) - tOf(a))),
      (e) => { console.error(e); setRows([]); });
  }, [day]);

  const shopName = (id) => shops.find((s) => s.id === id)?.name || '';
  const inBranch = (r) => !branch || branch === 'all' || r.shopId === branch || (!r.shopId && (r.shopIds || []).includes(branch));
  const roles = GROUPS.find((g) => g.id === group)?.roles;
  const base = (rows || []).filter((r) => inBranch(r) && (!roles || roles.includes(r.role)));
  const people = useMemo(() => {
    const m = new Map();
    base.forEach((r) => {
      const p = m.get(r.uid) || { uid: r.uid, name: r.name, role: r.role, first: tOf(r), last: tOf(r), logins: 0, n: 0, devices: new Set() };
      if (tOf(r) < p.first) p.first = tOf(r);
      if (tOf(r) > p.last) p.last = tOf(r);
      if (r.action === 'login' || r.action === 'open') p.logins++;
      if (r.action !== 'view' && r.action !== 'branch') p.n++;
      if (r.deviceLabel || r.device) p.devices.add(`${r.device === 'mobile' ? '📱' : '💻'} ${r.deviceLabel || ''}`.trim());
      m.set(r.uid, p);
    });
    return [...m.values()].sort((a, b) => b.last - a.last);
  }, [rows, group, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = base.filter((r) => (!who || r.uid === who) && (!hideViews || (r.action !== 'view' && r.action !== 'branch'))
    && (!q.trim() || `${r.name} ${r.text} ${shopName(r.shopId)}`.includes(q.trim())));
  const isToday = day === todayKey();

  return (
    <div className="wrap">
      <div className="spread" data-tour="act-head">
        <div className="stack" style={{ gap: 2 }}>
          <h1 className="title">سجل الدخول والنشاط</h1>
          <span className="sub">مين دخل، امتى، من أنهي جهاز، وعمل إيه خطوة بخطوة · بيظهر ليك وللدعم بس</span>
        </div>
        <div className="act-day">
          <button type="button" className="icon-btn" aria-label="اليوم اللي قبله" onClick={() => setDay(shiftDay(day, -1))}><Icon d="chevron" size={18} /></button>
          <input className="input" type="date" value={day} max={todayKey()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="اليوم" />
          <button type="button" className="icon-btn" aria-label="اليوم اللي بعده" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))}><Icon d="chevron" size={18} style={{ transform: 'rotate(180deg)' }} /></button>
          {!isToday && <button type="button" className="btn soft sm" onClick={() => setDay(todayKey())}>النهارده</button>}
        </div>
      </div>

      <section className="card" style={{ gap: 12 }}>
        <div className="chips">
          {GROUPS.map((g) => <button key={g.id} type="button" className={'chip' + (group === g.id ? ' on' : '')} onClick={() => { setGroup(g.id); setWho(null); }}>{g.label}</button>)}
        </div>
        <div className="spread" style={{ gap: 10 }}>
          <input className="input" style={{ flex: '1 1 220px', maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم أو كلمة… (مثلًا: مسح، صورة، عجز)" aria-label="بحث" />
          <label className="act-toggle"><input type="checkbox" checked={!hideViews} onChange={(e) => setHideViews(!e.target.checked)} />اعرض فتح الصفحات واختيار الفروع كمان</label>
        </div>
      </section>

      <section className="card" style={{ gap: 10 }} data-tour="act-people">
        <div className="spread">
          <h2 className="h2">مين دخل {isToday ? 'النهارده' : `يوم ${dateStr(new Date(`${day}T12:00:00`))}`} <span className="muted" style={{ fontWeight: 500 }}>· {people.length}</span></h2>
          {who && <button type="button" className="btn soft sm" onClick={() => setWho(null)}>اعرض الكل</button>}
        </div>
        {rows === null && <span className="muted">بنحمّل…</span>}
        {rows && people.length === 0 && <div className="empty">محدش دخل في اليوم ده</div>}
        <div className="act-people">
          {people.map((p) => (
            <button key={p.uid} type="button" className={'act-person' + (who === p.uid ? ' on' : '')} onClick={() => setWho(who === p.uid ? null : p.uid)} aria-pressed={who === p.uid}>
              <Avatar name={p.name} size={44} color="#A07CFF" />
              <span className="stack" style={{ gap: 1, minWidth: 0, textAlign: 'right' }}>
                <strong className="ellipsis">{p.name}</strong>
                <span className="tiny muted">{ROLE_LABEL[p.role] || p.role} · {p.n} خطوة</span>
                <span className="tiny">من {timeStr(p.first)} لـ {timeStr(p.last)}</span>
                <span className="tiny muted ellipsis">{[...p.devices].join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ gap: 0 }} data-tour="act-list">
        <h2 className="h2" style={{ marginBottom: 6 }}>الخطوات <span className="muted" style={{ fontWeight: 500 }}>· {shown.length}</span></h2>
        {rows && shown.length === 0 && <div className="empty">مفيش حاجة هنا</div>}
        {shown.map((r) => {
          const L = lookOf(r.action);
          return (
            <div key={r.id} className={'act-row' + (r.action === 'login' || r.action === 'logout' ? ' strong' : '')}>
              <span className="act-time">{timeStr(tOf(r))}</span>
              <span className="act-ic" style={{ background: L.bg }}><Icon d={L.icon} size={16} /></span>
              <span className="stack" style={{ gap: 1, minWidth: 0, flex: 1 }}>
                <span><b>{r.name}</b> <span className="tiny muted">({ROLE_LABEL[r.role] || r.role})</span> {r.text}</span>
                <span className="tiny muted">{[shopName(r.shopId), `${r.device === 'mobile' ? '📱 موبايل' : '💻 كمبيوتر'}${r.deviceLabel ? ` · ${r.deviceLabel}` : ''}`].filter(Boolean).join(' · ')}</span>
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
