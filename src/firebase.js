import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyCRCvSveuol7K9eQdDVTPEFundBVD8HtWs',
  authDomain: 'modaqqeq-shifts.firebaseapp.com',
  projectId: 'modaqqeq-shifts',
  storageBucket: 'modaqqeq-shifts.firebasestorage.app',
  messagingSenderId: '890738231200',
  appId: '1:890738231200:web:1c43da5dbb5c6ad007c6c5',
};

// Offline-first: data is cached on the device and synced when the internet returns.
const fsOpts = () => ({ localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const DEFAULT = initializeApp(firebaseConfig);
const fsOf = new Map([[DEFAULT.name, initializeFirestore(DEFAULT, fsOpts())]]);

// «الجهاز يفتكر كل كاشير»: every cashier who signed in once on this device keeps his own login
// (a separate Firebase app named cs-<uid>, with its own saved login and its own offline copy).
// Switching cashiers = switching app, no internet needed. Staff and the login screen use the default app.
// These are live bindings: every module that imports { app, auth, db } sees the active one.
export let app = DEFAULT;
export let auth = getAuth(DEFAULT);
export let db = fsOf.get(DEFAULT.name);
export const defaultApp = DEFAULT;

export function sessionApp(uid) {
  const name = 'cs-' + uid;
  const a = getApps().find((x) => x.name === name) || initializeApp(firebaseConfig, name);
  if (!fsOf.has(name)) fsOf.set(name, initializeFirestore(a, fsOpts()));
  return a;
}
export const dbOf = (a) => fsOf.get(a.name);
const subs = new Set();
export const onSessionChange = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function useApp(a) {
  app = a; auth = getAuth(a); db = fsOf.get(a.name);
  try { if (a === DEFAULT) localStorage.removeItem('mdq-active'); else localStorage.setItem('mdq-active', a.name.slice(3)); } catch { /* ignore */ }
  subs.forEach((cb) => cb());
}
export const isCashierSession = () => app.name.startsWith('cs-');

// The cashier who was using this device last: open his app directly (works offline).
try {
  const last = localStorage.getItem('mdq-active');
  if (last) { const a = sessionApp(last); app = a; auth = getAuth(a); db = fsOf.get(a.name); }
} catch { /* ignore */ }

// Modaqqeq super-admin accounts (full access to everything).
export const SUPER_ADMINS = ['ekotb555@gmail.com'];
