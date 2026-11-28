import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../ui.jsx';
import { computeShift, fmt, num, billsTotal, machineKey } from '../lib';
import { logAct } from '../activity.js';
import { pushEvent } from '../cloud.js';

// ───────── فرق الاستلام ─────────
// الكاشير اللي مستلم عدّ حاجة غير اللي اتسلّمت (مثلًا فئة الـ5: اتسلّم 10 واتعدّ 30):
// بيتعمل طلب للمحاسب. لو اعتمده، تسليم الوردية اللي قبلها بيتعدّل بأرقام المستلم ونتيجتها بتتحسب من جديد
// (عجز يقل، أو زيادة). لو رفضه، مفيش حاجة بتتغيّر.

const faceLabel = (f) => (num(f) < 1 ? `${num(f) * 100} قرش` : `${f} ج`);

// بيتنادي من شاشة الاستلام: يرجّع بنود الفرق (فاضية لو مفيش فرق)
export function receiveGapItems({ last, bills, prevBills, side, prevSide, machines, vis, mvals, prevMachines, walletKeys, wallets, prevWallets }) {
  if (!last?.shiftId) return [];
  const items = [];
  if (!last.keepDrawer || last.keepDrawer === 'stay') {
    Object.keys(bills).forEach((f) => {
      const from = num(prevBills[f]); const to = num(bills[f]);
      if (from !== to) items.push({ kind: 'bill', key: String(f), label: `فئة ${faceLabel(f)}`, from, to, money: Math.round((to - from) * num(f) * 100) / 100, unit: 'قطعة' });
    });
  }
  if ((!last.keepSide || last.keepSide === 'stay') && num(side) !== num(prevSide)) {
    items.push({ kind: 'side', key: 'side', label: 'الجانبي', from: num(prevSide), to: num(side), money: Math.round((num(side) - num(prevSide)) * 100) / 100, unit: 'ج' });
  }
  vis.forEach((i) => {
    if (String(mvals[i] ?? '').trim() === '' || num(mvals[i]) === num(prevMachines[i])) return;
    const m = machines[i];
    items.push({ kind: 'machine', key: machineKey(m), label: `${m.machine} · ${m.account}`, from: num(prevMachines[i]), to: num(mvals[i]), money: Math.round((num(mvals[i]) - num(prevMachines[i])) * 100) / 100, unit: 'ج' });
  });
  walletKeys.forEach((w) => {
    if (String(wallets[w.key] ?? '').trim() === '' || num(wallets[w.key]) === num(prevWallets[w.key])) return;
    items.push({ kind: 'wallet', key: w.key, label: w.label, from: num(prevWallets[w.key]), to: num(wallets[w.key]), money: Math.round((num(wallets[w.key]) - num(prevWallets[w.key])) * 100) / 100, unit: 'ج' });
  });
  return items;
}

// الكاش بس (الفئات + الجانبي) — ده اللي بيأثر على العجز والزيادة مباشرة
export const gapCash = (items) => Math.round((items || []).filter((x) => x.kind === 'bill' || x.kind === 'side').reduce((a, x) => a + num(x.money), 0) * 100) / 100;

// تسليم الوردية اللي قبل بعد ما ناخد أرقام المستلم
function patchedHandover(h, items) {
  const out = { ...h, bills: { ...(h.bills || {}) }, machines: (h.machines || []).map((m) => ({ ...m })), walletsTyped: { ...(h.walletsTyped || {}) } };
  items.forEach((x) => {
    if (x.kind === 'bill') out.bills[x.key] = num(x.to);
    if (x.kind === 'side') out.side = num(x.to);
    if (x.kind === 'machine') { const m = out.machines.find((y) => machineKey(y) === x.key); if (m) m.value = num(x.to); }
    if (x.kind === 'wallet') out.walletsTyped[x.key] = num(x.to);
  });
  out.drawerTotal = billsTotal(out.bills);
  return out;
}

