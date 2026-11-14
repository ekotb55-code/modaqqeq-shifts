import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { app, dbOf, defaultApp, isCashierSession, sessionApp, useApp } from './firebase';
import { cashierEmail, cashierPassword } from './lib';

// «الجهاز يفتكر كل كاشير»
// Every cashier who signs in once on this device (with internet) keeps his own login here. After that,
// choosing his name and typing his PIN opens his account without internet: the PIN is checked against a
// salted hash kept on the device (never the PIN itself). Logging out only locks the screen.

const KEY = 'mdq-sessions';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 60000 }, key, 256);
  return b64(bits);
}
export async function rememberPin(uid, pin) {
  if (!crypto?.subtle) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const all = read();
  all[uid] = { ...(all[uid] || {}), salt: b64(salt), hash: await pinHash(pin, salt), atMs: Date.now() };
  write(all);
}
export const isRemembered = (uid) => !!read()[uid]?.hash;
export function forget(uid) { const all = read(); delete all[uid]; write(all); }

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const ready = (a) => { const au = getAuth(a); return (au.authStateReady ? au.authStateReady() : Promise.resolve()).then(() => au.currentUser); };

// Sign a cashier in on this device. Throws an Error whose .code is a Firebase auth code, or:
//  'offline-first' — never signed in here and there's no internet;  'bad-pin' — wrong PIN offline.
export async function cashierLogin({ uid, username }, pin) {
  const saved = read()[uid];
  const a = sessionApp(uid);
  if (saved?.hash) {
    const okPin = (await pinHash(pin, unb64(saved.salt))) === saved.hash;
    const u = await ready(a);
    if (okPin && u?.uid === uid) { await switchTo(a); return; }
    // wrong PIN here: maybe the accountant changed it — the internet decides
    if (!online()) { const e = new Error('bad-pin'); e.code = okPin ? 'offline-first' : 'bad-pin'; throw e; }
  } else if (!online()) { const e = new Error('offline-first'); e.code = 'offline-first'; throw e; }
  const cred = await signInWithEmailAndPassword(getAuth(a), cashierEmail(username), cashierPassword(pin));
  if (cred.user.uid !== uid) { await signOut(getAuth(a)); const e = new Error('wrong user'); e.code = 'auth/invalid-credential'; throw e; }
  await rememberPin(uid, pin);
  await switchTo(a);
}

async function switchTo(a) {
  await leave();
  // the login screen's app must not keep anyone signed in
  if (getAuth(defaultApp).currentUser) await signOut(getAuth(defaultApp)).catch(() => {});
  useApp(a);
}

// Before leaving a cashier: are his operations still waiting for the internet? Keep a note, so they are sent
// even after the page is reopened under another cashier.
async function leave() {
  if (!isCashierSession()) return;
  const uid = app.name.slice(3);
  const pending = await Promise.race([waitForPendingWrites(dbOf(app)).then(() => false, () => false), new Promise((r) => setTimeout(() => r(true), 400))]);
  const all = read();
  if (all[uid]) { all[uid].pending = pending; write(all); }
}

// «تسجيل خروج» for a cashier: lock the screen, keep his login on the device.
export async function lockCashier() { await leave(); useApp(defaultApp); }

// His login stopped working (PIN changed by the accountant, account stopped): forget it here.
export async function dropCashier() {
  if (!isCashierSession()) return;
  forget(app.name.slice(3));
  useApp(defaultApp);
}

// Operations of cashiers who are not on the screen now and were still waiting for the internet.
export function flushPending() {
  const all = read();
  Object.entries(all).forEach(([uid, s]) => {
    if (!s.pending || app.name === 'cs-' + uid || !online()) return;
    const a = sessionApp(uid);
    ready(a).then((u) => {
      if (!u) return;
      return waitForPendingWrites(dbOf(a)).then(() => { const x = read(); if (x[uid]) { x[uid].pending = false; write(x); } });
    }).catch(() => {});
  });
}
