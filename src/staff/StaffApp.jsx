import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Avatar, Icon } from '../ui.jsx';
import { DEFAULT_SHOP, ROLE_LABEL } from '../lib';
import Review from './Review.jsx';
import Ledger from './Ledger.jsx';
import Reports from './Reports.jsx';
import Setup from './Setup.jsx';

export default function StaffApp({ profile, onLinkDevice, linkedShop }) {
  const isAdmin = profile.role === 'admin';
  const canReview = isAdmin || ['reviewer', 'accountant'].includes(profile.role);
  const [shops, setShops] = useState([]);
  const tabs = [
    canReview && { id: 'review', label: 'الورديات' },
    { id: 'reports', label: 'التقارير' },
    { id: 'ledger', label: 'العجز والزيادة' },
    isAdmin && { id: 'setup', label: 'الإعداد' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0].id);

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
          <img className="logo-mdq" src="./modaqqeq-logo.png" alt="مدقق" />
          <nav className="tabs" aria-label="الأقسام" style={{ boxShadow: 'none', background: 'var(--bg)' }}>
            {tabs.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</button>)}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="who">
              <Avatar name={profile.name} photo={profile.photo} color={profile.color || '#8FD3FF'} size={46} />
              <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 15 }}>{profile.name}</strong><span className="tiny muted">{ROLE_LABEL[profile.role]}</span></span>
            </span>
            <button type="button" className="icon-btn" aria-label="تسجيل خروج" title="تسجيل خروج" onClick={() => signOut(auth)}><Icon d="logout" /></button>
          </div>
        </div>
      </header>
      {tab === 'review' && <Review profile={profile} shops={shops} />}
      {tab === 'reports' && <Reports profile={profile} shops={shops} />}
      {tab === 'ledger' && <Ledger profile={profile} shops={shops} canReview={canReview} />}
      {tab === 'setup' && <Setup profile={profile} shops={shops} linkedShop={linkedShop} onLinkDevice={onLinkDevice} />}
    </div>
  );
}
