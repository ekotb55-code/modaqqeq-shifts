import { useEffect, useRef, useState } from 'react';
import { deleteField, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { isDesktop } from './remoteDraft';

// ───── جرد الوردية: العد على الموبايل والتقفيل على الكمبيوتر ─────
// زي تصوير الموبايل بالظبط: الكمبيوتر بيسيب الجرد في drafts/{uid}.jard، والموبايل (نفس الحساب، التطبيق مفتوح)
// بيفتح شاشة العد لوحده. الأرقام بتتحفظ أول بأول، ولما يدوس «خلّصنا العد» الكمبيوتر بيكمّل (التأكيد والفروقات).
// مفيش أي طلبات لجوجل هنا - كله Firestore.

const ref = (uid) => doc(db, 'drafts', uid);
const FRESH_MS = 12 * 3600e3;

// على الكمبيوتر: بيبعت الجرد للموبايل وبيسمع. onCounts(counts) مع كل حفظ، onDone(counts) لما العد يخلص، onBack() لو الموبايل رجّعه.
// بيرجّع حالة الموبايل: waiting (لسه مافتحش) | opened (بيعدّوا دلوقتي)
export function useJardOnPhone({ uid, on, sess, items, note = '', counts, onCounts, onDone, onBack }) {
  const [state, setState] = useState('waiting');
  const cb = useRef({});
  cb.current = { onCounts, onDone, onBack, counts, items: items || sess?.items || [], note };
  const id = sess?.id || '';
  useEffect(() => {
    if (!on || !uid || !id) return undefined;
    setState('waiting');
    let pushed = false;
    const push = () => {
      pushed = true;
      setDoc(ref(uid), { jard: { id, note: cb.current.note || '', items: cb.current.items.map((it) => ({ n: it.n, name: it.name || '', subs: String(it.subs || '').split(',')[0].trim() })), counts: cb.current.counts || {}, status: 'waiting', atMs: Date.now() } }, { merge: true }).catch(() => {});
    };
    const unsub = onSnapshot(ref(uid), (s) => {
      if (s.metadata.hasPendingWrites) return;
      const j = s.data()?.jard;
      // مش موجود (أول مرة، أو اتمسح مع مسودة تانية): نبعته
      if (!j || j.id !== id) { if (!pushed || !j) push(); return; }
      if (j.status === 'cancelled') { cb.current.onBack?.(); return; }
      if (j.status === 'opened' || j.status === 'done') { setState('opened'); cb.current.onCounts?.(j.counts || {}); }
      if (j.status === 'done') cb.current.onDone?.(j.counts || {});
    }, () => {});
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, uid, id]);
  return state;
}

export const clearJardOnPhone = (uid) => (uid ? setDoc(ref(uid), { jard: deleteField() }, { merge: true }).catch(() => {}) : Promise.resolve());

// على الموبايل: أول ما الكمبيوتر يبدأ الجرد، شاشة العد بتتفتح لوحدها.
export function PhoneJardListener({ uid }) {
  const [j, setJ] = useState(null);
  const [counts, setCounts] = useState({});
  const cur = useRef('');
  const dirty = useRef(false);
  useEffect(() => {
    if (!uid || isDesktop()) return undefined;
    return onSnapshot(ref(uid), (s) => {
      const d = s.data()?.jard;
      const live = d && ['waiting', 'opened'].includes(d.status) && Date.now() - (d.atMs || 0) < FRESH_MS;
      if (!live) { cur.current = ''; setJ(null); return; }
      if (cur.current !== d.id) {
        cur.current = d.id;
        dirty.current = false;
        setCounts(d.counts || {});
        try { navigator.vibrate?.([80, 60, 80]); } catch { /* ignore */ }
      }
      if (d.status === 'waiting') updateDoc(ref(uid), { 'jard.status': 'opened' }).catch(() => {});
      setJ(d);
    }, () => {});
  }, [uid]);
  // الأرقام بتتحفظ أول بأول (بعد ما يبطّل كتابة بثانية) علشان الكمبيوتر يشوف، ولو الموبايل قفل يكمّل من مكانه
  useEffect(() => {
    if (!uid || !j || !dirty.current) return undefined;
    const t = setTimeout(() => { updateDoc(ref(uid), { 'jard.counts': counts }).catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [uid, j, counts]);
  if (!j) return null;
  const items = j.items || [];
  const left = items.filter((it) => String(counts[it.n] ?? '').trim() === '').length;
  const end = (status) => {
    cur.current = '';
    setJ(null);
    updateDoc(ref(uid), { 'jard.counts': counts, 'jard.status': status }).catch(() => {});
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="جرد الوردية" style={{ position: 'fixed', inset: 0, zIndex: 380, background: 'var(--bg, #F3F2FB)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 10px', background: 'var(--card)', boxShadow: '0 2px 10px rgba(0,0,0,.06)' }}>
        <div className="spread">
          <strong style={{ fontSize: 20 }}>📋 جرد الوردية</strong>
          <span className="small" style={{ fontWeight: 700, color: left ? '#9B1C1C' : '#0E7A4F' }}>{left ? `فاضل ${left} من ${items.length}` : 'كله اتعد ✓'}</span>
        </div>
        {j.note
          ? <span className="small" style={{ color: '#9B1C1C', fontWeight: 700, lineHeight: 1.7 }}>{j.note}</span>
          : <span className="tiny muted">اعدّوا كل صنف واكتبوا العدد اللي قدامكم. الخلصان اكتبله 0.</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => {
          const v = String(counts[it.n] ?? '');
          return (
            <div key={it.n} style={{ background: v.trim() === '' ? 'var(--card)' : '#EEF8E4', borderRadius: 20, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.5 }}>{it.n}. {it.name}</span>
              {it.subs && <span className="tiny muted" dir="ltr" style={{ textAlign: 'right' }}>{it.subs}</span>}
              <input className="input" inputMode="decimal" dir="ltr" aria-label={`عدد ${it.name}`} placeholder="العدد" style={{ height: 58, fontSize: 24, textAlign: 'center' }}
                value={v} onChange={(e) => { dirty.current = true; setCounts({ ...counts, [it.n]: e.target.value.replace(/[^0-9.]/g, '') }); }} />
            </div>
          );
        })}
      </div>
      <div style={{ padding: 12, background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 -2px 10px rgba(0,0,0,.06)' }}>
        <button type="button" className="btn full" style={{ height: 60, fontSize: 18 }} disabled={left > 0} onClick={() => end('done')}>{left > 0 ? `فاضل ${left} صنف` : 'خلّصنا العد · كمّل على الكمبيوتر'}</button>
        <button type="button" className="link" onClick={() => end('cancelled')}>هنعدّ على الكمبيوتر</button>
      </div>
    </div>
  );
}
