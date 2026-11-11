import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { unregisterPush } from './cloud.js';
import { todayKey } from './lib';

// Activity log: every login and every important step, for Modaqqeq management and support only.
// Each person can only add lines about himself; nobody can edit or delete them.

let actor = null;
export const setActor = (p) => { actor = p; };

function device() {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const os = /Android/i.test(ua) ? 'أندرويد' : /iPhone|iPad|iPod/i.test(ua) ? 'آيفون' : /Windows/i.test(ua) ? 'ويندوز' : /Mac OS/i.test(ua) ? 'ماك' : /Linux/i.test(ua) ? 'لينكس' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  return { kind: mobile ? 'mobile' : 'desktop', label: [os, br, standalone ? 'التطبيق' : ''].filter(Boolean).join(' · ') };
}

let devId = null;
function deviceId() {
  if (devId) return devId;
  try { devId = localStorage.getItem('mdq-dev') || Math.random().toString(36).slice(2, 10); localStorage.setItem('mdq-dev', devId); } catch { devId = 'x'; }
  return devId;
}

export function logAct(action, text, extra = {}) {
  const u = auth.currentUser;
  if (!u || !actor) return Promise.resolve();
  const now = new Date();
  const d = device();
  return addDoc(collection(db, 'activity'), {
    uid: u.uid, name: actor.name || '', role: actor.role || '', shopIds: actor.shopIds || [],
    action, text: String(text || '').slice(0, 300),
    shopId: extra.shopId || null, shiftId: extra.shiftId || null,
    device: d.kind, deviceLabel: d.label, deviceId: deviceId(),
    day: todayKey(now), at: serverTimestamp(), atLocal: now.toISOString(),
  }).catch(() => {});
}

// Called once the profile is loaded: a real login (typed the password) or just opening the app again.
export function logSessionStart(profile) {
  setActor(profile);
  let mark = null, opened = null;
  try { mark = sessionStorage.getItem('mdq-login-mark'); opened = sessionStorage.getItem('mdq-act-open'); } catch { /* ignore */ }
  try { sessionStorage.removeItem('mdq-login-mark'); sessionStorage.setItem('mdq-act-open', '1'); } catch { /* ignore */ }
  if (mark) logAct('login', 'سجّل دخول');
  else if (!opened) logAct('open', 'فتح التطبيق (كان داخل من قبل)');
}
export const markLogin = () => { try { sessionStorage.setItem('mdq-login-mark', '1'); } catch { /* ignore */ } };

export async function logout() {
  await Promise.race([Promise.all([logAct('logout', 'خرج من التطبيق'), unregisterPush(auth.currentUser?.uid)]), new Promise((r) => setTimeout(r, 2000))]);
  try { sessionStorage.removeItem('mdq-act-open'); } catch { /* ignore */ }
  setActor(null);
  return signOut(auth);
}
