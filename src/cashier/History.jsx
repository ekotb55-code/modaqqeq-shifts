import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { dateStr, diffText, durationStr, fmt, num, timeStr, todayKey } from '../lib';

const SHORT = {
  submitted: { label: 'مستنية المحاسب', cls: 'warn' },
  reviewing: { label: 'بتتراجع', cls: 'dark' },
  reopened: { label: 'مفتوحة لك تعدّل', cls: 'info' },
  closed: { label: 'اتقفلت', cls: 'ok' },
};

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
};

export default function History({ profile, onBack, onOpen }) {
  const [month, setMonth] = useState(todayKey(new Date()).slice(0, 7));
  const [tab, setTab] = useState('shifts');
  const [shifts, setShifts] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [err, setErr] = useState(false);
  const thisMonth = todayKey(new Date()).slice(0, 7);

  useEffect(() => {
    setShifts(null);
    setLedger(null);
    setErr(false);
    const a = onSnapshot(
      query(collection(db, 'shifts'), where('cashierUid', '==', profile.id), where('month', '==', month)),
      (q) => setShifts(q.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => { console.warn('history shifts', e.code); setShifts([]); setErr(true); },
    );
    const b = onSnapshot(
      query(collection(db, 'ledger'), where('cashierUid', '==', profile.id), where('month', '==', month)),
      (q) => setLedger(q.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => { console.warn('history ledger', e.code); setLedger([]); },
    );
    return () => { a(); b(); };
  }, [profile.id, month]);

  const rows = useMemo(() => (shifts || [])
    .filter((s) => s.status !== 'open')
    .sort((x, y) => String(y.openedAtLocal || '').localeCompare(String(x.openedAtLocal || ''))), [shifts]);
  const shortages = useMemo(() => (ledger || [])
    .filter((l) => l.kind === 'shortage')
    .sort((x, y) => String(y.day || '').localeCompare(String(x.day || ''))), [ledger]);
  const totalShort = shortages.reduce((a, l) => a + num(l.amount), 0);
  const waitingShort = shortages.filter((l) => !l.confirmed).reduce((a, l) => a + num(l.amount), 0);

  const resultBadge = (s) => {
    if (s.status !== 'closed' || typeof s.diff !== 'number') return null;
    const st = s.diff < 0 ? { background: 'var(--red-soft)', color: '#9B1C1C' } : s.diff > 0 ? { background: 'var(--lime-soft)', color: 'var(--lime-ink)' } : { background: 'var(--blue-soft)', color: '#144F86' };
    return <span style={{ ...st, borderRadius: 999, padding: '3px 12px', fontSize: 13, fontWeight: 700 }}>{diffText(s.diff)}</span>;
  };

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="title">سجلي</h1>
          <span className="sub">تسليماتك والعجز المسجّل عليك. دوس على أي وردية تتابعها.</span>
        </div>
        <button type="button" className="btn soft sm" onClick={onBack}>رجوع</button>
      </div>

      <section className="card" style={{ gap: 14 }}>
        <div className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="chips">
            <button type="button" className={'chip' + (tab === 'shifts' ? ' on' : '')} onClick={() => setTab('shifts')}>التسليمات</button>
            <button type="button" className={'chip' + (tab === 'short' ? ' on' : '')} onClick={() => setTab('short')}>العجز</button>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn soft sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="الشهر اللي قبله">‹</button>
            <strong style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(month)}</strong>
            <button type="button" className="btn soft sm" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="الشهر اللي بعده">›</button>
          </span>
        </div>

        {err && <div className="alert warn small">مش قادرين نجيب السجل، اتأكد من النت أو كلّم الدعم.</div>}

        {tab === 'shifts' && (
          <>
            {shifts === null && <div className="empty">بنحمّل…</div>}
            {shifts !== null && rows.length === 0 && !err && <div className="empty">مفيش تسليمات في الشهر ده</div>}
            {rows.map((s) => {
              const st = SHORT[s.status] || SHORT.submitted;
              return (
                <button key={s.id} type="button" className="list-row" onClick={() => onOpen(s.id)} style={{ width: '100%', textAlign: 'right', cursor: 'pointer', background: 'none', border: 'none', flexWrap: 'wrap', gap: 10 }}>
                  <span className="stack" style={{ gap: 2, flex: '1 1 220px' }}>
                    <strong>{dateStr(s.openedAt || s.openedAtLocal)}{s.registerName && s.register !== 'main' ? ` · ${s.registerName}` : ''}</strong>
                    <span className="tiny muted">{timeStr(s.openedAt || s.openedAtLocal)} ← {s.submittedAt ? timeStr(s.submittedAt) : '—'} · {durationStr(s.openedAt || s.openedAtLocal, s.submittedAt)}</span>
                  </span>
                  {resultBadge(s)}
                  <span className={'badge ' + st.cls}>{st.label}</span>
                </button>
              );
            })}
          </>
        )}

        {tab === 'short' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={{ background: 'var(--red-soft)', color: '#9B1C1C', borderRadius: 18, padding: 14 }}>
                <div className="small" style={{ fontWeight: 600 }}>إجمالي العجز</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(totalShort)} ج</div>
              </div>
              <div style={{ background: 'var(--chip)', borderRadius: 18, padding: 14 }}>
                <div className="small muted" style={{ fontWeight: 600 }}>لسه ما اتخصمش</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(waitingShort)} ج</div>
              </div>
            </div>
            {ledger === null && <div className="empty">بنحمّل…</div>}
            {ledger !== null && shortages.length === 0 && <div className="empty">مفيش عجز مسجّل عليك في الشهر ده</div>}
            {shortages.map((l) => (
              <button key={l.id} type="button" className="list-row" onClick={() => l.shiftId && onOpen(l.shiftId)} style={{ width: '100%', textAlign: 'right', cursor: l.shiftId ? 'pointer' : 'default', background: 'none', border: 'none', flexWrap: 'wrap', gap: 10 }}>
                <span className="stack" style={{ gap: 2, flex: '1 1 200px' }}>
                  <strong>عجز وردية {l.day}</strong>
                  <span className="tiny muted">سجّله المحاسب {l.by || ''}</span>
                </span>
                <strong style={{ fontSize: 17 }}>{fmt(l.amount)} ج</strong>
                <span className={'badge ' + (l.confirmed ? 'ok' : 'warn')}>{l.confirmed ? 'اتخصم' : 'لسه ما اتخصمش'}</span>
              </button>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
