import { useState } from 'react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, SUPER_ADMINS } from '../firebase';
import { InstallButton, useToast } from '../ui.jsx';

const MSG = {
  'auth/invalid-credential': 'الإيميل أو الباسورد غلط',
  'auth/wrong-password': 'الإيميل أو الباسورد غلط',
  'auth/user-not-found': 'الإيميل ده مش متسجل',
  'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني',
  'auth/network-request-failed': 'مفيش نت',
  'auth/email-already-in-use': 'الإيميل ده متسجل قبل كده، ادخل بيه',
  'auth/weak-password': 'الباسورد لازم 6 حروف أو أرقام على الأقل',
  'auth/invalid-email': 'الإيميل مكتوب غلط',
};

export default function StaffLogin({ error, onBack }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (setup) {
        if (!SUPER_ADMINS.includes(email.trim().toLowerCase())) { setMsg('إنشاء الحساب هنا لإدارة مدقق بس. باقي الحسابات بتتعمل من جوه التطبيق.'); return; }
        await createUserWithEmailAndPassword(auth, email.trim(), pass);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), pass);
      }
    } catch (err) {
      setMsg(MSG[err.code] || 'حصلت مشكلة، جرّب تاني');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!email.trim()) { setMsg('اكتب الإيميل الأول'); return; }
    try { await sendPasswordResetEmail(auth, email.trim()); toast('بعتنالك إيميل تغيّر منه الباسورد'); } catch (err) { setMsg(MSG[err.code] || 'حصلت مشكلة'); }
  };

  return (
    <div className="login">
      <section className="login-main">
        <img className="logo-mdq" style={{ height: 92, alignSelf: 'flex-start' }} src="./modaqqeq-logo.png" alt="مدقق" />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form className="card card-lg" style={{ width: '100%', maxWidth: 440, gap: 16 }} onSubmit={submit}>
            <div className="stack" style={{ gap: 4 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700 }}>{setup ? 'إنشاء حساب إدارة مدقق' : 'دخول المحاسبين والإدارة'}</h1>
              <span className="muted small">{setup ? 'أول مرة بس. بعدها هتعمل باقي الحسابات من جوه.' : 'ادخل بالإيميل والباسورد بتوعك'}</span>
            </div>
            {(msg || error) && <span className="badge bad" style={{ fontSize: 14, padding: '8px 14px', whiteSpace: 'normal' }}>{msg || error}</span>}
            <label className="field">الإيميل<input className="input" type="email" autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field">الباسورد<input className="input" type="password" autoComplete={setup ? 'new-password' : 'current-password'} dir="ltr" value={pass} onChange={(e) => setPass(e.target.value)} required minLength={6} /></label>
            <button type="submit" className="btn full" disabled={busy}>{busy ? 'لحظة…' : setup ? 'اعمل الحساب' : 'دخول'}</button>
            <div className="spread">
              {!setup && <button type="button" className="link" onClick={reset}>نسيت الباسورد؟</button>}
              <button type="button" className="link" onClick={() => { setSetup(!setup); setMsg(''); }}>{setup ? 'عندي حساب' : 'أول مرة؟ (إدارة مدقق)'}</button>
            </div>
            {onBack && <button type="button" className="btn soft full" onClick={onBack}>رجوع لدخول الكاشير</button>}
            <InstallButton />
          </form>
        </div>
      </section>
      <section className="login-art">
        <svg width="420" height="420" viewBox="0 0 420 420" aria-hidden="true" style={{ position: 'absolute', top: -90, left: -90 }}><circle cx="210" cy="210" r="170" fill="none" stroke="#B6F000" strokeWidth="34" /><circle cx="210" cy="210" r="80" fill="#A07CFF" /></svg>
        <svg width="220" height="220" viewBox="0 0 220 220" aria-hidden="true" style={{ position: 'absolute', top: 210, right: 60 }}><rect x="20" y="20" width="180" height="180" rx="60" fill="#FF7A1A" /></svg>
        <h2>كل الورديات<br />قدامك أول بأول</h2>
        <p>راجع، اكتب المبيعات، والعجز والزيادة بيطلعوا لوحدهم. والتقرير بيوصل للمدير مع التقفيل.</p>
      </section>
    </div>
  );
}
