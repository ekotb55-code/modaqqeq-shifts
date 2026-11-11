import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, WALLET_LOOK, WalletMark, useToast } from '../ui.jsx';
import { SRC_LABEL, fmt } from '../lib';
import { logAct } from '../activity.js';
import { feed } from '../notify.jsx';

// Transfers that reached the shop owner's wallet (the bank SMS on his phone is forwarded here
// by a small app on his phone, through our free script). The cashier says "this one is my customer's"
// and it is recorded as a wallet transfer — no screenshot needed, the bank already confirmed it.

const HIDE = 'mdq-sms-hide';
const readHidden = () => { try { return JSON.parse(localStorage.getItem(HIDE) || '[]'); } catch { return []; } };
const DAY = 24 * 3600 * 1000;

export function useWalletIn(shopId, wallets, uid) {
  const [list, setList] = useState([]);
  const [hidden, setHidden] = useState(readHidden);
  useEffect(() => {
    if (!shopId) return undefined;
    return onSnapshot(query(collection(db, 'walletIn'), where('shopId', '==', shopId), where('status', '==', 'new')),
      (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.warn('walletIn', e.code));
  }, [shopId]);
  const fresh = list
    .filter((s) => (s.atMs || 0) > Date.now() - 1.5 * DAY && (!wallets || wallets.includes(s.wallet)))
    .sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  const shown = fresh.filter((s) => !hidden.includes(s.id));
  // A new one: bell + sound like any other notification.
  const keys = fresh.map((s) => s.id).join(',');
  useEffect(() => {
    if (!uid) return undefined;
    const t = setTimeout(() => feed(uid, 'sms', fresh.map((s) => ({
      key: 'sms:' + s.id, emoji: '💰', color: '#7B2FBE', title: `وصل تحويل ${fmt(s.amount)} ج على ${SRC_LABEL[s.wallet] || 'المحفظة'}`,
      body: `من ${s.fromName || 'عميل'} · لو ده عميلك أكّده من الصفحة الرئيسية`, atMs: s.atMs,
    }))), 1500);
    return () => clearTimeout(t);
  }, [keys, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const hide = (id) => {
    const next = [...readHidden(), id].slice(-200);
    try { localStorage.setItem(HIDE, JSON.stringify(next)); } catch { /* ignore */ }
    setHidden(next);
  };
  const unhideAll = () => {
    const ids = new Set(fresh.map((s) => s.id));
    const next = readHidden().filter((id) => !ids.has(id));
    try { localStorage.setItem(HIDE, JSON.stringify(next)); } catch { /* ignore */ }
    setHidden(next);
  };
  return { list: shown, all: fresh, hiddenCount: fresh.length - shown.length, hide, unhideAll };
}

const when = (s) => {
  if (s.smsTime) return s.smsTime;
  const d = new Date(s.atMs || Date.now());
  return d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
};

// Dashboard card.
export function WalletInCard({ sms, shop, shift, profile }) {
  const [open, setOpen] = useState(null);
  if (!sms.list.length && !sms.hiddenCount) return null;
  if (!sms.list.length) return (
    <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={sms.unhideAll}>↩ رجّع التحويلات اللي قلت عليها «مش بتاعي» ({sms.hiddenCount})</button>
  );
  return (
    <section className="card" style={{ background: '#F3E8FF', gap: 10 }} data-tour="sms-in">
      <h2 style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Icon d="phone" />تحويلات وصلت لصاحب المحل · لو ده عميلك أكّده</h2>
      {sms.list.map((s) => (
        <div key={s.id} className="m-row" style={{ padding: '10px 14px', background: '#fff', flexWrap: 'wrap', gap: 10 }}>
          <WalletMark k={s.wallet} size={38} />
          <span className="lbl" style={{ flex: '1 1 160px', minWidth: 0 }}>
            <span className="small" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{s.fromName || 'عميل'}</span>
            <span className="tiny muted">{SRC_LABEL[s.wallet] || ''} · الساعة {when(s)}{s.fromPhone ? ` · ${s.fromPhone}` : ''}</span>
          </span>
          <strong style={{ fontSize: 20 }}>{fmt(s.amount)} ج</strong>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn sm lime" onClick={() => setOpen(s)}>ده عميلي</button>
            <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => sms.hide(s.id)} title="اخفيه من عندي">مش بتاعي</button>
          </span>
        </div>
      ))}
      {sms.hiddenCount > 0 && <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={sms.unhideAll}>↩ رجّع اللي قلت عليها «مش بتاعي» ({sms.hiddenCount})</button>}
      {open && <ClaimModal s={open} shop={shop} shift={shift} profile={profile} onClose={() => setOpen(null)} />}
    </section>
  );
}

// Same list, small, inside the "تحويل محفظة" window: pick one instead of taking a screenshot.
export function WalletInPick({ list, onPick }) {
  if (!list?.length) return null;
  return (
    <div className="stack" style={{ background: '#F3E8FF', borderRadius: 18, padding: '10px 12px', gap: 8 }}>
      <span className="small" style={{ fontWeight: 700 }}>💰 وصل لصاحب المحل · لو التحويل ده منهم دوس عليه (مش محتاج صورة)</span>
      {list.slice(0, 6).map((s) => (
        <button key={s.id} type="button" className="m-row" onClick={() => onPick(s)} style={{ padding: '8px 12px', background: '#fff', border: 0, cursor: 'pointer', textAlign: 'start', width: '100%' }}>
          <span className="lbl"><span className="small" style={{ fontWeight: 600 }}>{s.fromName || 'عميل'}</span><span className="tiny muted">{SRC_LABEL[s.wallet] || ''} · {when(s)}{s.fromPhone ? ` · ${s.fromPhone}` : ''}</span></span>
          <strong>{fmt(s.amount)} ج</strong>
        </button>
      ))}
    </div>
  );
}

export function ClaimModal({ s, shop, shift, profile, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const look = WALLET_LOOK[s.wallet] || WALLET_LOOK.insta;
  const go = async () => {
    if (!navigator.onLine) { toast('لازم يكون فيه نت علشان نأكد التحويل', 'err'); return; }
    setBusy(true);
    const b = writeBatch(db);
    const eref = doc(collection(db, 'shifts', shift.id, 'entries'));
    b.set(eref, {
      type: 'transfer', wallet: s.wallet, src: s.wallet, amount: Number(s.amount) || 0, by: profile.id, byName: profile.name,
      smsId: s.id, smsName: s.fromName || '', smsPhone: s.fromPhone || '', smsRef: s.ref || '', smsTime: s.smsTime || '',
      createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString(), posted: false,
    });
    // If another cashier already took it, this fails and nothing is saved.
    b.update(doc(db, 'walletIn', s.id), {
      status: 'claimed', claimedBy: profile.id, claimedByName: profile.name, claimedShiftId: shift.id, claimedEntryId: eref.id, claimedAtMs: Date.now(),
    });
    try {
      await b.commit();
      logAct('sms_claim', `أكّد تحويل ${SRC_LABEL[s.wallet] || ''} ${fmt(s.amount)} ج من ${s.fromName || 'عميل'} (رسالة البنك)`, { shopId: shift.shopId, shiftId: shift.id });
      toast('اتسجل التحويل ✓');
      onClose();
    } catch (e) {
      console.error(e);
      toast(e?.code === 'permission-denied' ? 'التحويل ده اتأكد قبل كده من كاشير تاني' : 'حصلت مشكلة، جرّب تاني', 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title="تأكيد تحويل" icon="phone" color="#A07CFF" onClose={onClose} width={460}>
      <div style={{ background: look.bg, color: '#fff', borderRadius: 22, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small" style={{ opacity: 0.9 }}>{SRC_LABEL[s.wallet] || ''} · رسالة البنك على موبايل صاحب المحل</span>
        <strong style={{ fontSize: 34, lineHeight: 1.1 }}>{fmt(s.amount)} ج</strong>
        <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>من {s.fromName || 'عميل'}</span>
        {s.fromPhone && <span className="small" dir="ltr" style={{ textAlign: 'end' }}>📱 {s.fromPhone}</span>}
        <span className="tiny" style={{ opacity: 0.9 }}>{[s.smsDate, s.smsTime && `الساعة ${s.smsTime}`, s.ref && `رقم العملية ${s.ref}`].filter(Boolean).join(' · ')}</span>
      </div>
      <span className="small muted" style={{ lineHeight: 1.7 }}>اتأكد إن العميل اللي قدامك هو اللي حوّل المبلغ ده. هيتسجل «تحويل محفظة» في ورديتك ومش محتاج صورة.</span>
      <button type="button" className="btn full lime" onClick={go} disabled={busy}>{busy ? 'لحظة…' : 'أيوه، ده تحويل عميل عندي'}</button>
      <button type="button" className="link" onClick={onClose}>رجوع</button>
    </Modal>
  );
}
