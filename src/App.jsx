import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, getDocFromCache, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, auth, db, isCashierSession, onSessionChange, SUPER_ADMINS } from './firebase';
import { dropCashier, flushPending } from './sessions.js';
import { Spinner } from './ui.jsx';
import CashierApp from './cashier/CashierApp.jsx';
import Login from './staff/StaffLogin.jsx';
import StaffApp from './staff/StaffApp.jsx';
import WorkerHome from './worker/WorkerHome.jsx';
import { Intro } from './theme.jsx';
import { logSessionStart } from './activity.js';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState('');
  const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem('mdq-intro'); } catch { return true; } });
  const endIntro = useCallback(() => { setIntro(false); try { sessionStorage.setItem('mdq-intro', '1'); } catch { /* ignore */ } }, []);

  // a cashier opened/locked on this device = another Firebase app: listen again
  const [ses, setSes] = useState(app.name);
  useEffect(() => onSessionChange(() => { setUser(undefined); setProfile(null); setSes(app.name); }), []);
  useEffect(() => { flushPending(); window.addEventListener('online', flushPending); return () => window.removeEventListener('online', flushPending); }, []);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setErr('');
    if (!u) {
      // the cashier's saved login stopped working (PIN changed / account stopped): back to the login screen
      if (isCashierSession()) { dropCashier(); return; }
      setUser(null); setProfile(null); return;
    }
    try {
      const ref = doc(db, 'users', u.uid);
      // Weak internet or a browser that closed badly: try a few times, then use the copy saved on the device.
      let snap = null;
      let lastErr = null;
      for (let i = 0; i < 3 && !snap; i++) {
        try { snap = await getDoc(ref); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
      }
      if (!snap) { try { snap = await getDocFromCache(ref); } catch { throw lastErr; } }
      if (!snap.exists() && SUPER_ADMINS.includes((u.email || '').toLowerCase())) {
        await setDoc(ref, { role: 'admin', name: 'إدارة مدقق', email: u.email, shopIds: [], createdAt: serverTimestamp() });
        snap = await getDoc(ref);
      }
      if (!snap.exists()) { setErr('الحساب ده مش متسجل في النظام. كلّم دعم مدقق.'); await signOut(auth); return; }
      const p = { id: u.uid, ...snap.data() };
      if (p.disabled) { setErr('الحساب ده اتقفل. كلّم دعم مدقق.'); await signOut(auth); return; }
      setProfile(p);
      logSessionStart(p);
      setUser(u);
    } catch (e) {
      console.error(e);
      setErr(`مش قادرين نحمّل بيانات الحساب. اتأكد من النت وجرّب تاني.${e?.code ? ` (${e.code})` : ''}`);
      setUser(null);
    }
  }), [ses]); // eslint-disable-line react-hooks/exhaustive-deps

  let body;
  if (user === undefined) body = <Spinner text="بنفتح التطبيق…" />;
  else if (user && profile) body = profile.role === 'cashier' ? <CashierApp key={ses} profile={profile} />
    : profile.role === 'worker' ? <WorkerHome key={ses} profile={profile} />
      : <StaffApp key={ses} profile={profile} />;
  else body = <Login error={err} />;
  return <>{body}{intro && <Intro onDone={endIntro} />}</>;
}
