import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import { MAIN_REG, allOpen, fmt, num, registersOf, regName, shopSafes, timeStr } from '../lib';
import { SafePick } from './EntryModal.jsx';

// Money moving between two registers in the same shop (float from the main cashier,
// or a sub/delivery cashier handing his money to the main one). The receiver confirms.
export function usePendingTransfers(shopId) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!shopId) { setList([]); return undefined; }
    return onSnapshot(query(collection(db, 'transfers'), where('shopId', '==', shopId), where('status', '==', 'pending')),
      (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setList([]));
  }, [shopId]);
  return list;
}

export const regTitle = (shop, reg, open) => `${regName(shop, reg)}${open?.cashierName ? ` · ${open.cashierName}` : ''}`;

export function newTransfer({ shop, shift, profile, toReg, amount, kind, src = 'drawer', entryId = null }) {
  const opens = allOpen(shop);
  const target = opens.find((o) => o.reg === toReg);
  const fromReg = shift.register || MAIN_REG;
  return {
    shopId: shop.id, kind, status: 'pending', amount: num(amount), src,
    fromReg, fromRegName: regName(shop, fromReg), fromUid: profile.id, fromName: profile.name, fromShiftId: shift.id,
    toReg, toRegName: regName(shop, toReg), toNameHint: target?.cashierName || null,
    entryId, createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString(),
  };
}

export function SendModal({ shop, shift, profile, balances, onClose }) {
  const toast = useToast();
  const me = shift.register || MAIN_REG;
  const opens = allOpen(shop);
  const targets = [{ id: MAIN_REG }, ...registersOf(shop)].filter((r) => r.id !== me);
  const cash = shopSafes(shop).filter((x) => x.kind === 'cash');
  const [to, setTo] = useState(targets.length === 1 ? targets[0].id : '');
  const [src, setSrc] = useState(cash.length === 1 ? cash[0].key : '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!to) { toast('اختار الفلوس رايحة لمين', 'err'); return; }
    if (!src) { toast('اختار الفلوس طالعة منين', 'err'); return; }
    if (num(amount) <= 0) { toast('اكتب المبلغ', 'err'); return; }
    setBusy(true);
    const toOpen = opens.find((o) => o.reg === to);
    const eref = doc(collection(db, 'shifts', shift.id, 'entries'));
    const tref = doc(collection(db, 'transfers'));
    const b = writeBatch(db);
    b.set(tref, { ...newTransfer({ shop, shift, profile, toReg: to, amount, kind: me === MAIN_REG ? 'float' : 'cash', src, entryId: eref.id }), note: note.trim() });
    b.set(eref, {
      type: 'xfer_out', src, amount: num(amount), by: profile.id, byName: profile.name, transferId: tref.id,
      toReg: to, toName: regTitle(shop, to, toOpen), note: note.trim(),
      createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString(), posted: false,
    });
    const p = b.commit();
    try {
      if (navigator.onLine) await p; else p.catch(() => {});
      toast(`اتسجل · مستني ${toOpen?.cashierName || 'الكاشير'} يأكد إنه استلم`);
      onClose();
    } catch (e) { console.error(e); toast('حصلت مشكلة، جرّب تاني', 'err'); setBusy(false); }
  };

  return (
    <Modal title="فلوس لكاشير تاني" icon="swap" color="#4CC3FF" onClose={onClose}>
      <div className="stack">
        <span className="small muted">رايحة لمين؟</span>
        <div className="chips">
          {targets.map((r) => {
            const o = opens.find((x) => x.reg === r.id);
            return (
              <button key={r.id} type="button" className={'chip' + (to === r.id ? ' on' : '')} onClick={() => setTo(r.id)} style={{ height: 'auto', minHeight: 46, padding: '6px 16px', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.35 }}>
                <span>{regName(shop, r.id)}</span>
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>{o ? o.cashierName : 'لسه محدش فتحه'}</span>
              </button>
            );
          })}
        </div>
      </div>
      {cash.length > 1 && (
        <div className="stack">
          <span className="small muted">طالعة منين؟</span>
          <SafePick safes={cash} value={src} onPick={setSrc} balances={balances} />
        </div>
      )}
      <label className="field">المبلغ<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></label>
      <input className="input" placeholder="ملاحظة (اختياري): مثلًا فكة أول اليوم" value={note} onChange={(e) => setNote(e.target.value)} />
      <span className="tiny muted" style={{ lineHeight: 1.7 }}>المبلغ هيطلع من عندك دلوقتي، وهيظهر عند الكاشير التاني يأكد إنه استلمه.</span>
      <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'سجّل'}</button>
    </Modal>
  );
}

