import { useEffect, useState } from 'react';
import { collection, doc, increment, onSnapshot, orderBy, query, limit as qLimit } from 'firebase/firestore';
import { db } from './firebase';

// What the shop owes each machine's rep (مندوب ممكن…): «شحن آجل» adds to it, «سداد لمندوب مكنة» takes it off.
// One document per shop: repDebts/{shopId} = { machines: { 'ممكن': 2000, … } }, plus a log of every change.

export function useRepDebts(shopId) {
  const [debts, setDebts] = useState({});
  useEffect(() => {
    if (!shopId) return undefined;
    return onSnapshot(doc(db, 'repDebts', shopId), (s) => setDebts(s.data()?.machines || {}), () => setDebts({}));
  }, [shopId]);
  return debts;
}

export function useRepDebtLog(shopId, n = 40) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!shopId) return undefined;
    return onSnapshot(query(collection(db, 'repDebts', shopId, 'log'), orderBy('atMs', 'desc'), qLimit(n)),
      (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setList([]));
  }, [shopId, n]);
  return list;
}

// Adds the debt change to a write batch. delta > 0: the shop owes more, delta < 0: paid.
export function addDebtChange(b, { shopId, machine, delta, shiftId = null, entryId = null, by, byName, note = '' }) {
  b.set(doc(db, 'repDebts', shopId), { machines: { [machine]: increment(delta) }, atMs: Date.now() }, { merge: true });
  b.set(doc(collection(db, 'repDebts', shopId, 'log')), { machine, delta, shiftId, entryId, by, byName: byName || '', note: String(note || '').slice(0, 200), atMs: Date.now() });
}
