import { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../ui.jsx';
import { fmt, num, todayKey } from '../lib';
import { useByShops } from './Reports.jsx';

export default function Ledger({ profile, shops, canReview }) {
  const toast = useToast();
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [kind, setKind] = useState('shortage');
  const rows = useByShops('ledger', shops, 'month', month);
  const shopName = (id) => shops.find((s) => s.id === id)?.name || '';
  const list = useMemo(() => rows.filter((r) => r.kind === kind).sort((a, b) => String(b.day).localeCompare(String(a.day))), [rows, kind]);
  const totals = useMemo(() => {
    const m = {};
    list.forEach((r) => { const c = (m[r.cashierName] ||= { name: r.cashierName, total: 0, pending: 0 }); c.total += num(r.amount); if (!r.confirmed) c.pending += num(r.amount); });
    return Object.values(m);
  }, [list]);

  const confirm = async (r) => {
    try {
      await updateDoc(doc(db, 'ledger', r.id), { confirmed: !r.confirmed, confirmedBy: profile.name, confirmedAt: serverTimestamp() });
      toast(r.confirmed ? 'اتلغى التأكيد' : (kind === 'shortage' ? 'اتأكد إن العجز اتخصم' : 'اتأكد'));
    } catch { toast('مش قادرين نحفظ', 'err'); }
  };

  return (
    <div className="wrap">
      <h1 className="title">العجز والزيادة</h1>
      <section className="card spread">
        <div className="chips">
          <button type="button" className={'chip' + (kind === 'shortage' ? ' on' : '')} onClick={() => setKind('shortage')}>سجل العجز</button>
          <button type="button" className={'chip' + (kind === 'overage' ? ' on' : '')} onClick={() => setKind('overage')}>سجل الزيادات</button>
        </div>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 190 }} aria-label="الشهر" />
      </section>
      <div className="row" style={{ gap: 16 }}>
        <section className="card grow" style={{ gap: 0 }}>
          {list.length === 0 && <div className="empty">مفيش {kind === 'shortage' ? 'عجز' : 'زيادات'} في الشهر ده</div>}
          {list.map((r) => (
            <div key={r.id} className="list-row">
              <span className="stack" style={{ gap: 1 }}>
                <strong>{r.cashierName}</strong>
                <span className="tiny muted">{shopName(r.shopId)} · {r.day} · سجّله {r.by}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: kind === 'shortage' ? '#9B1C1C' : 'var(--lime-ink)' }}>{fmt(r.amount)} ج</span>
                {kind === 'shortage' && (canReview
                  ? <button type="button" className={'chip sm' + (r.confirmed ? ' on' : '')} onClick={() => confirm(r)}>{r.confirmed ? `✓ اتخصم · ${r.confirmedBy || ''}` : 'تأكيد الخصم'}</button>
                  : <span className={'badge ' + (r.confirmed ? 'ok' : 'warn')}>{r.confirmed ? 'اتخصم' : 'لسه'}</span>)}
              </span>
            </div>
          ))}
        </section>
        <section className="card side">
          <h2 className="h2">الإجمالي لكل كاشير</h2>
          {totals.map((t) => (
            <div key={t.name} className="spread"><strong>{t.name}</strong><span>{fmt(t.total)} ج{kind === 'shortage' && t.pending ? <span className="badge warn" style={{ marginInlineStart: 6 }}>لسه {fmt(t.pending)}</span> : null}</span></div>
          ))}
          {totals.length === 0 && <span className="muted">—</span>}
        </section>
      </div>
    </div>
  );
}
