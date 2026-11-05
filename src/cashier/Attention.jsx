import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import { ENTRY_TYPES, SRC_LABEL, dateStr, fmt, liveBalances, safeLabel, shopForRegister, timeStr } from '../lib';
import ShiftChat from '../ShiftChat.jsx';
import EntryModal from './EntryModal.jsx';
import { DeleteModal, entryTitle } from './Dash.jsx';
import { logAct } from '../activity.js';

// Shifts of this cashier that need him: a new message from the accountant, or a shift reopened for editing.
export function useAttention(uid) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(query(collection(db, 'shifts'), where('cashierUid', '==', uid), where('cashierAttention', '==', true)),
      (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setList([]));
  }, [uid]);
  return list;
}

export function AttentionBar({ list, onOpen, currentId }) {
  const items = list.filter((s) => s.id !== currentId || s.status === 'reopened' || s.cashierUnread);
  if (!items.length) return null;
  return (
    <div className="wrap" style={{ paddingBottom: 0 }}>
      {items.map((s) => (
        <button key={s.id} type="button" className="attention" onClick={() => onOpen(s)} style={{ background: s.status === 'reopened' ? '#1565D8' : '#FFB020' }}>
          <span className="ic"><Icon d={s.status === 'reopened' ? 'undo' : 'send'} size={20} /></span>
          <span className="stack" style={{ gap: 0, flexGrow: 1, textAlign: 'right' }}>
            <strong>{s.status === 'reopened' ? `المحاسب فتحلك وردية ${dateStr(s.openedAt || s.openedAtLocal)} تعدّلها` : `رسالة من المحاسب · وردية ${dateStr(s.openedAt || s.openedAtLocal)}`}</strong>
            <span className="small" style={{ opacity: 0.92 }}>{s.status === 'reopened' ? (s.reopenNote || 'ضيف أو امسح العمليات اللي محتاجة تتظبط') : s.lastMsg?.text || ''}</span>
          </span>
          <span className="chip sm" style={{ background: '#fff', color: '#1B1B2F' }}>افتح</span>
        </button>
      ))}
    </div>
  );
}

export function AttentionModal({ shift: initial, shop: fullShop, profile, onClose }) {
  const toast = useToast();
  const [shift, setShift] = useState(initial);
  const [entries, setEntries] = useState([]);
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'shifts', initial.id), (s) => s.exists() && setShift({ id: s.id, ...s.data() }), () => {}), [initial.id]);
  const editing = shift.status === 'reopened';
  useEffect(() => {
    if (!editing) return undefined;
    return onSnapshot(query(collection(db, 'shifts', initial.id, 'entries'), orderBy('createdAt', 'desc')),
      (q) => setEntries(q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.deleted)), () => {});
  }, [initial.id, editing]);
  const shop = shopForRegister(fullShop, shift.register);
  const balances = liveBalances(shift, entries, shop);

  const finish = async () => {
    try {
      await updateDoc(doc(db, 'shifts', shift.id), { status: 'submitted', reopenPending: false, cashierAttention: false, staffUnread: true, reopenDoneAt: serverTimestamp(), entryCount: entries.length, lastMsg: { text: 'الكاشير خلّص التعديل', side: 'cashier', byName: profile.name, at: new Date().toISOString() } });
      logAct('reopen_done', `خلّص تعديل الوردية المفتوحة وبعتها للمحاسب`, { shopId: shift.shopId, shiftId: shift.id });
      toast('التعديل اتبعت للمحاسب'); onClose();
    } catch (e) { console.error(e); toast('مش قادرين نبعت، اتأكد من النت', 'err'); }
  };

  return (
    <Modal title={editing ? `تعديل وردية ${dateStr(shift.openedAt || shift.openedAtLocal)}` : `وردية ${dateStr(shift.openedAt || shift.openedAtLocal)}`} icon={editing ? 'undo' : 'send'} color="var(--blue)" onClose={onClose} width={620}>
      {editing && (
        <div className="stack" style={{ gap: 10 }}>
          {shift.reopenNote && <div className="alert warn small">المحاسب كاتب: {shift.reopenNote}</div>}
          <div className="chips">
            <button type="button" className="chip" onClick={() => setModal('expense')}><Icon d="up" size={16} /> مصروف</button>
            <button type="button" className="chip" onClick={() => setModal('income')}><Icon d="down" size={16} /> إيراد</button>
            <button type="button" className="chip" onClick={() => setModal('transfer')}><Icon d="phone" size={16} /> تحويل محفظة</button>
          </div>
          <div className="stack" style={{ gap: 0, maxHeight: 280, overflow: 'auto' }}>
            {entries.length === 0 && <span className="tiny muted">مفيش عمليات</span>}
            {entries.map((e) => (
              <div key={e.id} className="feed-row">
                <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{entryTitle(e)}</span>
                  <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || SRC_LABEL[e.wallet] || safeLabel(e.src, shop)}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{ENTRY_TYPES[e.type]?.sign < 0 ? '−' : ENTRY_TYPES[e.type]?.sign > 0 ? '+' : ''}{fmt(e.amount)}</strong>
                  {!e.byAccountant && <button type="button" className="icon-btn del-btn" aria-label={`امسح ${entryTitle(e)}`} onClick={() => setDel(e)}><Icon d="trash" size={16} /></button>}
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="btn full" onClick={finish}><Icon d="check" size={18} />خلّصت التعديل · ابعت للمحاسب</button>
        </div>
      )}
      <h3 className="h2" style={{ fontSize: 16 }}>💬 الشات مع المحاسب</h3>
      <ShiftChat shift={shift} profile={profile} side="cashier" compact />
      {modal && <EntryModal type={modal} shop={shop} shift={shift} profile={profile} balances={balances} onClose={() => setModal(null)} />}
      {del && <DeleteModal entry={del} shift={shift} profile={profile} onClose={() => setDel(null)} />}
    </Modal>
  );
}
