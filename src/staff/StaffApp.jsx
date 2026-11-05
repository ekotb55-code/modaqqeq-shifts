import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth, db, SUPER_ADMINS } from '../firebase';
import Activity from './Activity.jsx';
import { Avatar, Icon, Modal, useToast } from '../ui.jsx';
import { DEFAULT_SHOP, ROLE_LABEL, allOpen, isAdminRole } from '../lib';
import Review from './Review.jsx';
import Ledger from './Ledger.jsx';
import Reports from './Reports.jsx';
import Setup from './Setup.jsx';
import Safes from './Safes.jsx';
import { NetStrip, ThemePicker, useTheme } from '../theme.jsx';
import { HelpButton, TourHost, useTour } from '../Tour.jsx';
import { STAFF_PAGE, staffShell } from '../tours.js';
import { logAct, logout } from '../activity.js';

export default function StaffApp({ profile }) {
  const isAdmin = isAdminRole(profile.role);
  const canReview = isAdmin || ['reviewer', 'accountant'].includes(profile.role);
  // the login & activity log: Modaqqeq's owner and support only
  const canSeeLog = SUPER_ADMINS.includes((auth.currentUser?.email || profile.email || '').toLowerCase()) || profile.role === 'support';
  const [shops, setShops] = useState([]);
  const tabs = [
    canReview && { id: 'review', label: 'الورديات' },
    canReview && { id: 'safes', label: 'الخزن' },
    { id: 'reports', label: 'التقارير' },
    { id: 'ledger', label: 'العجز والزيادة' },
    isAdmin && { id: 'setup', label: 'الإعداد' },
    canSeeLog && { id: 'activity', label: 'سجل الدخول' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0].id);
  const [theme, setTheme] = useTheme(profile);
  const [themeOpen, setThemeOpen] = useState(false);
  useTour('s-shell', staffShell(tabs), { uid: profile.id, prio: 0 });
  // what each staff member opened, for the activity log
  const tabLabel = tabs.find((t) => t.id === tab)?.label;
  useEffect(() => { if (tabLabel) logAct('view', `فتح صفحة ${tabLabel}`); }, [tabLabel]);
  useTour(`s-${tab}`, STAFF_PAGE[tab] || [], { uid: profile.id, prio: 1, enabled: !!STAFF_PAGE[tab] });
  const [pwOpen, setPwOpen] = useState(false);
  // The branch chosen at the top applies to every tab. 'all' = every branch.
  const [shopSel, setShopSelRaw] = useState(() => { try { return sessionStorage.getItem('mdq-staff-shop') || null; } catch { return null; } });
  const setShopSel = (v) => { setShopSelRaw(v); try { if (v) sessionStorage.setItem('mdq-staff-shop', v); else sessionStorage.removeItem('mdq-staff-shop'); } catch { /* ignore */ } };
  const validSel = shopSel === 'all' || shops.some((x) => x.id === shopSel) ? shopSel : null;
  const effSel = validSel || (shops.length === 1 ? shops[0].id : null);
  const viewShops = effSel && effSel !== 'all' ? shops.filter((x) => x.id === effSel) : shops;
  const setupShop = effSel && effSel !== 'all' ? effSel : null;
  const selName = effSel === 'all' ? 'كل الفروع' : shops.find((x) => x.id === effSel)?.name;
  useEffect(() => { if (selName && shops.length > 1) logAct('branch', `اختار ${selName === 'كل الفروع' ? 'كل الفروع' : `فرع ${selName}`}`, { shopId: effSel !== 'all' ? effSel : null }); }, [selName]); // eslint-disable-line react-hooks/exhaustive-deps
  const toast = useToast();
  const newShop = async () => {
    const name = window.prompt('اسم المحل الجديد');
    if (!name?.trim()) return;
    const ref = doc(collection(db, 'shops'));
    const b = writeBatch(db);
    b.set(ref, { ...DEFAULT_SHOP, name: name.trim(), createdAt: serverTimestamp(), openShift: null, lastHandover: null });
    b.set(doc(db, 'shopsPublic', ref.id), { name: name.trim(), logo: null, cashiers: [] });
    await b.commit();
    setShopSel(ref.id);
    toast('المحل اتعمل');
  };

  useEffect(() => {
    const norm = (s) => ({ ...DEFAULT_SHOP, ...s.data(), id: s.id });
    if (isAdmin) {
      return onSnapshot(collection(db, 'shops'), (q) => setShops(q.docs.map(norm).sort((a, b) => (a.name || '').localeCompare(b.name || ''))), () => {});
    }
    const ids = profile.shopIds || [];
    const map = {};
    const subs = ids.map((id) => onSnapshot(doc(db, 'shops', id), (s) => {
      if (s.exists()) map[id] = norm(s); else delete map[id];
      setShops(ids.filter((x) => map[x]).map((x) => map[x]));
    }, () => {}));
    return () => subs.forEach((u) => u());
  }, [isAdmin, profile.shopIds]);

  return (
    <div>
      <NetStrip />
      <TourHost />
      {pwOpen && <MyPassword onClose={() => setPwOpen(false)} />}
      {themeOpen && <ThemePicker value={theme} onChange={setTheme} onClose={() => setThemeOpen(false)} />}
      <header className="topbar">
        <div className="topbar-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img className="logo-mdq" src="./modaqqeq-logo.png" alt="مدقق" />
            {shops.length > 0 && <ShopPicker shops={shops} value={effSel} onChange={setShopSel} onNew={isAdmin ? newShop : null} />}
          </div>
          <nav className="tabs" data-tour="tabs" aria-label="الأقسام" style={{ boxShadow: 'none', background: 'var(--bg)' }}>
            {tabs.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</button>)}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="who">
              <Avatar name={profile.name} photo={profile.photo} color={profile.color || '#4CC3FF'} size={46} />
              <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 15 }}>{profile.name}</strong><span className="tiny muted">{ROLE_LABEL[profile.role]}</span></span>
            </span>
            <button type="button" className="icon-btn" aria-label="غيّر الباسورد بتاعي" title="غيّر الباسورد بتاعي" onClick={() => setPwOpen(true)}><Icon d="lock" /></button>
            <button type="button" className="icon-btn" aria-label="غيّر شكل التطبيق" title="غيّر شكل التطبيق" onClick={() => setThemeOpen(true)}><Icon d="palette" /></button>
            <HelpButton />
            <button type="button" className="icon-btn" aria-label="تسجيل خروج" title="تسجيل خروج" onClick={logout}><Icon d="logout" /></button>
          </div>
        </div>
      </header>
      {shops.length > 1 && !effSel ? (
        <BranchChooser shops={shops} onPick={setShopSel} onNew={isAdmin ? newShop : null} />
      ) : (
        <>
          {tab === 'review' && <Review key={effSel} profile={profile} shops={viewShops} />}
          {tab === 'safes' && <Safes key={effSel} shops={viewShops} />}
          {tab === 'reports' && <Reports key={effSel} profile={profile} shops={viewShops} />}
          {tab === 'ledger' && <Ledger key={effSel} profile={profile} shops={viewShops} canReview={canReview} />}
          {tab === 'activity' && canSeeLog && <Activity shops={shops} branch={effSel} />}
          {tab === 'setup' && <Setup profile={profile} shops={shops} sel={setupShop} setSel={setShopSel} />}
        </>
      )}
    </div>
  );
}

