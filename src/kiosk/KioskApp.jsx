import { useEffect, useState } from 'react';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, addDoc } from 'firebase/firestore';
import { dbOf, sessionApp } from '../firebase';
import { todayKey } from '../lib';
import { approvedHere, ensureDevKey, markApproved } from '../attendance.js';
import AttendanceModal from '../Attendance.jsx';

// «تليفون الحضور»: تطبيق لوحده (att/) بتتثبت على تليفون الفرع وتفتح على الحضور والانصراف بس بكاميرا الموبايل.
// أول مرة: صاحب المحل أو المدير يدخل بحسابه هنا ويختار الفرع ← التليفون ياخد مفتاح ويتعتمد، وأي جهاز تاني للفرع ده
// بيتشال (تليفون واحد بس لكل فرع)، والحضور يتقفل على الجهاز المعتمد. بعدها حسابه بيخرج والتليفون يفضل للحضور بس.

const KIOSK = 'mdq-kiosk';
const DEV = 'mdq-device-shop';
const readJ = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const BOSS = 'kiosk-boss';

// بيانات الفرع اللي جهاز الحضور محتاجها: الأسامي والمواعيد وتغييرات النهارده
async function loadShop(db, shopId) {
  const day = todayKey();
  const [p, s, t] = await Promise.all([
    getDoc(doc(db, 'shopsPublic', shopId)),
    getDoc(doc(db, 'attSched', shopId)).catch(() => null),
    getDoc(doc(db, 'attDays', `${shopId}_${day}`)).catch(() => null),
  ]);
  const pub = p.data() || {};
  const cashiers = (pub.cashiers || []).filter((c) => !c.disabled && c.username).map((c) => ({ uid: c.uid, name: c.name, username: c.username, color: c.color || null, photo: pub.photos?.[c.uid] || c.photo || null }));
  const workers = (pub.workers || []).filter((w) => !w.disabled && w.username).map((w) => ({ uid: w.uid, name: w.name, username: w.username, color: w.color || null, photo: pub.photos?.[w.uid] || null }));
  return { shopId, name: pub.name || '', logo: null, cashiers, workers, attendance: true, attLock: !!pub.attLock, sched: s?.data() || {}, todayDoc: { ...(t?.data() || {}), day }, savedAt: Date.now() };
}

// تحديث الأسامي والمواعيد من جلسة أي كاشير سجّل قبل كده على التليفون ده (العمال مالهمش يقروا بيانات الفرع)
async function refresh(dev) {
  for (const p of [...(dev.cashiers || []), ...(dev.workers || [])]) {
    try {
      const a = sessionApp(p.uid);
      const au = getAuth(a);
      if (au.authStateReady) await au.authStateReady();
      if (au.currentUser?.uid !== p.uid) continue;
      const fresh = await loadShop(dbOf(a), dev.shopId);
      return fresh;
    } catch { /* نجرب اللي بعده */ }
  }
  return null;
}

