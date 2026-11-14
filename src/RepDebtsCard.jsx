import { useState } from 'react';
import { writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { useToast } from './ui.jsx';
import { fmt, num, repTopupOf } from './lib';
import { addDebtChange, useRepDebtLog, useRepDebts } from './repDebt.js';

// What the shop owes the machine reps, with every change. The accountant can fix a number (e.g. an old debt from before the app).
export default function RepDebtsCard({ shop, profile, canEdit }) {
  const toast = useToast();
  const debts = useRepDebts(shop.id);
  const log = useRepDebtLog(shop.id, 30);
  // المكن اللي «بتستقبل رصيد من مندوب»، وأي مكنة لسه عليها دين
  const names = [...new Set([...(shop.machines || []).filter((m) => repTopupOf(m)).map((m) => m.machine), ...Object.keys(debts).filter((n) => num(debts[n]))])].filter(Boolean);
  const [edit, setEdit] = useState(null); // { machine, value, note }
  const [open, setOpen] = useState(false);
  const any = names.some((n) => num(debts[n])) || log.length;
  if (!names.length || (!any && !canEdit)) return null;
  const save = async () => {
    const delta = Math.round((num(edit.value) - num(debts[edit.machine])) * 100) / 100;
    if (!delta) { setEdit(null); return; }
    if (!edit.note.trim()) { toast('اكتب السبب', 'err'); return; }
    const b = writeBatch(db);
    addDebtChange(b, { shopId: shop.id, machine: edit.machine, delta, by: profile.id, byName: profile.name, note: `تعديل من المحاسب: ${edit.note.trim()}` });
    try { await b.commit(); toast('اتعدّل'); setEdit(null); } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  const when = (ms) => new Date(ms).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <section className="card" style={{ gap: 12 }}>
      <h2 className="h2">⏳ ديون المندوبين <span className="tiny muted" style={{ fontWeight: 500 }}>· شحن آجل لسه ماتسددش</span></h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {names.map((n) => (
          <div key={n} className="stack" style={{ flex: '1 1 150px', background: num(debts[n]) > 0 ? '#FFF6C9' : '#F1F0F7', borderRadius: 18, padding: '10px 14px', gap: 4 }}>
            <span className="tiny" style={{ fontWeight: 700 }}>مندوب {n}</span>
            <strong style={{ fontSize: 22 }}>{fmt(debts[n] || 0)} ج</strong>
            {canEdit && <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({ machine: n, value: String(num(debts[n])), note: '' })}>عدّل الرقم</button>}
          </div>
        ))}
      </div>
      {edit && (
        <div className="row" style={{ gap: 10, alignItems: 'flex-end', background: '#F7F6FB', borderRadius: 16, padding: 12 }}>
          <label className="field" style={{ flex: '1 1 140px' }}>الدين الصح لمندوب {edit.machine}<input className="input" inputMode="decimal" dir="ltr" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></label>
          <label className="field" style={{ flex: '2 1 200px' }}>السبب<input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="مثلًا: دين قديم قبل التطبيق" /></label>
          <button type="button" className="btn" onClick={save}>احفظ</button>
          <button type="button" className="link" onClick={() => setEdit(null)}>إلغاء</button>
        </div>
      )}
      {log.length > 0 && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>كل الحركات ({log.length})</summary>
          <div className="stack" style={{ gap: 0, marginTop: 6 }}>
            {log.map((x) => (
              <div key={x.id} className="list-row" style={{ gap: 10 }}>
                <span className={'badge ' + (x.delta > 0 ? 'warn' : 'ok')} style={{ minWidth: 70, justifyContent: 'center' }}>{x.delta > 0 ? 'شحن آجل' : 'سداد'}</span>
                <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>مندوب {x.machine} · {x.delta > 0 ? '+' : '−'}{fmt(Math.abs(x.delta))} ج</strong>
                  <span className="tiny muted">{when(x.atMs)} · {x.byName}{x.note && !['شحن آجل', 'سداد'].includes(x.note) ? ` · ${x.note}` : ''}</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
