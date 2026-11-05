import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Icon, Modal, useNetSpeed } from './ui.jsx';

// Five looks with the same layout. Each one only swaps the colour tokens.
export const THEMES = [
  { id: 'mdq', name: 'أزرق مدقق', sw: ['#1565D8', '#B6F000', '#A07CFF', '#FF7A1A'] },
  { id: 'mint', name: 'نعناعي', sw: ['#0E9384', '#FFD23F', '#7FD8C9', '#FF8A5B'] },
  { id: 'sunset', name: 'غروب', sw: ['#E4572E', '#FFC857', '#9B5DE5', '#2EC4B6'] },
  { id: 'night', name: 'ليلي', sw: ['#4C2FB0', '#00E0B0', '#FF6FB5', '#FFB547'] },
  { id: 'girly', name: 'بناتي وردي', sw: ['#E0569B', '#FFB3D9', '#C9A7FF', '#FFC9A8'] },
  { id: 'ocean', name: 'محيط', sw: ['#0077B6', '#FFD166', '#48CAE4', '#EF476F'] },
  { id: 'olive', name: 'زيتوني', sw: ['#4F772D', '#F4A259', '#90A955', '#BC4B51'] },
  { id: 'coffee', name: 'قهوة', sw: ['#6F4E37', '#F2C14E', '#C08552', '#7FB7BE'] },
  { id: 'peach', name: 'بناتي خوخي', sw: ['#FF7F6E', '#9EE6CF', '#FFC2B4', '#FFE29A'] },
  { id: 'lavender', name: 'بناتي لافندر', sw: ['#9B6BD6', '#BDE0FE', '#FFC8DD', '#E2CFFF'] },
];

const key = (uid) => `mdq-theme-${uid || 'guest'}`;
export function applyTheme(id) {
  document.documentElement.dataset.theme = THEMES.some((t) => t.id === id) ? id : 'mdq';
}
export function useTheme(profile) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(key(profile?.id)) || profile?.theme || 'mdq'; } catch { return profile?.theme || 'mdq'; }
  });
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => () => applyTheme('mdq'), []);
  const choose = (id) => {
    setTheme(id);
    try { localStorage.setItem(key(profile?.id), id); } catch { /* ignore */ }
    if (profile?.id) updateDoc(doc(db, 'users', profile.id), { theme: id }).catch(() => {});
  };
  return [theme, choose];
}

export function ThemePicker({ value, onChange, onClose }) {
  return (
    <Modal title="اختار شكل التطبيق" icon="palette" color="var(--blue)" onClose={onClose} width={560}>
      <span className="small muted">نفس الشاشات بس بألوان تانية. اختيارك بيتحفظ على حسابك.</span>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} type="button" className={'theme-card' + (value === t.id ? ' on' : '')} onClick={() => onChange(t.id)} aria-pressed={value === t.id}>
            <span className="theme-prev" style={{ background: `linear-gradient(135deg, ${t.sw[0]} 0%, ${t.sw[0]} 55%, ${t.sw[2]} 100%)` }}>
              <span className="tp-bar" />
              <span className="tp-dots">{t.sw.slice(1).map((c) => <i key={c} style={{ background: c }} />)}</span>
              {value === t.id && <span className="tp-ok"><Icon d="check" size={16} stroke={3} /></span>}
            </span>
            <strong>{t.name}</strong>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Thin ruler fixed at the very top: shows the live internet speed, turns red when it drops.
export function NetStrip() {
  const { online, hist } = useNetSpeed();
  const now = online ? hist[hist.length - 1] ?? null : 0;
  const lvl = !online ? 'off' : now === null ? 'wait' : now >= 15 ? 'good' : now >= 5 ? 'mid' : 'bad';
  useEffect(() => {
    document.body.classList.toggle('net-off', lvl === 'off');
    document.body.classList.toggle('net-bad', lvl === 'bad');
    return () => document.body.classList.remove('net-off', 'net-bad');
  }, [lvl]);
  const pct = lvl === 'off' ? 100 : now === null ? 8 : Math.min(100, Math.max(4, (now / 30) * 100));
  const label = { off: 'مفيش نت · اللي بتسجله بيتحفظ ويترفع أول ما النت يرجع', wait: 'بنقيس سرعة النت…', good: 'النت ممتاز', mid: 'النت متوسط', bad: 'النت ضعيف' }[lvl];
  return (
    <div className={'net-strip ' + lvl} role="status" aria-live="polite">
      <span className="ns-fill" style={{ width: `${pct}%` }} />
      <span className="ns-ticks" aria-hidden="true" />
      <span className="ns-text"><Icon d={online ? 'wifi' : 'wifiOff'} size={13} />{label}{online && now !== null ? ` · ${now.toFixed(1)} ميجا` : ''}</span>
    </div>
  );
}

// Short animated intro, once per session.
export function Intro({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2300);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="intro" onClick={onDone} role="presentation">
      <span className="in-shape s1" /><span className="in-shape s2" /><span className="in-shape s3" /><span className="in-shape s4" />
      <div className="in-center">
        <img src="./modaqqeq-logo.png" alt="مدقق" className="in-logo" />
        <span className="in-line">استلام وتسليم الورديات</span>
        <span className="in-sub">من غير ورق ولا كشكول</span>
        <span className="in-dots"><i /><i /><i /></span>
      </div>
    </div>
  );
}
