import { useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// Numbers typed on the computer travel to the phone (same account) so the cashier only takes the photos there.
const DEVICE = (() => {
  try {
    let d = localStorage.getItem('mdq-device');
    if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('mdq-device', d); }
    return d;
  } catch { return Math.random().toString(36).slice(2); }
})();

export const isDesktop = () => { try { return !window.matchMedia('(pointer: coarse)').matches && window.innerWidth > 700; } catch { return true; } };

export async function saveRemoteDraft(uid, key, values, photos = {}) {
  // Photos only travel if they fit in one document; otherwise they are taken again on the phone.
  const size = JSON.stringify(photos).length;
  await setDoc(doc(db, 'drafts', uid), { key, values, photos: size < 700000 ? photos : {}, device: DEVICE, savedAtMs: Date.now() });
}

export function clearRemoteDraft(uid, key) {
  return import('firebase/firestore').then(({ getDoc }) => getDoc(doc(db, 'drafts', uid)))
    .then((s) => { if (s.exists() && s.data().key === key) return deleteDoc(doc(db, 'drafts', uid)); return null; })
    .catch(() => {});
}

export function useRemoteDraft(uid, key, apply) {
  const [info, setInfo] = useState(null);
  const applied = useRef(0);
  const fn = useRef(apply);
  fn.current = apply;
  useEffect(() => {
    if (!uid || !key) return undefined;
    return onSnapshot(doc(db, 'drafts', uid), (s) => {
      const d = s.data();
      setInfo(d && d.key === key ? d : null);
      if (d && d.key === key && d.device !== DEVICE && d.savedAtMs > applied.current) {
        applied.current = d.savedAtMs;
        fn.current(d.values || {}, d.photos || {});
      }
    }, () => {});
  }, [uid, key]);
  return info;
}