export default function KioskApp() {
  const [kiosk, setKiosk] = useState(() => readJ(KIOSK));
  const [dev, setDev] = useState(() => readJ(DEV));
  const [setup, setSetup] = useState(false);
  const [n, setN] = useState(0);
  const ready = kiosk?.shopId && dev?.shopId === kiosk.shopId && approvedHere(kiosk.shopId);
  useEffect(() => {
    if (!ready) return undefined;
    const go = () => refresh(readJ(DEV) || dev).then((f) => { if (f) { writeJ(DEV, f); setDev(f); } }).catch(() => {});
    go();
    const i = setInterval(go, 15 * 60e3);
    return () => clearInterval(i);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // مع كل يوم جديد نرجع لقايمة الأسامي (والمواعيد تتحدث)
  useEffect(() => { const i = setInterval(() => setN((x) => x + 1), 30 * 60e3); return () => clearInterval(i); }, []);

  if (!ready || setup) {
    return <Setup current={ready ? kiosk : null} onCancel={ready ? () => setSetup(false) : null}
      onDone={(k, d) => { writeJ(KIOSK, k); writeJ(DEV, d); setKiosk(k); setDev(d); setSetup(false); }} />;
  }
  return (
    <div style={{ minHeight: '100dvh' }}>
      <AttendanceModal key={n} device={dev} onClose={() => setN((x) => x + 1)} kiosk />
      <button type="button" className="link tiny" onClick={() => setSetup(true)}
        style={{ position: 'fixed', bottom: 8, insetInlineStart: 12, zIndex: 1000, opacity: 0.6 }}>⚙️ {dev.name} · للمدير</button>
    </div>
  );
}

// اعتماد التليفون: صاحب المحل أو المدير يدخل بإيميله وباسورده
function Setup({ current, onCancel, onDone }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [boss, setBoss] = useState(null); // { profile, shops: [{id, name}] }
  const a = sessionApp(BOSS);
  const db = dbOf(a);
  const au = getAuth(a);
  useEffect(() => () => { signOut(au).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const cred = await signInWithEmailAndPassword(au, email.trim(), pass);
      const pr = (await getDoc(doc(db, 'users', cred.user.uid))).data();
      if (!pr || !['owner', 'manager', 'admin', 'support'].includes(pr.role) || pr.disabled) { await signOut(au); setMsg('الحساب ده مينفعش يعتمد تليفون. لازم صاحب المحل أو المدير.'); setBusy(false); return; }
      const shops = await Promise.all((pr.shopIds || []).map((id) => getDoc(doc(db, 'shopsPublic', id)).then((s) => ({ id, name: s.data()?.name || id })).catch(() => ({ id, name: id }))));
      setBoss({ profile: { id: cred.user.uid, ...pr }, shops });
    } catch (er) {
      console.error(er);
      setMsg(er.code === 'auth/network-request-failed' ? 'مفيش نت. الاعتماد محتاج نت.' : 'الإيميل أو الباسورد غلط');
    }
    setBusy(false);
  };

  const approve = async (shop) => {
    setBusy(true); setMsg('');
    try {
      const old = (await getDocs(query(collection(db, 'attDevices'), where('shopId', '==', shop.id)))).docs;
      const key = ensureDevKey();
      const others = old.filter((d) => d.data().key !== key);
      if (others.length && !window.confirm(`فيه ${others.length === 1 ? 'جهاز تاني معتمد' : `${others.length} أجهزة تانية معتمدة`} لـ ${shop.name} (${others.map((d) => d.data().name).join('، ')}). التليفون ده هيبقى الجهاز الوحيد، والتانيين هيتشالوا. موافق؟`)) { setBusy(false); return; }
      const me = { by: boss.profile.id, byName: boss.profile.name || '' };
      await setDoc(doc(db, 'attDevices', `${shop.id}_${key}`), { shopId: shop.id, key, name: 'تليفون الحضور', phone: true, ua: String(navigator.userAgent || '').slice(0, 160), ...me, at: serverTimestamp(), atLocalMs: Date.now() });
      for (const d of others) await deleteDoc(d.ref);
      await setDoc(doc(db, 'shopsPublic', shop.id), { attLock: true }, { merge: true });
      await addDoc(collection(db, 'attLog'), { shopId: shop.id, action: 'device', text: `اعتمد «تليفون الحضور» للفرع${others.length ? ` وشال ${others.map((d) => d.data().name).join('، ')}` : ''}`, day: todayKey(), ...me, at: serverTimestamp(), atLocalMs: Date.now() });
      // التليفون ده لفرع واحد بس
      Object.keys(readJ('mdq-att-ok') || {}).forEach((id) => { if (id !== shop.id) markApproved(id, false); });
      markApproved(shop.id, true);
      const d = await loadShop(db, shop.id);
      await signOut(au);
      onDone({ shopId: shop.id, name: shop.name, at: Date.now() }, d);
    } catch (er) {
      console.error(er);
      setMsg(er.code === 'permission-denied' ? 'الحساب ده مالوش صلاحية يعتمد أجهزة للفرع ده.' : 'حصلت مشكلة، اتأكد من النت وجرّب تاني.');
    }
    setBusy(false);
  };

  return (
    <div className="wrap stack" style={{ gap: 16, maxWidth: 460, margin: '0 auto', padding: '24px 16px' }}>
      <div className="stack" style={{ alignItems: 'center', gap: 6, textAlign: 'center' }}>
        <img src="./icon.png" alt="" style={{ width: 72, height: 72, borderRadius: 18 }} />
        <h1 className="h2">تليفون الحضور والانصراف</h1>
        <span className="muted small">{current ? `التليفون ده معتمد دلوقتي لـ ${current.name}.` : 'التليفون ده لسه مش متظبط.'} صاحب المحل أو المدير يدخل هنا مرة واحدة ويختار الفرع. بعد كده التليفون ده بيفتح على الحضور والانصراف بس، وهيبقى الجهاز الوحيد اللي ينفع يتسجل منه حضور في الفرع ده.</span>
      </div>
      {!boss ? (
        <form className="card stack" style={{ gap: 10 }} onSubmit={login}>
          <label className="field">الإيميل<input className="input" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">الباسورد<input className="input" type="password" dir="ltr" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          {msg && <span className="badge bad" style={{ whiteSpace: 'normal' }}>{msg}</span>}
          <button type="submit" className="btn" disabled={busy || !email || !pass}>{busy ? 'لحظة…' : 'دخول'}</button>
        </form>
      ) : (
        <div className="card stack" style={{ gap: 10 }}>
          <strong>أهلاً {boss.profile.name}، التليفون ده لأنهي فرع؟</strong>
          {boss.shops.map((s) => <button key={s.id} type="button" className="btn" disabled={busy} onClick={() => approve(s)}>{busy ? 'لحظة…' : `📱 اعتمد التليفون ده لـ ${s.name}`}</button>)}
          {boss.shops.length === 0 && <span className="muted">الحساب ده مالوش فروع.</span>}
          {msg && <span className="badge bad" style={{ whiteSpace: 'normal' }}>{msg}</span>}
        </div>
      )}
      <span className="tiny muted" style={{ textAlign: 'center' }}>خلّي التليفون ده في المحل، ومتمسحش بيانات المتصفح بتاعه، وإلا لازم يتعتمد تاني.</span>
      {onCancel && <button type="button" className="link" onClick={onCancel}>رجوع للحضور والانصراف</button>}
    </div>
  );
}
