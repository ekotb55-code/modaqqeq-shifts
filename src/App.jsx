import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, SUPER_ADMINS } from './firebase';
import { Spinner } from './ui.jsx';
import CashierApp from './cashier/CashierApp.jsx';
import Login from './staff/StaffLogin.jsx';
import StaffApp from './staff/StaffApp.jsx';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState('');

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

  if (user === undefined) return <Spinner text="بنفتح التطبيق…" />;

  if (user && profile) {
    if (profile.role === 'cashier') return <CashierApp profile={profile} />;
    return <StaffApp profile={profile} />;
  }

  return <Login error={err} />;
}
