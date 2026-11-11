import { addDoc, collection, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { app, auth, db } from './firebase';

// ───── Free "server" on Google Apps Script ─────
// 1. Photos: saved in Firestore first (works offline), then the script moves them to Google Drive (15 GB free)
//    and leaves only a pointer. Viewing a moved photo asks the script, which checks the viewer may read that shift.
// 2. Notifications when the app is closed: the app leaves a note in "outbox", the script sends it with
//    Firebase Cloud Messaging to the phones/computers that turned notifications on.
// Both values below are public (not secrets). Empty = the script isn't set up yet → everything stays as before.
export const CLOUD = {
  url: '',
  vapid: '',
};
export const cloudReady = () => !!CLOUD.url;

// ── photos ──
// Adds a photo document to a write batch, plus a ticket so the script moves it to Drive.
export function setPhoto(batch, shiftId, payload) {
  const ref = doc(collection(db, 'shifts', shiftId, 'photos'));
  batch.set(ref, payload);
  if (cloudReady() && payload.data && auth.currentUser) batch.set(doc(collection(db, 'photoQueue')), { path: ref.path, uid: auth.currentUser.uid, atMs: Date.now() });
  return ref;
}

// The image to show for a photo document: the data itself, or a pointer the <img> helpers know how to load.
export const photoSrc = (shiftId, p) => (p?.data ? p.data : p?.driveId ? `fs:shifts/${shiftId}/photos/${p.id}` : null);

const cache = new Map();
export function fetchPhoto(src) {
  if (!src || !src.startsWith('fs:')) return Promise.resolve(src);
  if (cache.has(src)) return cache.get(src);
  const p = (async () => {
    if (!cloudReady()) throw new Error('cloud not ready');
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(CLOUD.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'img', path: src.slice(3), idToken }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    return j.data;
  })();
  cache.set(src, p);
  p.catch(() => cache.delete(src));
  return p;
}

// ── notifications ──
// to: 'staff' (accountants of the shop) or 'cashier' (toUid).
export function pushEvent({ type, shopId, shiftId, to, toUid = null, title, body = '' }) {
  if (!cloudReady() || !auth.currentUser) return;
  addDoc(collection(db, 'outbox'), {
    type, shopId: shopId || null, shiftId: shiftId || null, to, toUid, title: String(title).slice(0, 120), body: String(body || '').slice(0, 240),
    byUid: auth.currentUser.uid, atMs: Date.now(),
  }).catch(() => {});
}

const devId = () => { try { let d = localStorage.getItem('mdq-dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('mdq-dev', d); } return d; } catch { return 'x'; } };
export const pushOn = () => { try { return localStorage.getItem('mdq-push-ok') === '1'; } catch { return false; } };

// Asks Firebase for this device's notification address and saves it, so the script can reach it.
export async function registerPush(uid) {
  if (!cloudReady() || !CLOUD.vapid || !uid || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return false;
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return false;
    const token = await getToken(getMessaging(app), { vapidKey: CLOUD.vapid, serviceWorkerRegistration: reg });
    if (!token) return false;
    await setDoc(doc(db, 'pushTokens', `${uid}_${devId()}`), { uid, token, device: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop', atMs: Date.now() });
    try { localStorage.setItem('mdq-push-ok', '1'); } catch { /* ignore */ }
    return true;
  } catch (e) { console.warn('push', e); return false; }
}
// On logout: this device stops getting this person's notifications.
export function unregisterPush(uid) {
  try { localStorage.removeItem('mdq-push-ok'); } catch { /* ignore */ }
  if (!uid) return Promise.resolve();
  return deleteDoc(doc(db, 'pushTokens', `${uid}_${devId()}`)).catch(() => {});
}
