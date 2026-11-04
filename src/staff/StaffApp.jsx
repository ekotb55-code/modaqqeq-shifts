import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Avatar, Icon, useToast } from '../ui.jsx';
import { DEFAULT_SHOP, ROLE_LABEL, allOpen } from '../lib';
import Review from './Review.jsx';
import Ledger from './Ledger.jsx';
import Reports from './Reports.jsx';
import Setup from './Setup.jsx';
import Safes from './Safes.jsx';

export default function StaffApp({ profile }) {
  const isAdmin = profile.role === 'admin';
  const canReview = isAdmin || ['reviewer', 'accountant'].includes(profile.role);
  const [shops, setShops] = useState([]);
  const tabs = [
    canReview && { id: 'review', label: 'الورديات' },
    canReview && { id: 'safes', label: 'الخزن' },
    { id: 'reports', label: 'التقارير' },
    { id: 'ledger', label: 'العجز والزيادة' },
    isAdmin && { id: 'setup', label: 'الإعداد' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0].id);
  // The branch chosen at the top applies to every tab. 'all' = every branch.
  const [shopSel, setShopSelRaw] = useState(() => { try { return sessionStorage.getItem('mdq-staff-shop') || null; } catch { return null; } });
  const setShopSel = (v) => { setShopSelRaw(v); try { if (v) sessionStorage.setItem('mdq-staff-shop', v); else sessionStorage.removeItem('mdq-staff-shop'); } catch { /* ignore */ } };
  const validSel = shopSel === 'all' || shops.some((x) => x.id === shopSel) ? shopSel : null;
  const effSel = validSel || (shops.length === 1 ? shops[0].id : null);
  const viewShops = effSel && effSel !== 'all' ? shops.filter((x) => x.id === effSel) : shops;
  const setupShop = effSel && effSel !== 'all' ? effSel : null;
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
      <header className="topbar">
        <div className="topbar-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img className="logo-mdq" src="./modaqqeq-logo.png" alt="مدقق" />
            {shops.length > 0 && <ShopPicker shops={shops} value={effSel} onChange={setShopSel} onNew={isAdmin ? newShop : null} />}
          </div>
          <nav className="tabs" aria-label="الأقسام" style={{ boxShadow: 'none', background: 'var(--bg)' }}>
            {tabs.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</button>)}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="who">
              <Avatar name={profile.name} photo={profile.photo} color={profile.color || '#4CC3FF'} size={46} />
              <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 15 }}>{profile.name}</strong><span className="tiny muted">{ROLE_LABEL[profile.role]}</span></span>
            </span>
            <button type="button" className="icon-btn" aria-label="تسجيل خروج" title="تسجيل خروج" onClick={() => signOut(auth)}><Icon d="logout" /></button>
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
    <div className="shop-picker" ref={ref}>
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
