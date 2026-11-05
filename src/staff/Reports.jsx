import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon } from '../ui.jsx';
import { diffText, durationStr, fmt, minutesBetween, num, todayKey, timeStr } from '../lib';
import { ShiftDetail } from './Review.jsx';

export function useByShops(coll, shops, field, value) {
  const [rows, setRows] = useState([]);
  const key = coll + shops.map((s) => s.id).join(',') + field + value;
  useEffect(() => {
    if (!value) { setRows([]); return undefined; }
    const map = {};
    const subs = shops.map((s) => onSnapshot(query(collection(db, coll), where('shopId', '==', s.id), where(field, '==', value)),
      (q) => { map[s.id] = q.docs.map((d) => ({ id: d.id, ...d.data() })); setRows(Object.values(map).flat()); },
      (e) => console.warn(coll, e.code)));
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rows;
}

export default function Reports({ profile, shops }) {
  const [mode, setMode] = useState('day');
  const [day, setDay] = useState(todayKey());
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [shopId, setShopId] = useState('all');
  const [openId, setOpenId] = useState(null);
  const chosen = shopId === 'all' ? shops : shops.filter((s) => s.id === shopId);
  const field = mode === 'day' ? 'day' : 'month';
  const value = mode === 'day' ? day : month;
  const shifts = useByShops('shifts', chosen, field, value);
  const reviews = useByShops('reviews', chosen, field, value);
  const ledger = useByShops('ledger', chosen, field, value);
  const shopName = (id) => shops.find((s) => s.id === id)?.name || '';
  const rev = (id) => reviews.find((r) => r.id === id);

  const rows = useMemo(() => shifts.map((s) => {
    const r = rev(s.id);
    const t = r?.totals || {};
    return { ...s, sales: r?.sales, diff: s.status === 'closed' ? (r?.diff ?? s.diff) : null, exp: t.expenses, insta: t.insta, vf: t.vf, cash: t.cash ?? (num(s.handover?.drawerTotal) + num(s.handover?.side)), mins: minutesBetween(s.openedAt || s.openedAtLocal, s.submittedAt) };
  }).sort((a, b) => String(a.openedAtLocal).localeCompare(String(b.openedAtLocal))), [shifts, reviews]); // eslint-disable-line react-hooks/exhaustive-deps

  const tot = (k) => rows.reduce((a, r) => a + num(r[k]), 0);

  const byCashier = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const c = (m[r.cashierName] ||= { name: r.cashierName, mins: 0, shifts: 0, short: 0, over: 0 });
      c.mins += r.mins || 0; c.shifts += 1;
    });
    ledger.forEach((l) => {
      const c = (m[l.cashierName] ||= { name: l.cashierName, mins: 0, shifts: 0, short: 0, over: 0 });
      if (l.kind === 'shortage') c.short += num(l.amount); else c.over += num(l.amount);
    });
    return Object.values(m);
  }, [rows, ledger]);

  const byAccountant = useMemo(() => {
    const m = {};
    // An accountant sees only his own performance; managers, owners and Modaqqeq see everyone.
    const mineOnly = ['accountant', 'reviewer'].includes(profile.role);
    reviews.filter((r) => r.closedAt && (!mineOnly || r.accountantUid === profile.id)).forEach((r) => {
      const a = (m[r.accountantName] ||= { name: r.accountantName, n: 0, close: 0, wait: 0 });
      a.n += 1; a.close += num(r.closeMinutes); a.wait += num(r.waitMinutes);
    });
    return Object.values(m);
  }, [reviews, profile.role, profile.id]);

  const openShift = rows.find((r) => r.id === openId);
  const hm = (mins) => `${Math.floor(mins / 60)} س ${mins % 60} د`;

  return (
    <div className="wrap">
      <div className="spread no-print">
        <h1 className="title">التقارير</h1>
        <button type="button" className="btn soft sm" onClick={() => window.print()}><Icon d="print" size={18} />طباعة</button>
      </div>
      <section className="card spread no-print" style={{ gap: 12 }}>
        <div className="chips">
          <button type="button" className={'chip' + (mode === 'day' ? ' on' : '')} onClick={() => setMode('day')}>تقرير يوم</button>
          <button type="button" className={'chip' + (mode === 'month' ? ' on' : '')} onClick={() => setMode('month')}>تقرير شهر</button>
        </div>
        <div className="chips">
          {mode === 'day' ? <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 190 }} aria-label="اليوم" />
            : <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 190 }} aria-label="الشهر" />}
          <select className="input" value={shopId} onChange={(e) => setShopId(e.target.value)} style={{ width: 220 }} aria-label="المحل">
            <option value="all">كل المحلات</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </section>

      <div className="print-area stack" style={{ gap: 16 }}>
        <div className="print-only spread"><img src="./modaqqeq-logo.png" alt="مدقق" style={{ height: 50 }} /><strong>{mode === 'day' ? `تقرير يوم ${day}` : `تقرير شهر ${month}`} · {shopId === 'all' ? 'كل المحلات' : shopName(shopId)}</strong></div>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          {[
            ['المبيعات', tot('sales')], ['المصروفات', tot('exp')], ['انستاباي', tot('insta')], ['فودافون كاش', tot('vf')],
            ['العجز', ledger.filter((l) => l.kind === 'shortage').reduce((a, l) => a + num(l.amount), 0)],
            ['الزيادة', ledger.filter((l) => l.kind === 'overage').reduce((a, l) => a + num(l.amount), 0)],
          ].map(([l, v], i) => (
            <div key={l} className={'counter ' + ['c-sky', 'c-orange', 'c-violet', 'c-pink', 'c-yellow', 'c-lime'][i]}><span className="small muted">{l}</span><span className="v">{fmt(v)}<span className="small muted" style={{ fontWeight: 500 }}> ج</span></span></div>
          ))}
        </div>

        <section className="card">
          <h2 className="h2">الورديات <span className="muted small" style={{ fontWeight: 500 }}>· {rows.length}</span></h2>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>المحل</th><th>الكاشير</th><th>اليوم</th><th>الوقت</th><th>المبيعات</th><th>المصروفات</th><th>انستاباي</th><th>فودافون</th><th>النقدية</th><th>النتيجة</th><th>الحالة</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id === openId ? null : r.id)} style={{ cursor: 'pointer', background: r.id === openId ? 'var(--bg)' : undefined }}>
                    <td>{shopName(r.shopId)}</td><td><b>{r.cashierName}</b></td><td>{r.day}</td>
                    <td>{timeStr(r.openedAt || r.openedAtLocal)} ← {r.submittedAt ? timeStr(r.submittedAt) : '…'}</td>
                    <td>{r.sales !== undefined && r.sales !== null ? fmt(r.sales) : '—'}</td><td>{fmt(r.exp)}</td><td>{fmt(r.insta)}</td><td>{fmt(r.vf)}</td><td>{fmt(r.cash)}</td>
                    <td><span className={'badge ' + (r.diff === null ? '' : r.diff < 0 ? 'bad' : r.diff > 0 ? 'ok' : 'info')}>{diffText(r.diff)}</span></td>
                    <td>{{ open: 'شغالة', submitted: 'مستنية مراجعة', reviewing: 'بتتراجع', closed: 'اتقفلت' }[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="empty">مفيش ورديات في الفترة دي</div>}
          </div>
        </section>

        <div className="row" style={{ gap: 16 }}>
          <section className="card" style={{ flex: '1 1 380px' }}>
            <h2 className="h2">الكاشيرية</h2>
            <table className="table">
              <thead><tr><th>الاسم</th><th>ورديات</th><th>ساعات الشغل</th><th>عجز</th><th>زيادة</th></tr></thead>
              <tbody>{byCashier.map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td>{c.shifts}</td><td>{hm(c.mins)}</td><td>{fmt(c.short)}</td><td>{fmt(c.over)}</td></tr>)}</tbody>
            </table>
            {byCashier.length === 0 && <div className="empty">—</div>}
          </section>
          <section className="card" style={{ flex: '1 1 380px' }}>
            <h2 className="h2">{['accountant', 'reviewer'].includes(profile.role) ? 'أدائي' : 'أداء المحاسبين'}</h2>
            <table className="table">
              <thead><tr><th>المحاسب</th><th>قفل</th><th>متوسط الانتظار قبل ما يبدأ</th><th>متوسط وقت التقفيل</th></tr></thead>
              <tbody>{byAccountant.map((a) => <tr key={a.name}><td><b>{a.name}</b></td><td>{a.n}</td><td>{Math.round(a.wait / a.n)} د</td><td>{Math.round(a.close / a.n)} د</td></tr>)}</tbody>
            </table>
            {byAccountant.length === 0 && <div className="empty">—</div>}
          </section>
        </div>
      </div>

      {openShift && (
        <div className="no-print">
          <h2 className="h2" style={{ margin: '8px 0' }}>تفاصيل وردية {openShift.cashierName} · {durationStr(openShift.openedAt || openShift.openedAtLocal, openShift.submittedAt)}</h2>
          <ShiftDetail shift={openShift} shop={shops.find((s) => s.id === openShift.shopId)} profile={profile} canReview={false} />
        </div>
      )}
    </div>
  );
}