export function ShopPicker({ shops, value, onChange, onNew }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const cur = shops.find((s) => s.id === value);
  return (
    <div className="shop-picker" ref={ref} data-tour="branch">
      <button type="button" className={'sp-btn' + (cur || value === 'all' ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox">
        <Icon d="shop" size={20} />
        <span className="stack" style={{ gap: 0, alignItems: 'flex-start' }}>
          <span className="tiny" style={{ opacity: 0.8 }}>الفرع</span>
          <strong>{value === 'all' ? 'كل الفروع' : cur ? cur.name : 'اختار الفرع'}</strong>
        </span>
        <Icon d="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      {open && (
        <div className="sp-menu" role="listbox" aria-label="المحلات">
          {shops.map((s) => {
            const o = allOpen(s);
            return (
              <button key={s.id} type="button" role="option" aria-selected={s.id === value} className={'sp-item' + (s.id === value ? ' on' : '')} onClick={() => { onChange(s.id); setOpen(false); }}>
                <strong>{s.name}</strong>
                <span className="tiny">{o.length ? `شغّال · ${o.map((x) => x.cashierName).join('، ')}` : 'مفيش وردية مفتوحة'}</span>
              </button>
            );
          })}
          {shops.length > 1 && (
            <button type="button" role="option" aria-selected={value === 'all'} className={'sp-item' + (value === 'all' ? ' on' : '')} onClick={() => { onChange('all'); setOpen(false); }}>
              <strong>كل الفروع</strong><span className="tiny">في الورديات والخزن والتقارير</span>
            </button>
          )}
          {onNew && <button type="button" className="sp-item add" onClick={() => { setOpen(false); onNew(); }}><Icon d="plus" size={18} />محل جديد</button>}
        </div>
      )}
    </div>
  );
}

