import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export const IC = {
  up: 'M7 17 17 7M8 7h9v9',
  down: 'M17 7 7 17M16 17H7V8',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  swap: 'M4 7h13l-3-3M20 17H7l3 3',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  plus: 'M5 12h14M12 5v14',
  check: 'M20 6 9 17l-5-5',
  x: 'M6 6l12 12M18 6 6 18',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  cam: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  logout: 'M15 4h4v16h-4M10 17l-5-5 5-5M5 12h10',
  chevron: 'M15 6l-6 6 6 6',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01',
  wifiOff: 'M2 8.5a15 15 0 0 1 4-2.6M9.5 5.2A15 15 0 0 1 22 8.5M5.5 12a10 10 0 0 1 3-1.9M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  warn: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  copy: 'M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h10',
  print: 'M6 9V3h12v6M3 9h18v8H3zM6 14h12v7H6z',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1',
  shop: 'M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export function Icon({ d, size = 20, stroke = 2.2, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={IC[d] || d} />
    </svg>
  );
}

export function Avatar({ name, photo, color = '#B79CFF', size = 50 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: color }} title={name}>
      {photo ? <img src={photo} alt="" /> : (
        <svg width={size * 0.88} height={size * 0.88} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="15" r="7.5" fill="#15142A" />
          <path d="M5 40c1.5-9 7.5-13.5 15-13.5S33.5 31 35 40z" fill="#15142A" />
        </svg>
      )}
    </span>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef();
  const show = useCallback((msg, kind = 'ok') => {
    setT({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div role="status" className={'toast' + (t.kind === 'err' ? ' err' : '')}>
          <span className="ok">{t.kind === 'err' ? '!' : '✓'}</span>{t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

// Internet speed meter: measures a small download every few seconds.
export function useNetSpeed(points = 30) {
  const online = useOnline();
  const [hist, setHist] = useState([]);
  useEffect(() => {
    let stop = false;
    async function sample() {
      if (!navigator.onLine) { setHist((h) => [...h, 0].slice(-points)); return; }
      let mbps = null;
      try {
        const bytes = 150000;
        const t0 = performance.now();
        const r = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store' });
        await r.arrayBuffer();
        const secs = (performance.now() - t0) / 1000;
        mbps = (bytes * 8) / secs / 1e6;
      } catch {
        mbps = navigator.connection?.downlink ?? null;
      }
      if (!stop && mbps !== null) setHist((h) => [...h, Math.round(mbps * 10) / 10].slice(-points));
    }
    sample();
    const id = setInterval(sample, 5000);
    return () => { stop = true; clearInterval(id); };
  }, [points]);
  return { online, hist };
}

export function NetMeter({ dark = true }) {
  const { online, hist } = useNetSpeed();
  const now = online ? (hist[hist.length - 1] ?? null) : 0;
  const vals = hist.length ? hist : [0];
  const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
  const min = Math.min(...vals);
  const maxV = Math.max(20, ...vals) * 1.1;
  const W = 222, H = 50;
  const pts = vals.map((v, i) => [vals.length === 1 ? W : (i * W) / (vals.length - 1), H - (v / maxV) * (H - 4)]);
  const line = pts.map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ');
  const lvl = !online ? 'off' : now === null ? 'wait' : now >= 15 ? 'good' : now >= 5 ? 'mid' : 'bad';
  const st = {
    good: ['ممتازة', '#C6F432'], mid: ['متوسطة', '#FFD84D'], bad: ['ضعيفة', '#FFA8C5'],
    off: ['مفيش نت', '#FFA8C5'], wait: ['بيقيس…', '#DCEBFA'],
  }[lvl];
  const last = pts[pts.length - 1];
  return (
    <div className="net" role="group" aria-label="سرعة النت" style={dark ? null : { background: '#F2F0F8', color: '#15142A' }}>
      <span className="spread">
        <span className="small soft" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon d={online ? 'wifi' : 'wifiOff'} size={16} />سرعة النت</span>
        <span className="badge" style={{ background: st[1], color: '#15142A' }}>{st[0]}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.2 }}>{now === null ? '…' : now.toFixed(1)}</span>
        <span className="small soft">ميجا/ثانية</span>
      </span>
      <svg width="100%" height="52" viewBox={`0 0 ${W} 52`} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
        <line x1="0" y1="51" x2={W} y2="51" stroke="rgba(255,255,255,0.25)" />
        {vals.length > 1 && <polygon points={`0,${H} ${line} ${W},${H}`} fill={st[1]} opacity="0.2" />}
        <polyline points={line} fill="none" stroke={st[1]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="4.5" fill="#fff" stroke={st[1]} strokeWidth="2.5" />
      </svg>
      <span className="tiny soft">{online ? `متوسط ${avg.toFixed(1)} · أقل قراية ${min.toFixed(1)}` : 'العمليات بتتحفظ وهترفع لما النت يرجع'}</span>
    </div>
  );
}

export function CopyBtn({ value, label = 'نسخ' }) {
  const toast = useToast();
  return (
    <button type="button" className="copy" aria-label={label} title={label}
      onClick={() => { navigator.clipboard?.writeText(String(value).replace(/,/g, '')); toast('اتنسخ: ' + value); }}>
      <Icon d="copy" size={15} />
    </button>
  );
}

export function Modal({ title, color, icon, onClose, children, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-label={title} className="modal" style={width ? { maxWidth: width } : null}>
        <div className="spread">
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {icon && <span style={{ width: 50, height: 50, borderRadius: 999, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={icon} size={24} /></span>}
            <h2 style={{ fontSize: 24, fontWeight: 700 }}>{title}</h2>
          </span>
          {onClose && <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon d="x" /></button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function PhotoView({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="overlay" style={{ alignItems: 'center' }} onClick={onClose}>
      <img src={src} alt="صورة" style={{ maxHeight: '90vh', borderRadius: 20, background: '#fff' }} />
    </div>
  );
}

export function Spinner({ text = 'لحظة…' }) {
  return <div className="empty">{text}</div>;
}
