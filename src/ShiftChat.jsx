import { useEffect, useRef, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Icon, useToast } from './ui.jsx';
import { timeStr } from './lib';
import { logAct } from './activity.js';

// Chat between the accountant and the cashier, kept inside the shift.
// side = 'staff' or 'cashier'. A new message flags the other side on the shift doc.
export default function ShiftChat({ shift, profile, side, compact }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const box = useRef(null);

  useEffect(() => onSnapshot(query(collection(db, 'shifts', shift.id, 'messages'), orderBy('createdAt', 'asc')),
    (q) => setMsgs(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}), [shift.id]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs.length]);
  // Opening the chat clears this side's "new message" flag.
  useEffect(() => {
    const key = side === 'cashier' ? 'cashierUnread' : 'staffUnread';
    if (shift[key]) updateDoc(doc(db, 'shifts', shift.id), { [key]: false, ...(side === 'cashier' ? { cashierAttention: !!shift.reopenPending } : {}) }).catch(() => {});
  }, [shift.id, side, shift.cashierUnread, shift.staffUnread, shift.reopenPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await addDoc(collection(db, 'shifts', shift.id, 'messages'), { text: t, byUid: profile.id, byName: profile.name, side, createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString() });
      logAct('chat', `بعت رسالة في وردية ${shift.cashierName}: ${t.slice(0, 80)}`, { shopId: shift.shopId, shiftId: shift.id });
      await updateDoc(doc(db, 'shifts', shift.id), side === 'cashier'
        ? { staffUnread: true, lastMsg: { text: t.slice(0, 120), side, byName: profile.name, at: new Date().toISOString() } }
        : { cashierUnread: true, cashierAttention: true, lastMsg: { text: t.slice(0, 120), side, byName: profile.name, at: new Date().toISOString() } });
    } catch (e) { console.error(e); toast('الرسالة ما اتبعتتش، جرّب تاني', 'err'); setText(t); }
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={box} style={{ maxHeight: compact ? 280 : 380 }}>
        {msgs.length === 0 && <div className="tiny muted" style={{ textAlign: 'center', padding: 16 }}>{side === 'cashier' ? 'لو عندك سؤال للمحاسب عن الوردية دي اكتبه هنا' : 'اكتب للكاشير لو محتاج يوضّح حاجة في الوردية'}</div>}
        {msgs.map((m) => {
          const mine = m.side === side;
          return (
            <div key={m.id} className={'chat-msg' + (mine ? ' mine' : '')}>
              <span className="chat-who">{m.byName} · {m.side === 'cashier' ? 'الكاشير' : 'المحاسب'}</span>
              <span className="chat-text">{m.text}</span>
              <span className="chat-time">{timeStr(m.createdAt || m.createdAtLocal)}</span>
            </div>
          );
        })}
      </div>
      <form className="chat-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالة…" aria-label="رسالة" />
        <button type="submit" className="btn sm" disabled={!text.trim()} aria-label="ابعت"><Icon d="send" size={18} /></button>
      </form>
    </div>
  );
}
