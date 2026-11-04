import { useEffect, useMemo, useState } from 'react';
import { signOut, updatePassword } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Icon, Avatar, Modal, Spinner, useToast } from '../ui.jsx';
import { DEFAULT_SHOP, cashierPassword, firstName, pickImage, timeStr } from '../lib';
import { Topbar } from './parts.jsx';
import Receive from './Receive.jsx';
import Dash from './Dash.jsx';
import Handover from './Handover.jsx';

async function changeMyPhoto(shopId, profile, toast) {
  const data = await pickImage(300, 0.8);
  if (!data) return;
  try {
    await updateDoc(doc(db, 'shopsPublic', shopId), { [`photos.${profile.id}`]: data });
    toast('صورتك اتغيرت');
  } catch (e) { console.error(e); toast('مش قادرين نغيّر الصورة، اتأكد من النت', 'err'); }
}

export default function CashierApp({ profile }) {
  const toast = useToast();
  const shopId = profile.shopIds?.[0];
  const [shop, setShop] = useState(undefined);
  const [pub, setPub] = useState(null);
  const [shift, setShift] = useState(null);
  const [entries, setEntries] = useState([]);
  const [screen, setScreen] = useState('dash');
  const [done, setDone] = useState(null);
  const [askLogout, setAskLogout] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (!shopId) return undefined;
    const a = onSnapshot(doc(db, 'shops', shopId), (s) => setShop(s.exists() ? { ...DEFAULT_SHOP, ...s.data(), id: s.id } : null), () => setShop(null));
    const b = onSnapshot(doc(db, 'shopsPublic', shopId), (s) => setPub(s.data() || null), () => {});
    return () => { a(); b(); };
  }, [shopId]);

  const open = shop?.openShift;
  const mine = open && open.cashierUid === profile.id;
  const shiftId = mine ? open.id : null;

  useEffect(() => {
    if (!shiftId) { setShift(null); setEntries([]); return undefined; }
    const a = onSnapshot(doc(db, 'shifts', shiftId), (s) => setShift(s.exists() ? { id: s.id, ...s.data() } : null), () => {});
    const b = onSnapshot(query(collection(db, 'shifts', shiftId, 'entries'), orderBy('createdAt', 'desc')),
      (s) => setEntries(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    return () => { a(); b(); };
  }, [shiftId]);

  const logout = () => {
    if (mine && !done) { setAskLogout(true); return; }
    signOut(auth);
  };

  const steps = useMemo(() => {
    if (done) return [{ title: 'الاستلام', n: 1, state: 'done' }, { title: 'العمليات', n: 2, state: 'done' }, { title: 'التسليم', n: 3, state: 'done' }];
    if (!mine) return [{ title: 'الاستلام', n: 1, state: 'on' }, { title: 'العمليات', n: 2, state: '' }, { title: 'التسليم', n: 3, state: '' }];
    return [
      { title: 'الاستلام', n: 1, state: screen === 'receive' ? 'on' : 'done', go: screen !== 'receive' ? () => setScreen('receive') : null },
      { title: 'العمليات', n: 2, state: screen === 'dash' ? 'on' : 'done', go: screen !== 'dash' ? () => setScreen('dash') : null },
      { title: 'التسليم', n: 3, state: screen === 'handover' ? 'on' : '', go: screen !== 'handover' ? () => setScreen('handover') : null },
    ];
  }, [done, mine, screen]);

  if (!shopId) return <NoShop />;
  if (shop === undefined) return <Spinner text="بنحمّل المحل…" />;
  if (shop === null) return <NoShop />;

  const me = { ...profile, photo: pub?.photos?.[profile.id] || profile.photo };
  const active = entries.filter((e) => !e.deleted);
  const deleted = entries.filter((e) => e.deleted);
  const top = <Topbar shopPub={pub} profile={me} onPhoto={() => changeMyPhoto(shopId, profile, toast)} steps={open && !mine && !done ? null : steps} onLogout={logout} posUrl={shop.posUrl} onPin={() => setPinOpen(true)} />;

  let body;
  if (done) body = <Done info={done} profile={me} />;
  else if (open && !mine) body = <Blocked open={open} pub={pub} />;
  else if (!mine) body = <Receive shop={shop} profile={profile} onStarted={() => setScreen('dash')} />;
  else if (!shift) body = <Spinner text="بنفتح ورديتك…" />;
  else if (screen === 'receive') body = <Receive key="edit" shop={shop} profile={profile} editShift={shift} onStarted={() => setScreen('dash')} onCancel={() => setScreen('dash')} />;
  else if (screen === 'handover') body = <Handover shop={shop} shift={shift} entries={active} profile={me} onBack={() => setScreen('dash')} onDone={setDone} />;
  else body = <Dash shop={shop} shift={shift} entries={active} deleted={deleted} profile={me} onHandover={() => setScreen('handover')} onReceive={() => setScreen('receive')} />;

  return (
    <div>
      {top}
      {body}
      {pinOpen && <PinModal onClose={() => setPinOpen(false)} />}
      {askLogout && (
        <div className="overlay">
          <div role="dialog" aria-label="لسه ما سلّمتش" className="modal center" style={{ maxWidth: 460, textAlign: 'center' }}>
            <span style={{ width: 72, height: 72, borderRadius: 999, background: 'var(--warn-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d="warn" size={36} stroke={2} /></span>
            <h2 style={{ fontSize: 24, fontWeight: 700 }}>لسه ما سلّمتش الوردية</h2>
            <span className="muted" style={{ lineHeight: 1.7 }}>لو خرجت دلوقتي الوردية هتفضل مفتوحة باسمك، ومحدش هيقدر يستلم بعدك غير لما ترجع تسلّم.</span>
            <button type="button" className="btn full" onClick={() => { setAskLogout(false); setScreen('handover'); }}>سلّم دلوقتي</button>
            <button type="button" className="btn soft full" onClick={() => signOut(auth)}>اخرج والوردية تفضل مفتوحة</button>
            <button type="button" className="link" onClick={() => setAskLogout(false)}>رجوع</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PinModal({ onClose }) {
  const toast = useToast();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!/^[0-9]{4,8}$/.test(a)) { toast('الرقم السري لازم من 4 لـ 8 أرقام', 'err'); return; }
    if (a !== b) { toast('الرقمين مش زي بعض', 'err'); return; }
    setBusy(true);
    try {
      await updatePassword(auth.currentUser, cashierPassword(a));
      toast('الرقم السري اتغيّر');
      onClose();
    } catch (e) {
      toast(e.code === 'auth/requires-recent-login' ? 'اخرج وادخل تاني وبعدين غيّره' : 'مش قادرين نغيّره، اتأكد من النت', 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title="غيّر الرقم السري" icon="lock" color="var(--violet)" onClose={onClose} width={420}>
      <label className="field">الرقم الجديد (من 4 لـ 8 أرقام)<input className="input" inputMode="numeric" type="password" maxLength={8} dir="ltr" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
      <label className="field">اكتبه تاني<input className="input" inputMode="numeric" type="password" maxLength={8} dir="ltr" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} /></label>
      <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'حفظ'}</button>
    </Modal>
  );
}

function NoShop() {
  return (
    <div className="wrap center">
      <div className="card card-lg center" style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1 style={{ fontSize: 24 }}>الحساب ده مش مربوط بمحل</h1>
        <span className="muted">كلّم دعم مدقق يربطك بالمحل.</span>
        <button type="button" className="btn" onClick={() => signOut(auth)}>تسجيل خروج</button>
      </div>
    </div>
  );
}

function Blocked({ open, pub }) {
  const owner = (pub?.cashiers || []).find((c) => c.uid === open.cashierUid);
  return (
    <div className="wrap center">
      <section className="card card-lg center" style={{ maxWidth: 520, textAlign: 'center', gap: 16 }}>
        <span style={{ width: 84, height: 84, borderRadius: 999, background: 'var(--warn-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d="lock" size={42} stroke={2} /></span>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>مينفعش تستلم دلوقتي</h1>
        <span className="muted" style={{ lineHeight: 1.7 }}>الوردية اللي قبلك لسه مفتوحة ومتسلّمتش. لازم صاحبها يسلّمها الأول، وبعدها تقدر تستلم إنت.</span>
        <div className="m-row" style={{ width: '100%', padding: 12, textAlign: 'right' }}>
          <Avatar name={open.cashierName} photo={pub?.photos?.[open.cashierUid] || owner?.photo} color={owner?.color} size={54} />
          <span className="stack" style={{ gap: 0, flexGrow: 1 }}><strong>{open.cashierName}</strong><span className="small muted">مفتوحة من {timeStr(open.openedAt)}</span></span>
        </div>
        <button type="button" className="btn full" onClick={() => signOut(auth)}>خروج علشان {firstName(open.cashierName)} يدخل ويسلّم</button>
        <span className="small muted">لو {firstName(open.cashierName)} مش موجود، كلّم دعم مدقق يقفل الوردية من عندهم.</span>
      </section>
    </div>
  );
}

function Done({ info, profile }) {
  return (
    <div className="wrap" style={{ maxWidth: 720 }}>
      <section className="card card-lg center" style={{ textAlign: 'center', gap: 18, position: 'relative', overflow: 'hidden' }}>
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true" style={{ position: 'absolute', top: -70, right: -60 }}><circle cx="100" cy="100" r="80" fill="none" stroke="#B6F000" strokeWidth="22" /></svg>
        <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true" style={{ position: 'absolute', bottom: -50, left: -30 }}><rect x="10" y="10" width="120" height="120" rx="40" fill="#A07CFF" /></svg>
        <span style={{ width: 104, height: 104, borderRadius: 999, background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}><Icon d="check" size={52} stroke={3} /></span>
        <h1 style={{ fontSize: 34, fontWeight: 800, position: 'relative' }}>تسلم إيدك يا {firstName(profile.name)}</h1>
        <span className="muted" style={{ position: 'relative' }}>{info.offline ? 'التسليم اتحفظ وهيتبعت للمحاسب أول ما النت يرجع' : 'الوردية اتبعتت للمحاسب'}</span>
        <div className="grid2" style={{ width: '100%', position: 'relative' }}>
          {info.stats.map((s) => (
            <div key={s.label} style={{ background: 'var(--chip)', borderRadius: 22, padding: 14, textAlign: 'right' }}>
              <div className="small muted">{s.label}</div>
              <div style={{ fontSize: 19, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>
        <button type="button" className="btn" style={{ position: 'relative' }} onClick={() => signOut(auth)}>تسجيل خروج</button>
      </section>
    </div>
  );
}
