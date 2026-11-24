import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { CLOUD } from '../cloud.js';
import { useToast } from '../ui.jsx';

// طلبات قفل الوردية الليلية بدري اللي مستنية إذن: بتظهر فوق للمدير والأونر (محلاتهم) والدعم/الإدارة (كل المحلات)
// الموافقة بتروح للسكريبت (هو اللي بيكتبها على الوردية باسم اللي وافق).
export default function EarlyAsks({ profile, isAdmin, shops }) {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState('');
  const can = isAdmin || ['owner', 'manager'].includes(profile.role);
  const ids = (profile.shopIds || []).slice(0, 30);
  const key = ids.join(',');
  useEffect(() => {
    if (!can || (!isAdmin && !ids.length)) return undefined;
    const q = isAdmin
      ? query(collection(db, 'shifts'), where('earlyAskStatus', '==', 'pending'))
      : query(collection(db, 'shifts'), where('shopId', 'in', ids), where('earlyAskStatus', '==', 'pending'));
    return onSnapshot(q, (s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'open')), () => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, isAdmin, key]);
  if (!list.length) return null;
  const allow = async (x) => {
    setBusy(x.id);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const r = await fetch(CLOUD.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'allowEarly', shiftId: x.id, idToken }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'حصلت مشكلة');
      toast(`${x.cashierName || 'الكاشير'} يقدر يقفل دلوقتي`);
    } catch (e) { toast(e.message === 'unknown action' ? 'سكريبت الإشعارات لسه ماتحدّثش' : e.message, 'err'); }
    setBusy('');
  };
  return (
    <div className="wrap" style={{ maxWidth: 900, paddingTop: 10, paddingBottom: 0 }}>
      {list.map((x) => (
        <div key={x.id} className="alert warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span className="small" style={{ lineHeight: 1.7 }}>
            🌙 <b>{x.cashierName || 'كاشير'}</b> عايز يقفل الوردية بدري · {shops.find((s) => s.id === x.shopId)?.name || ''}{x.earlyAskMins ? ` · قبل المعاد بـ ${x.earlyAskMins} دقيقة` : ''}
          </span>
          <button type="button" className="btn sm" disabled={busy === x.id} onClick={() => allow(x)}>{busy === x.id ? 'لحظة…' : 'موافق ✓'}</button>
        </div>
      ))}
    </div>
  );
}
