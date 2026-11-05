import { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../ui.jsx';
import { fmt, num, todayKey } from '../lib';
import { useByShops } from './Reports.jsx';
import { logAct } from '../activity.js';

export default function Ledger({ profile, shops, canReview }) {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [kind, setKind] = useState('shortage');
  const rows = useByShops('ledger', shops, 'month', month);
  const shopName = (id) => shops.find((s) => s.id === id)?.name || '';
  const list = useMemo(() => rows.filter((r) => r.kind === kind).sort((a, b) => String(b.day).localeCompare(String(a.day))), [rows, kind]);
  const totals = useMemo(() => {
    const m = {};
    list.filter((r) => r.status !== 'found').forEach((r) => { const v = num(r.adjustedAmount ?? r.amount); const c = (m[r.cashierName] ||= { name: r.cashierName, total: 0, pending: 0 }); c.total += v; if (!r.confirmed) c.pending += v; });
    return Object.values(m);
  }, [list]);


  return (
    <div className="wrap">
      <h1 className="title">العجز والزيادة</h1>
      <section className="card spread" data-tour="ledger-filter">
        <div className="chips">
          <button type="button" className={'chip' + (kind === 'shortage' ? ' on' : '')} onClick={() => setKind('shortage')}>سجل العجز</button>
          <button type="button" className={'chip' + (kind === 'overage' ? ' on' : '')} onClick={() => setKind('overage')}>سجل الزيادات</button>
        </div>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 190 }} aria-label="الشهر" />
      </section>
      <div className="row" style={{ gap: 16 }}>
        <section className="card grow" style={{ gap: 0 }}>
          {list.length === 0 && <div className="empty">مفيش {kind === 'shortage' ? 'عجز' : 'زيادات'} في الشهر ده</div>}
          {list.map((r) => <LedgerRow key={r.id} r={r} kind={kind} shopName={shopName(r.shopId)} canReview={canReview} profile={profile} />)}
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

const STATUS = { pending: ['لسه', 'warn'], deducted: ['اتخصم', 'ok'], found: ['اتلقى · اتلغى', 'info'] };

function LedgerRow({ r, kind, shopName, canReview, profile }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(r.reason || '');
  const [adj, setAdj] = useState(r.adjustedAmount ?? r.amount);
  const status = r.status || (r.confirmed ? 'deducted' : 'pending');
  const amount = num(r.adjustedAmount ?? r.amount);
  const save = async (patch, msg) => {
    try { await updateDoc(doc(db, 'ledger', r.id), { ...patch, reviewedBy: profile.name, reviewedAt: serverTimestamp() }); logAct('ledger', `${msg} · ${kind === 'shortage' ? 'عجز' : 'زيادة'} ${r.cashierName} ${fmt(amount)} ج (${r.day})`, { shopId: r.shopId, shiftId: r.shiftId }); toast(msg); } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="spread">
        <button type="button" onClick={() => setOpen(!open)} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'right' }} aria-expanded={open}>
          <strong>{r.cashierName}</strong>
          <span className="tiny muted" style={{ display: 'block' }}>{shopName} · {r.day} · سجّله {r.by}{r.reason ? ` · ${r.reason}` : ''}</span>
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: kind === 'shortage' ? '#9B1C1C' : 'var(--lime-ink)', textDecoration: status === 'found' ? 'line-through' : 'none' }}>{fmt(amount)} ج</span>
          {r.adjustedAmount !== undefined && num(r.adjustedAmount) !== num(r.amount) && <span className="tiny muted">كان {fmt(r.amount)}</span>}
          <span className={'badge ' + STATUS[status][1]}>{STATUS[status][0]}</span>
        </span>
      </div>
      {open && canReview && (
        <div className="stack" style={{ background: 'var(--bg)', borderRadius: 18, padding: 12, marginTop: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '2 1 240px' }}>السبب / المراجعة<input className="input white" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلًا مصروف مش متسجل، غلطة في العد" /></label>
            <label className="field" style={{ flex: '1 1 120px' }}>المبلغ بعد المراجعة<input className="input white" inputMode="decimal" dir="ltr" value={adj} onChange={(e) => setAdj(e.target.value)} /></label>
            <button type="button" className="btn sm" onClick={() => save({ reason: reason.trim(), adjustedAmount: num(adj) }, 'اتحفظ')}>حفظ</button>
          </div>
          <div className="chips">
            {kind === 'shortage' && <button type="button" className={'chip sm' + (status === 'deducted' ? ' on' : '')} onClick={() => save({ status: status === 'deducted' ? 'pending' : 'deducted', confirmed: status !== 'deducted', confirmedBy: profile.name }, status === 'deducted' ? 'اتلغى التأكيد' : 'اتأكد إن العجز اتخصم')}>{status === 'deducted' ? '✓ اتخصم' : 'تأكيد الخصم'}</button>}
            <button type="button" className={'chip sm' + (status === 'found' ? ' on' : '')} onClick={() => save({ status: status === 'found' ? 'pending' : 'found', confirmed: false }, status === 'found' ? 'رجع للمراجعة' : 'اتسجل إنه اتلقى')}>{status === 'found' ? '✓ اتلقى' : kind === 'shortage' ? 'العجز اتلقى' : 'الزيادة اتعرف سببها'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
