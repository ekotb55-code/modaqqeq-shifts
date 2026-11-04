import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, SUPER_ADMINS } from './firebase';
import { Spinner } from './ui.jsx';
import CashierApp from './cashier/CashierApp.jsx';
import Login from './staff/StaffLogin.jsx';
import StaffApp from './staff/StaffApp.jsx';
import { Intro } from './theme.jsx';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState('');
  const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem('mdq-intro'); } catch { return true; } });
  const endIntro = useCallback(() => { setIntro(false); try { sessionStorage.setItem('mdq-intro', '1'); } catch { /* ignore */ } }, []);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setErr('');
    if (!u) { setUser(null); setProfile(null); return; }
    try {
      const ref = doc(db, 'users', u.uid);
      let snap = await getDoc(ref);
      if (!snap.exists() && SUPER_ADMINS.includes((u.email || '').toLowerCase())) {
        await setDoc(ref, { role: 'admin', name: 'إدارة مدقق', email: u.email, shopIds: [], createdAt: serverTimestamp() });
        snap = await getDoc(ref);
      }
      if (!snap.exists()) { setErr('الحساب ده مش متسجل في النظام. كلّم دعم مدقق.'); await signOut(auth); return; }
      const p = { id: u.uid, ...snap.data() };
      if (p.disabled) { setErr('الحساب ده اتقفل. كلّم دعم مدقق.'); await signOut(auth); return; }
      setProfile(p);
      setUser(u);
    } catch (e) {
      console.error(e);
      setErr('مش قادرين نحمّل بيانات الحساب. اتأكد من النت وجرّب تاني.');
      setUser(null);
    }
  }), []);

  let body;
  if (user === undefined) body = <Spinner text="بنفتح التطبيق…" />;
  else if (user && profile) body = profile.role === 'cashier' ? <CashierApp profile={profile} /> : <StaffApp profile={profile} />;
  else body = <Login error={err} />;
  return <>{body}{intro && <Intro onDone={endIntro} />}</>;
}