export function BranchChooser({ shops, onPick, onNew }) {
  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="title">اختار الفرع</h1>
        <span className="sub">الفرع اللي تختاره هيفضل فوق جنب لوجو مدقق، وكل الصفحات هتشتغل عليه. تقدر تغيّره في أي وقت.</span>
      </div>
      <div className="branch-grid">
        {shops.map((s) => {
          const o = allOpen(s);
          return (
            <button key={s.id} type="button" className="branch-card" onClick={() => onPick(s.id)}>
              <span className="bc-ic"><Icon d="shop" size={26} /></span>
              <strong>{s.name}</strong>
              <span className={'badge ' + (o.length ? 'warn' : 'ok')}>{o.length ? `شغّال · ${o.map((x) => x.cashierName).join('، ')}` : 'مفيش وردية مفتوحة'}</span>
            </button>
          );
        })}
        <button type="button" className="branch-card all" onClick={() => onPick('all')}>
          <span className="bc-ic"><Icon d="dots" size={26} /></span>
          <strong>كل الفروع</strong>
          <span className="tiny muted">تشوف الفروع كلها مع بعض</span>
        </button>
        {onNew && (
          <button type="button" className="branch-card add" onClick={onNew}>
            <span className="bc-ic"><Icon d="plus" size={26} /></span>
            <strong>محل جديد</strong>
          </button>
        )}
      </div>
    </div>
  );
}

function MyPassword({ onClose }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (a.length < 6) { toast('الباسورد الجديد 6 حروف أو أرقام على الأقل', 'err'); return; }
    if (a !== b) { toast('الباسوردين مش زي بعض', 'err'); return; }
    setBusy(true);
    try {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur));
      await updatePassword(u, a);
      setDoc(doc(db, 'cashierSecrets', u.uid), { password: a, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
      logAct('password', 'غيّر الباسورد بتاعه');
      toast('الباسورد اتغيّر');
      onClose();
    } catch (e) {
      toast(['auth/invalid-credential', 'auth/wrong-password'].includes(e.code) ? 'الباسورد الحالي غلط' : 'مش قادرين نغيّره، اتأكد من النت', 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title="غيّر الباسورد بتاعك" icon="lock" color="var(--violet)" onClose={onClose} width={420}>
      <label className="field">الباسورد الحالي<input className="input" type="password" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></label>
      <label className="field">الباسورد الجديد<input className="input" type="password" dir="ltr" value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="field">اكتبه تاني<input className="input" type="password" dir="ltr" value={b} onChange={(e) => setB(e.target.value)} /></label>
      <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'حفظ'}</button>
    </Modal>
  );
}
