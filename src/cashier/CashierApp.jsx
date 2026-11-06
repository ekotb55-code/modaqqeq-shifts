import { useEffect, useMemo, useState } from 'react';
import { signOut, updatePassword } from 'firebase/auth';
import { collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Icon, Avatar, Modal, Spinner, useToast } from '../ui.jsx';
import { DEFAULT_SHOP, MAIN_REG, allOpen, cashierPassword, firstName, openOf, regName, registersOf, shopForRegister, timeStr, todayKey } from '../lib';
import { usePendingTransfers } from './Transfers.jsx';
import { AttentionBar, AttentionModal, useAttention } from './Attention.jsx';
import { NetStrip, ThemePicker, useTheme } from '../theme.jsx';
import { TourHost } from '../Tour.jsx';
import MyPhoto from '../MyPhoto.jsx';
import { Topbar } from './parts.jsx';
import Receive from './Receive.jsx';
import Dash from './Dash.jsx';
import Handover from './Handover.jsx';
import Follow from './Follow.jsx';
import { logAct, logout as doLogout } from '../activity.js';

export default function CashierApp({ profile }) {
  const toast = useToast();
  const shopId = profile.shopIds?.[0];
  const [photoOpen, setPhotoOpen] = useState(false);
  const [shop, setShop] = useState(undefined);
  const [pub, setPub] = useState(null);
  const [shift, setShift] = useState(null);
  const [entries, setEntries] = useState([]);
  const [screen, setScreen] = useState('dash');
  const [done, setDone] = useState(null);
  const [askLogout, setAskLogout] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pickReg, setPickReg] = useState(null);
  const pending = usePendingTransfers(shopId);
  const attention = useAttention(profile.id);
  const [attn, setAttn] = useState(null);
  const [theme, setTheme] = useTheme(profile);
  const [themeOpen, setThemeOpen] = useState(false);
  // The cashier's latest handed-in shift (today or yesterday) that isn't open anymore.
  const [recent, setRecent] = useState(null);
  const [skipFollow, setSkipFollow] = useState(false);

  useEffect(() => {
    if (!shopId) return undefined;
    const a = onSnapshot(doc(db, 'shops', shopId), (s) => setShop(s.exists() ? { ...DEFAULT_SHOP, ...s.data(), id: s.id } : null), () => setShop(null));
    const b = onSnapshot(doc(db, 'shopsPublic', shopId), (s) => setPub(s.data() || null), () => {});
    return () => { a(); b(); };
  }, [shopId]);

  useEffect(() => {
    const days = [todayKey(new Date()), todayKey(new Date(Date.now() - 864e5))];
    return onSnapshot(
      query(collection(db, 'shifts'), where('cashierUid', '==', profile.id), where('day', 'in', days)),
      (s) => {
        const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((x) => x.status !== 'open')
          .sort((a, b) => String(b.openedAtLocal || '').localeCompare(String(a.openedAtLocal || '')));
        setRecent(list[0] || null);
      },
      (e) => console.warn('recent shift', e.code),
    );
  }, [profile.id]);

  const regs = registersOf(shop);
  const mineOpen = allOpen(shop).find((o) => o.cashierUid === profile.id) || null;
  const reg = mineOpen ? mineOpen.reg : regs.length ? pickReg : MAIN_REG;
  const open = reg ? openOf(shop, reg) : null;
  const mine = !!mineOpen;
  const shiftId = mine ? mineOpen.id : null;

  useEffect(() => {
    if (!shiftId) { setShift(null); setEntries([]); return undefined; }
    const a = onSnapshot(doc(db, 'shifts', shiftId), (s) => setShift(s.exists() ? { id: s.id, ...s.data() } : null), () => {});
    const b = onSnapshot(query(collection(db, 'shifts', shiftId, 'entries'), orderBy('createdAt', 'desc')),
      (s) => setEntries(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    return () => { a(); b(); };
  }, [shiftId]);

  const logout = () => {
    if (mine && !done) { setAskLogout(true); return; }
    doLogout();
  };

  const showFollow = !done && !mine && !!recent && !skipFollow;

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
  const rshop = reg ? shopForRegister(shop, reg) : shop;
  const incoming = mine ? pending.filter((t) => t.toReg === reg && t.fromShiftId !== shiftId) : [];
  const outgoing = mine ? pending.filter((t) => t.fromShiftId === shiftId) : [];

  const me = { ...profile, photo: pub?.photos?.[profile.id] || profile.photo };
  const active = entries.filter((e) => !e.deleted);
  const deleted = entries.filter((e) => e.deleted);
  const top = <Topbar shopPub={pub} profile={me} regLabel={reg && reg !== MAIN_REG ? regName(shop, reg) : (regs.length && reg ? regName(shop, reg) : null)} onPhoto={() => setPhotoOpen(true)} onTheme={() => setThemeOpen(true)} steps={showFollow || (open && !mine && !done) || !reg ? null : steps} onLogout={logout} posUrl={shop.posUrl} onPin={() => setPinOpen(true)} />;

  let body;
  if (done) body = <Done info={done} profile={me} onFollow={() => setDone(null)} />;
  else if (showFollow) body = <Follow shift={recent} profile={me} onNew={() => setSkipFollow(true)} onEdit={() => setAttn(recent)} />;
  else if (!reg) body = <RegisterPicker shop={shop} pub={pub} regs={regs} onPick={setPickReg} />;
  else if (open && !mine) body = <Blocked open={open} pub={pub} onOther={regs.length ? () => setPickReg(null) : null} />;
  else if (!mine) body = <Receive shop={rshop} reg={reg} profile={profile} onStarted={() => setScreen('dash')} onCancel={regs.length ? () => setPickReg(null) : null} />;
  else if (!shift) body = <Spinner text="بنفتح ورديتك…" />;
  else if (screen === 'receive') body = <Receive key="edit" shop={rshop} reg={reg} profile={profile} editShift={shift} onStarted={() => setScreen('dash')} onCancel={() => setScreen('dash')} />;
  else if (screen === 'handover') body = <Handover shop={rshop} shift={shift} entries={active} incoming={incoming} profile={me} onBack={() => setScreen('dash')} onDone={setDone} />;
  else body = <Dash shop={rshop} fullShop={shop} shift={shift} entries={active} deleted={deleted} incoming={incoming} outgoing={outgoing} profile={me} onHandover={() => setScreen('handover')} onReceive={() => setScreen('receive')} onChat={() => setAttn(shift)} />;

  return (
    <div>
      <NetStrip />
      <TourHost />
      {photoOpen && (
        <MyPhoto profile={me} photo={me.photo} onClose={() => setPhotoOpen(false)}
          onSave={async (data) => {
            await updateDoc(doc(db, 'shopsPublic', shopId), { [`photos.${profile.id}`]: data || deleteField() });
            logAct('photo_self', data ? 'غيّر صورته' : 'شال صورته', { shopId });
          }} />
      )}
      {top}
      {themeOpen && <ThemePicker value={theme} onChange={setTheme} onClose={() => setThemeOpen(false)} />}
      {!done && <AttentionBar list={attention} currentId={shiftId} onOpen={setAttn} />}
      {body}
      {attn && <AttentionModal shift={attn} shop={shop} profile={me} onClose={() => setAttn(null)} />}
      {pinOpen && <PinModal onClose={() => setPinOpen(false)} />}
      {askLogout && (
        <div className="overlay">
          <div role="dialog" aria-label="لسه ما سلّمتش" className="modal center" style={{ maxWidth: 460, textAlign: 'center' }}>
            <span style={{ width: 72, height: 72, borderRadius: 999, background: 'var(--warn-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d="warn" size={36} stroke={2} /></span>
            <h2 style={{ fontSize: 24, fontWeight: 700 }}>لسه ما سلّمتش الوردية</h2>
            <span className="muted" style={{ lineHeight: 1.7 }}>لو خرجت دلوقتي الوردية هتفضل مفتوحة باسمك، ومحدش هيقدر يستلم بعدك غير لما ترجع تسلّم.</span>
            <button type="button" className="btn full" onClick={() => { setAskLogout(false); setScreen('handover'); }}>سلّم دلوقتي</button>
            <button type="button" className="btn soft full" onClick={() => doLogout()}>اخرج والوردية تفضل مفتوحة</button>
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
      setDoc(doc(db, 'cashierSecrets', auth.currentUser.uid), { pin: a, updatedAt: serverTimestamp() }).catch(() => {});
      logAct('password', 'غيّر الرقم السري بتاعه');
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
        <button type="button" className="btn" onClick={() => doLogout()}>تسجيل خروج</button>
      </div>
    </div>
  );
}

function RegisterPicker({ shop, pub, regs, onPick }) {
  const opens = allOpen(shop);
  const list = [{ id: MAIN_REG, name: 'الكاشير الأساسي', kind: 'main' }, ...regs];
  const kindLabel = { main: 'الدرج الأساسي', sub: 'كاشير فرعي', delivery: 'دليفري' };
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="title">هتشتغل على أنهي درج النهارده؟</h1>
        <span className="sub">اختار الدرج اللي هتستلمه</span>
      </div>
      <div className="grid2">
        {list.map((r) => {
          const o = opens.find((x) => x.reg === r.id);
          const who = o && (pub?.cashiers || []).find((c) => c.uid === o.cashierUid);
          return (
            <button key={r.id} type="button" className="card" onClick={() => onPick(r.id)} style={{ textAlign: 'right', cursor: 'pointer', border: o ? '2px solid #FFD27A' : '2px solid transparent', gap: 10 }}>
              <span className="spread">
                <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 20 }}>{r.name}</strong><span className="small muted">{kindLabel[r.kind] || ''}</span></span>
                <span className={'badge ' + (o ? 'warn' : 'ok')}>{o ? 'شغّال' : 'فاضي'}</span>
              </span>
              {o ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={o.cashierName} photo={pub?.photos?.[o.cashierUid] || who?.photo} color={who?.color} size={36} />
                  <span className="small">{o.cashierName} · من {timeStr(o.openedAt)}</span>
                </span>
              ) : <span className="small muted">دوس علشان تستلم</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Blocked({ open, pub, onOther }) {
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
        {onOther && <button type="button" className="btn full" onClick={onOther}>اختار درج تاني</button>}
        <button type="button" className={'btn full' + (onOther ? ' soft' : '')} onClick={() => doLogout()}>خروج علشان {firstName(open.cashierName)} يدخل ويسلّم</button>
        <span className="small muted">لو {firstName(open.cashierName)} مش موجود، كلّم دعم مدقق يقفل الوردية من عندهم.</span>
      </section>
    </div>
  );
}

function Done({ info, profile, onFollow }) {
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
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', position: 'relative' }}>
          {onFollow && <button type="button" className="btn" onClick={onFollow}>تابع الوردية وكلّم المحاسب</button>}
          <button type="button" className="btn soft" onClick={() => doLogout()}>تسجيل خروج</button>
        </span>
      </section>
    </div>
  );
}