const diffText = (d) => (num(d) < 0 ? `عجز ${fmt(-num(d))} ج` : num(d) > 0 ? `زيادة ${fmt(num(d))} ج` : 'مظبوطة');

async function approveGap(g, profile, shop) {
  const sSnap = await getDoc(doc(db, 'shifts', g.fromShiftId));
  if (!sSnap.exists()) throw new Error('الوردية اللي سلّمت مش موجودة');
  const shift = { id: sSnap.id, ...sSnap.data() };
  if (!shift.handover) throw new Error('الوردية اللي سلّمت لسه متسلّمتش');
  const newH = patchedHandover(shift.handover, g.items);
  const b = writeBatch(db);
  const fixes = [...(shift.receiveGapFixes || []), { gapId: g.id, by: profile.name, atMs: Date.now(), cash: gapCash(g.items), toCashier: g.toCashier || '' }];
  let result = null;
  if (shift.status === 'closed') {
    // النتيجة الجديدة = القديمة + أثر التعديل (بنحسب الوردية بالتسليم القديم والجديد ونطرح)
    const [eSnap, rSnap] = await Promise.all([getDocs(collection(db, 'shifts', shift.id, 'entries')), getDoc(doc(db, 'reviews', shift.id))]);
    const entries = eSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sales = rSnap.exists() ? rSnap.data().sales : null;
    const before = computeShift(shift, entries, shop, sales).diff;
    const after = computeShift({ ...shift, handover: newH }, entries, shop, sales).diff;
    const delta = before === null || after === null ? gapCash(g.items) : after - before;
    result = Math.round((num(shift.diff) + delta) * 100) / 100;
    b.update(doc(db, 'shifts', shift.id), { handover: newH, diff: result, receiveGapFixes: fixes });
    if (rSnap.exists()) b.update(doc(db, 'reviews', shift.id), { diff: result });
    if (Math.abs(result) >= 0.01) {
      b.set(doc(db, 'ledger', shift.id), {
        shopId: shift.shopId, shiftId: shift.id, cashierUid: shift.cashierUid, cashierName: shift.cashierName, day: shift.day, month: shift.month,
        kind: result < 0 ? 'shortage' : 'overage', amount: Math.abs(result), confirmed: false, ackRequired: result < 0, createdAt: serverTimestamp(), by: profile.name,
        note: `اتعدّل بفرق استلام ${g.toCashier || ''}`.trim(),
      });
    } else if (Math.abs(num(shift.diff)) >= 0.01) b.delete(doc(db, 'ledger', shift.id));
  } else {
    // لسه بتتراجع: التسليم يتعدّل والمحاسب هيقفلها بالأرقام الجديدة
    b.update(doc(db, 'shifts', shift.id), { handover: newH, receiveGapFixes: fixes });
  }
  b.update(doc(db, 'receiveGaps', g.id), { status: 'approved', decidedBy: profile.name, decidedAt: serverTimestamp(), result });
  await b.commit();
  const what = g.items.map((x) => `${x.label} ${x.from}→${x.to}`).join('، ');
  logAct('receive_gap', `اعتمد فرق استلام ${g.toCashier} من ${g.fromCashier}: ${what}${result !== null ? ` · وردية ${g.fromCashier} بقت ${diffText(result)}` : ''}`, { shopId: g.shopId, shiftId: g.fromShiftId });
  if (shift.cashierUid) {
    pushEvent({ type: 'close', shopId: g.shopId, shiftId: shift.id, to: 'cashier', toUid: shift.cashierUid, title: 'اتعدّل تسليم ورديتك',
      body: `${g.toCashier} عدّ ${what}${result !== null ? ` · ورديتك بقت ${diffText(result)}` : ''}` });
  }
  return result;
}

