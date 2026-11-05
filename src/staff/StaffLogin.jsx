import { useState } from 'react';
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, SUPER_ADMINS } from '../firebase';
import { InstallButton, useToast } from '../ui.jsx';
import { cashierEmail, cashierPassword } from '../lib';

const MSG = {
  'auth/invalid-credential': 'اسم الدخول أو الباسورد غلط',
  'auth/wrong-password': 'اسم الدخول أو الباسورد غلط',
  'auth/user-not-found': 'اسم الدخول ده مش متسجل',
  'auth/invalid-email': 'اسم الدخول أو الباسورد غلط',
  'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني',
  'auth/network-request-failed': 'مفيش نت. أول دخول محتاج نت.',
  'auth/email-already-in-use': 'الإيميل ده متسجل قبل كده، ادخل بيه',
  'auth/weak-password': 'الباسورد لازم 6 حروف أو أرقام على الأقل',
};

// One login for everybody: cashiers type their username + PIN, staff type their email + password.
export default function Login({ error }) {
  const toast = useToast();
  const saved = (() => { try { return JSON.parse(localStorage.getItem('mdq-remember') || 'null'); } catch { return null; } })();
  const [user, setUser] = useState(saved?.user || '');
  const [remember, setRemember] = useState(saved ? saved.on !== false : true);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(false);
  const isEmail = user.includes('@');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      // "افتكرني": stay signed in on this phone and keep the login name; otherwise sign out when the app closes.
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).catch(() => {});
      try { localStorage.setItem('mdq-remember', JSON.stringify(remember ? { on: true, user: user.trim() } : { on: false })); } catch { /* ignore */ }
      if (setup) {
        if (!SUPER_ADMINS.includes(user.trim().toLowerCase())) { setMsg('إنشاء الحساب هنا لإدارة مدقق بس. باقي الحسابات بتتعمل من جوه التطبيق.'); return; }
        await createUserWithEmailAndPassword(auth, user.trim(), pass);
      } else if (isEmail) {
        await signInWithEmailAndPassword(auth, user.trim(), pass);
      } else {
        await signInWithEmailAndPassword(auth, cashierEmail(user), cashierPassword(pass.trim()));
      }
    } catch (err) {
      setMsg(MSG[err.code] || 'حصلت مشكلة، جرّب تاني');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!isEmail) { setMsg('لو نسيت رقمك السري كلّم المحاسب أو دعم مدقق'); return; }
    try { await sendPasswordResetEmail(auth, user.trim()); toast('بعتنالك إيميل تغيّر منه الباسورد'); } catch (err) { setMsg(MSG[err.code] || 'حصلت مشكلة'); }
  };

  return (
    <div className="login">
      <section className="login-main">
        <img className="logo-mdq" style={{ height: 92, alignSelf: 'flex-start' }} src="./modaqqeq-logo.png" alt="مدقق" />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form className="card card-lg" style={{ width: '100%', maxWidth: 440, gap: 16 }} onSubmit={submit}>
            <div className="stack" style={{ gap: 4 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700 }}>{setup ? 'إنشاء حساب إدارة مدقق' : 'تسجيل الدخول'}</h1>
              <span className="muted small">{setup ? 'أول مرة بس. بعدها هتعمل باقي الحسابات من جوه.' : 'الكاشير: اسم الدخول والرقم السري · المحاسبين والإدارة: الإيميل والباسورد'}</span>
            </div>
            {(msg || error) && <span className="badge bad" style={{ fontSize: 14, padding: '8px 14px', whiteSpace: 'normal' }}>{msg || error}</span>}
            <label className="field">{setup ? 'الإيميل' : 'اسم الدخول أو الإيميل'}
              <input className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="auto" value={user} onChange={(e) => setUser(e.target.value)} required />
            </label>
            <label className="field">{setup || isEmail ? 'الباسورد' : 'الرقم السري'}
              <input className="input" type="password" inputMode={!setup && !isEmail && user ? 'numeric' : undefined} autoComplete={setup ? 'new-password' : 'current-password'} dir="ltr" value={pass} onChange={(e) => setPass(e.target.value)} required minLength={setup ? 6 : 4} />
            </label>
            {!setup && (
              <label className="remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span className="rm-box" aria-hidden="true">{remember ? '✓' : ''}</span>
                <span className="stack" style={{ gap: 0 }}>
                  <strong>افتكرني</strong>
                  <span className="tiny muted">{remember ? 'هتفضل داخل على الجهاز ده واسمك محفوظ' : 'هتخرج لوحدك لما تقفل التطبيق'}</span>
                </span>
              </label>
            )}
            <button type="submit" className="btn full" disabled={busy}>{busy ? 'لحظة…' : setup ? 'اعمل الحساب' : 'دخول'}</button>
            <div className="spread">
              {!setup && <button type="button" className="link" onClick={reset}>نسيت الباسورد؟</button>}
              <button type="button" className="link" onClick={() => { setSetup(!setup); setMsg(''); }}>{setup ? 'عندي حساب' : 'أول مرة؟ (إدارة مدقق)'}</button>
            </div>
            <InstallButton />
          </form>
        </div>
      </section>
      <section className="login-art">
        <svg width="420" height="420" viewBox="0 0 420 420" aria-hidden="true" style={{ position: 'absolute', top: -90, left: -90 }}><circle cx="210" cy="210" r="170" fill="none" stroke="#B6F000" strokeWidth="34" /><circle cx="210" cy="210" r="80" fill="#A07CFF" /></svg>
        <svg width="220" height="220" viewBox="0 0 220 220" aria-hidden="true" style={{ position: 'absolute', top: 210, right: 60 }}><rect x="20" y="20" width="180" height="180" rx="60" fill="#FF7A1A" /></svg>
        <h2>ورديتك كلها<br />من غير ورق ولا كشكول</h2>
        <p>استلم، سجّل مصاريفك وتحويلاتك، وسلّم بدوسة. والمحاسب بيراجع وراك على طول.</p>
      </section>
    </div>
  );
}
