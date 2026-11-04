import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../firebase';
import { Avatar, Icon, InstallButton } from '../ui.jsx';
import { cashierPassword, firstName } from '../lib';

export default function ShopLogin({ shopId, error, onStaff, onUnlink }) {
  const [pub, setPub] = useState(undefined);
  const [who, setWho] = useState(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shopId), (s) => setPub(s.exists() ? s.data() : null), () => setPub(null)), [shopId]);

  useEffect(() => {
    if (pin.length !== 4 || !who) return;
    setBusy(true); setMsg('');
    signInWithEmailAndPassword(auth, who.email, cashierPassword(pin))
      .catch((e) => {
        setMsg(e.code === 'auth/network-request-failed' ? 'مفيش نت. أول دخول محتاج نت.' : 'الرقم السري غلط، جرّب تاني');
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, who]);

  useEffect(() => {
    const k = (e) => {
      if (!who || busy) return;
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [who, busy]);

  const cashiers = (pub?.cashiers || []).filter((c) => !c.disabled);
  const press = (k) => { if (busy) return; if (k === 'del') setPin((p) => p.slice(0, -1)); else setPin((p) => (p.length < 4 ? p + k : p)); };

  return (
    <div className="login">
      <section className="login-main">
        <img className="logo-mdq" style={{ height: 92, alignSelf: 'flex-start' }} src="./modaqqeq-logo.png" alt="مدقق" />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card card-lg center" style={{ width: '100%', maxWidth: 460, gap: 20 }}>
            {pub?.logo ? <img src={pub.logo} alt={pub?.name} style={{ height: 112, width: 'auto', objectFit: 'contain' }} /> : <h1 style={{ fontSize: 30 }}>{pub?.name || ''}</h1>}
            {pub === undefined && <span className="muted">بنحمّل…</span>}
            {pub === null && (
              <div className="stack center">
                <span className="muted">المحل المربوط بالجهاز ده مش موجود.</span>
                <button className="link" type="button" onClick={onUnlink}>فك الربط</button>
              </div>
            )}
            {(error || msg) && <span className="badge bad" style={{ fontSize: 14, padding: '6px 14px' }}>{msg || error}</span>}
            {pub && !who && (
              <div className="stack center" style={{ width: '100%', gap: 16 }}>
                <div className="stack center" style={{ gap: 4 }}>
                  <h1 style={{ fontSize: 26, fontWeight: 700 }}>مين بيستلم دلوقتي؟</h1>
                  <span className="muted">اختار اسمك علشان تبدأ</span>
                </div>
                {cashiers.length === 0 && <span className="muted small">لسه مفيش كاشيرية متسجلين للمحل ده.</span>}
                <div className="grid2" style={{ width: '100%' }}>
                  {cashiers.map((c) => (
                    <button key={c.uid} type="button" className="user-btn" onClick={() => { setWho(c); setPin(''); setMsg(''); }}>
                      <Avatar name={c.name} photo={c.photo} color={c.color} size={66} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pub && who && (
              <div className="stack center" style={{ width: '100%', gap: 18 }}>
                <div className="stack center" style={{ gap: 6 }}>
                  <Avatar name={who.name} photo={who.photo} color={who.color} size={80} />
                  <h1 style={{ fontSize: 24, fontWeight: 700 }}>أهلًا يا {firstName(who.name)}</h1>
                  <span className="muted small">{busy ? 'بندخلك…' : 'اكتب الرقم السري بتاعك'}</span>
                </div>
                <div className="pin-dots" aria-label="الرقم السري">{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
                <div className="keypad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => (
                    k === '' ? <span key={i} /> : (
                      <button key={i} type="button" onClick={() => press(k)} aria-label={k === 'del' ? 'امسح' : k} style={k === 'del' ? { background: '#fff' } : null} disabled={busy}>
                        {k === 'del' ? '⌫' : k}
                      </button>
                    )
                  ))}
                </div>
                <button type="button" className="link" onClick={() => { setWho(null); setPin(''); setMsg(''); }}>مش أنت؟ اختار اسم تاني</button>
              </div>
            )}
          </div>
        </div>
        <InstallButton />
        <div className="spread" style={{ justifyContent: 'center' }}>
          <button type="button" className="link" onClick={onStaff}><Icon d="person" size={16} /> دخول المحاسبين والإدارة</button>
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