// للمحاسب: طلبات فرق الاستلام المستنية
export function ReceiveGapsCard({ shops, profile }) {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState('');
  const ids = shops.map((s) => s.id).join(',');
  useEffect(() => {
    if (!ids) return undefined;
    const map = {};
    const subs = shops.map((s) => onSnapshot(query(collection(db, 'receiveGaps'), where('shopId', '==', s.id), where('status', '==', 'pending')),
      (q) => { map[s.id] = q.docs.map((d) => ({ id: d.id, ...d.data() })); setList(Object.values(map).flat().sort((a, b) => num(b.atMs) - num(a.atMs))); },
      (e) => console.warn('receiveGaps', e.code)));
    return () => subs.forEach((u) => u());
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  const shopOf = (id) => shops.find((s) => s.id === id);

  const approve = async (g) => {
    if (!window.confirm(`تعتمد الفرق؟ تسليم وردية ${g.fromCashier} هيتعدّل بأرقام ${g.toCashier} ونتيجتها هتتحسب من جديد.`)) return;
    setBusy(g.id);
    try { const r = await approveGap(g, profile, shopOf(g.shopId)); toast(r === null ? '✓ اتعدّل التسليم · هيتحسب لما الوردية تتقفل' : `✓ وردية ${g.fromCashier} بقت ${diffText(r)}`); }
    catch (e) { console.error(e); toast(e.message && /[؀-ۿ]/.test(e.message) ? e.message : 'مش قادرين نعتمده · جرّب تاني', 'err'); }
    setBusy('');
  };
  const reject = async (g) => {
    if (!window.confirm('ترفض الفرق؟ وردية اللي سلّم مش هتتغيّر.')) return;
    setBusy(g.id);
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'receiveGaps', g.id), { status: 'rejected', decidedBy: profile.name, decidedAt: serverTimestamp() });
      await b.commit();
      logAct('receive_gap', `رفض فرق استلام ${g.toCashier} من ${g.fromCashier}`, { shopId: g.shopId, shiftId: g.toShiftId });
      toast('اترفض');
    } catch (e) { console.error(e); toast('مش قادرين نحفظ', 'err'); }
    setBusy('');
  };

  return (
    <section className="card" style={{ gap: 10, background: '#FFF7E6', border: '1px solid #F5D9A8' }}>
      <h2 style={{ fontSize: 17, fontWeight: 700 }}>🔁 فرق في الاستلام <span className="muted" style={{ fontWeight: 500 }}>· {list.length}</span></h2>
      <span className="tiny muted" style={{ lineHeight: 1.7 }}>الكاشير اللي استلم عدّ غير اللي اتسلّم. لو اعتمدت، تسليم الوردية اللي قبله بيتعدّل بأرقامه ونتيجتها بتتحسب من جديد.</span>
      {list.map((g) => {
        const cash = gapCash(g.items);
        return (
          <div key={g.id} className="card" style={{ gap: 6, padding: 12 }}>
            <strong>{g.toCashier} استلم من {g.fromCashier} {shops.length > 1 ? <span className="tiny muted">· {shopOf(g.shopId)?.name}</span> : null}</strong>
            {(g.items || []).map((x, i) => (
              <span key={i} className="spread small">
                <span>{x.label}: اتسلّم <b>{fmt(x.from)}</b> · اتعدّ <b>{fmt(x.to)}</b> {x.unit === 'قطعة' ? 'قطعة' : ''}</span>
                <b style={{ color: x.money >= 0 ? '#1B7F3B' : '#B3261E' }}>{x.money >= 0 ? '+' : ''}{fmt(x.money)} ج</b>
              </span>
            ))}
            {cash !== 0 && <span className="small">على كاش الوردية: <b style={{ color: cash > 0 ? '#1B7F3B' : '#B3261E' }}>{cash > 0 ? `+${fmt(cash)} ج لصالح ${g.fromCashier}` : `${fmt(cash)} ج على ${g.fromCashier}`}</b></span>}
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button type="button" className="btn sm" onClick={() => approve(g)} disabled={busy === g.id}>{busy === g.id ? 'لحظة…' : '✓ اعتمد'}</button>
              <button type="button" className="btn soft sm" onClick={() => reject(g)} disabled={busy === g.id}>✗ ارفض</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