// Cards on the dashboard: money waiting for this register to confirm.
export function Incoming({ list, shop, shift, profile }) {
  const [open, setOpen] = useState(null);
  if (!list.length) return null;
  return (
    <section className="card" style={{ background: '#EAFBC2', gap: 10 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Icon d="down" />فلوس جاية ليك · أكّد إنك استلمتها</h2>
      {list.map((t) => (
        <div key={t.id} className="m-row" style={{ padding: '10px 14px', background: '#fff' }}>
          <span className="lbl">
            <span className="small"><b>{t.fromName}</b> · {t.fromRegName}</span>
            <span className="tiny muted">{t.kind === 'handover' ? 'تسليم آخر الوردية' : t.kind === 'float' ? 'فكة' : 'فلوس'} · {timeStr(t.createdAt || t.createdAtLocal)}{t.note ? ` · ${t.note}` : ''}</span>
          </span>
          <strong style={{ fontSize: 20 }}>{fmt(t.amount)} ج</strong>
          <button type="button" className="btn sm lime" onClick={() => setOpen(t)}>استلمت</button>
        </div>
      ))}
      {open && <AcceptModal t={open} shop={shop} shift={shift} profile={profile} onClose={() => setOpen(null)} />}
    </section>
  );
}

function AcceptModal({ t, shop, shift, profile, onClose }) {
  const toast = useToast();
  const cash = shopSafes(shop).filter((x) => x.kind === 'cash');
  const [same, setSame] = useState(true);
  const [amount, setAmount] = useState(String(t.amount));
  const [dest, setDest] = useState('drawer');
  const [busy, setBusy] = useState(false);
  const got = same ? num(t.amount) : num(amount);
  const diff = Math.round((got - num(t.amount)) * 100) / 100;

  const go = async () => {
    if (!same && amount === '') { toast('اكتب المبلغ اللي استلمته', 'err'); return; }
    setBusy(true);
    const b = writeBatch(db);
    const eref = doc(collection(db, 'shifts', shift.id, 'entries'));
    b.update(doc(db, 'transfers', t.id), {
      status: 'accepted', toUid: profile.id, toName: profile.name, toShiftId: shift.id,
      acceptedAmount: got, acceptedDiff: diff, acceptedAt: serverTimestamp(),
    });
    b.set(eref, {
      type: 'xfer_in', src: dest, amount: got, by: profile.id, byName: profile.name, transferId: t.id,
      fromName: `${t.fromName} (${t.fromRegName})`, fromReg: t.fromReg, sentAmount: num(t.amount), diffFromSent: diff,
      transferKind: t.kind, createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString(), posted: false,
    });
    const p = b.commit();
    try {
      if (navigator.onLine) await p; else p.catch(() => {});
      toast(diff ? `اتسجل · فيه فرق ${fmt(Math.abs(diff))} ج والمحاسب هيشوفه` : 'اتسجل إنك استلمت');
      onClose();
    } catch (e) { console.error(e); toast('حصلت مشكلة، جرّب تاني', 'err'); setBusy(false); }
  };

  return (
    <Modal title="استلام فلوس" icon="down" color="#B6F000" onClose={onClose} width={460}>
      <div className="m-row" style={{ padding: 12 }}>
        <span className="stack" style={{ gap: 0, flexGrow: 1 }}><strong>{t.fromName}</strong><span className="small muted">{t.fromRegName}</span></span>
        <strong style={{ fontSize: 20 }}>{fmt(t.amount)} ج</strong>
      </div>
      <div className="chips">
        <button type="button" className={'chip' + (same ? ' on' : '')} onClick={() => setSame(true)}>استلمت المبلغ ده بالظبط</button>
        <button type="button" className={'chip' + (!same ? ' on' : '')} onClick={() => setSame(false)}>المبلغ مختلف</button>
      </div>
      {!same && (
        <label className="field">استلمت كام؟<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onFocus={(e) => e.target.select()} autoFocus /></label>
      )}
      {!same && diff !== 0 && <span className={'badge ' + (diff < 0 ? 'bad' : 'warn')}>{diff < 0 ? `ناقص ${fmt(-diff)} ج` : `زيادة ${fmt(diff)} ج`} عن اللي اتبعت · المحاسب هيشوف الفرق</span>}
      {cash.length > 1 && (
        <div className="stack">
          <span className="small muted">حطيتها فين؟</span>
          <SafePick safes={cash} value={dest} onPick={setDest} />
        </div>
      )}
      <button type="button" className="btn full" onClick={go} disabled={busy}>{busy ? 'لحظة…' : 'تأكيد'}</button>
    </Modal>
  );
}
