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
  const [setupShop, setSetupShop] = useState(null);
  const toast = useToast();
  const newShop = async () => {
    const name = window.prompt('اسم المحل الجديد');
    if (!name?.trim()) return;
    const ref = doc(collection(db, 'shops'));
    const b = writeBatch(db);
    b.set(ref, { ...DEFAULT_SHOP, name: name.trim(), createdAt: serverTimestamp(), openShift: null, lastHandover: null });
    b.set(doc(db, 'shopsPublic', ref.id), { name: name.trim(), logo: null, cashiers: [] });
    await b.commit();
    setSetupShop(ref.id);
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
            {tab === 'setup' && <ShopPicker shops={shops} value={setupShop} onChange={setSetupShop} onNew={newShop} />}
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
      {tab === 'review' && <Review profile={profile} shops={shops} />}
      {tab === 'safes' && <Safes shops={shops} />}
      {tab === 'reports' && <Reports profile={profile} shops={shops} />}
      {tab === 'ledger' && <Ledger profile={profile} shops={shops} canReview={canReview} />}
      {tab === 'setup' && <Setup profile={profile} shops={shops} sel={setupShop} setSel={setSetupShop} />}
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
      <button type="button" className={'sp-btn' + (cur ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox">
        <Icon d="shop" size={20} />
        <span className="stack" style={{ gap: 0, alignItems: 'flex-start' }}>
          <span className="tiny" style={{ opacity: 0.8 }}>بتعدّل في</span>
          <strong>{cur ? cur.name : 'اختار المحل'}</strong>
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
          <button type="button" className="sp-item add" onClick={() => { setOpen(false); onNew(); }}><Icon d="plus" size={18} />محل جديد</button>
        </div>
      )}
    </div>
  );
}
