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
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.7-9-7.7zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  gallery: 'M4 4h16v16H4zM9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L4 20',
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

export function Avatar({ name, photo, color = '#A07CFF', size = 50 }) {
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
// One shared speed sampler for the whole app (the top strip and the meter read the same numbers).
const netStore = { hist: [], subs: new Set(), timer: null };
async function netSample() {
  if (!navigator.onLine) { netPush(0); return; }
  let mbps = null;
  try {
    const bytes = 150000;
    const t0 = performance.now();
    const r = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store' });
    await r.arrayBuffer();
    mbps = (bytes * 8) / ((performance.now() - t0) / 1000) / 1e6;
  } catch {
    mbps = navigator.connection?.downlink ?? null;
  }
  if (mbps !== null) netPush(Math.round(mbps * 10) / 10);
}
function netPush(v) {
  netStore.hist = [...netStore.hist, v].slice(-30);
  netStore.subs.forEach((f) => f(netStore.hist));
}
export function useNetSpeed() {
  const online = useOnline();
  const [hist, setHist] = useState(netStore.hist);
  useEffect(() => {
    netStore.subs.add(setHist);
    if (!netStore.timer) { netSample(); netStore.timer = setInterval(netSample, 5000); }
    return () => {
      netStore.subs.delete(setHist);
      if (!netStore.subs.size) { clearInterval(netStore.timer); netStore.timer = null; }
    };
  }, []);
  useEffect(() => { if (!online) netPush(0); else netSample(); }, [online]);
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
    good: ['ممتازة', '#B6F000'], mid: ['متوسطة', '#FFC800'], bad: ['ضعيفة', '#FF7EB0'],
    off: ['مفيش نت', '#FF7EB0'], wait: ['بيقيس…', '#D6E6FF'],
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

// Zoomable photo: buttons, mouse wheel, double-click and drag to move around.
export function ZoomImage({ src, alt = 'صورة', height = 320, big = false }) {
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const set = (nz) => { const v = Math.min(6, Math.max(1, Math.round(nz * 100) / 100)); setZ(v); if (v === 1) setPos({ x: 0, y: 0 }); };
  const onWheel = (e) => { e.preventDefault(); set(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); };
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const down = (e) => { if (z === 1) return; drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const up = () => { drag.current = null; };
  return (
    <div className={'zoom-frame' + (big ? ' big' : '')} style={{ height }}>
      <div ref={boxRef} className="zoom-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => set(z > 1 ? 1 : 2.5)} style={{ cursor: z > 1 ? 'grab' : 'zoom-in' }}>
        <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})` }} />
      </div>
      <div className="zoom-ctl" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="تكبير" onClick={() => set(z * 1.4)}>+</button>
        <span>{Math.round(z * 100)}%</span>
        <button type="button" aria-label="تصغير" onClick={() => set(z / 1.4)} disabled={z <= 1}>−</button>
        {z > 1 && <button type="button" aria-label="رجّع الحجم" onClick={() => set(1)} style={{ fontSize: 12, width: 'auto', padding: '0 8px' }}>1:1</button>}
      </div>
    </div>
  );
}

export function PhotoView({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="overlay" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1000px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ZoomImage src={src} height="min(82vh, 900px)" big />
        <button type="button" className="btn soft" style={{ alignSelf: 'center' }} onClick={onClose}>قفل</button>
      </div>
    </div>
  );
}

export function Spinner({ text = 'لحظة…' }) {
  return <div className="empty">{text}</div>;
}

// "Add to home screen" helper: Android shows the real install prompt, iPhone gets the steps.
let deferredPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; window.dispatchEvent(new Event('mdq-install-ready')); });
}
export function InstallButton() {
  const [ready, setReady] = useState(!!deferredPrompt);
  const [iosHelp, setIosHelp] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  useEffect(() => {
    const f = () => setReady(true);
    window.addEventListener('mdq-install-ready', f);
    return () => window.removeEventListener('mdq-install-ready', f);
  }, []);
  if (standalone || (!ready && !ios)) return null;
  const install = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; setReady(false); return; }
    setIosHelp(true);
  };
  return (
    <div className="stack center" style={{ gap: 6 }}>
      <button type="button" className="btn soft sm" onClick={install}><Icon d="phone" size={18} />ثبّت التطبيق على الموبايل</button>
      {iosHelp && <span className="small muted" style={{ textAlign: 'center', maxWidth: 320 }}>من Safari دوس زرار المشاركة (المربع اللي فيه سهم لفوق)، واختار «إضافة إلى الشاشة الرئيسية».</span>}
    </div>
  );
}

// Wallet look: brand-like colors so each wallet is recognisable at a glance.
export const WALLET_LOOK = {
  insta: { bg: 'linear-gradient(135deg, #4A1F7A 0%, #7B2FBE 48%, #F0653A 100%)', soft: '#F3E8FF', ink: '#4A1F7A', latin: 'InstaPay' },
  vf: { bg: 'linear-gradient(135deg, #B30000 0%, #E60000 60%, #FF4D4D 100%)', soft: '#FFE5E5', ink: '#9B0000', latin: 'Vodafone Cash' },
};

export function WalletMark({ k, size = 44 }) {
  const look = WALLET_LOOK[k] || WALLET_LOOK.insta;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: size * 0.3, background: look.bg, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(74,31,122,.25)' }}>
      <Icon d="phone" size={size * 0.5} stroke={2.2} />
    </span>
  );
}

// A wallet balance field: coloured card, name, hint and a big clear input.
export function WalletField({ k, label, hint, value, onChange, ariaLabel, warn, onPhoto, photo }) {
  const look = WALLET_LOOK[k] || WALLET_LOOK.insta;
  return (
    <div className="wallet-field" style={{ background: look.bg }}>
      <span className="wf-head">
        <WalletMark k={k} size={42} />
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="wf-name">{label}</span>
          <span className="wf-latin">{look.latin}</span>
        </span>
      </span>
      {hint && <span className="wf-hint">{hint}</span>}
      {warn && <span className="wf-warn">{warn}</span>}
      <label className="wf-in">
        <input inputMode="decimal" aria-label={ariaLabel || `رصيد ${label}`} value={value} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()} placeholder="اكتب الرصيد" />
        <span className="small" style={{ color: look.ink, fontWeight: 700 }}>ج</span>
      </label>
      {onPhoto && <PhotoSlot data={photo} onPick={onPhoto} label="صوّر شاشة المحفظة بالرصيد" tone="#fff" light />}
    </div>
  );
}

// Geidea logo (orange drop with the white "g"), embedded so no extra file is needed.
export const GEIDEA_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFwAAAB4CAIAAADwsAIvAAASXElEQVR42u1daXhURdZ+T9XtLZ1OQhLCKgOyYwZE4BN0XGAQgw6jjLu4gQIK6qezOTyOuH2guKAOijCDKyKoqIgOIqDC4KC4EfZFAWWHQBLS6e5031t15kcSWYZ0ktu3s+BXT/9K6m5vnXPqnPOeqiJmRr20aBThMEdKURaCFYOKod6bZqSm0y86GXX3yMOFvONH/uFb3rSdi7Zhz48oLGNRAh0Cm4BV/6DEFJ0x2HjkjSSDohRv28xfLedVS3nnOt5fAKMAWsIgGARBUAAAQoNoZIIsAMkChXds42Xz9fIPeMcaRIPwKBgCaQT2gBjcQGA4HpXy8XEaFGb+erme94rO/xiR3fAKuAU8BDYAoNx8NVBEjjTnQGHwio/VnKm88WNQCD6JgKsSBTSu5gwovPYr9fLjnL8IRhh+CXY1RiwcA4ULD+qXntYfTQcdRqoEG40XC2dA4eVL1HPj+MBqpErgZIAjMVDKQurvT+t5T8AbRuDkgSMBUHbvUhPG6M0fItUA5EmGiB1QeN1K9fBYPrQaqUbDn1zrAhT9yWL15AjwPvhdJ5+A/NRELWRk0UI1YQRwAMbJjEgtJIWXLLIeG4mUAyCJk73VSFL4s0+tR2+B92eBSI1A4a0brMk3w7MP4meBSA1AOXRIPTAGkZ2QPxdEqgNFa+vJ3/Oef8PtajA5j/o2tPr1f/CKuUhPhnvGIAIYGmCAGQ5mRQmQIpFRrBIU3rhGvf4gAgosnESDGIphMkwB4UYgnXQr+FxIJQgnhJEIsTAXbIBQToMSi6kp46AOwjAcGz1mlFlQKWjaWnQ4i87oR227okVLSs+GNBIc26NB4Y0brLF5yCi07XCf+Jv1u6/yxk+R5pTiMEIKMlP8Tx5dcI04vQ/SM5NpJ0WC8ccJQOH9e/XsJ+HXDigOAVELOkMMuEZcOZo6dKsLO5mweTJOZF+nc8lWBxICzAhpkTtEjLyXcs9oxLMP79iuF8+EXySECDEsC7EsedP94tqRkEadfhORw6DouS8iugt+mZDKlCkK5MqHnqFe59bDQFvRcvrGGVB4/1699A2kUGKIWJR5tpz4ArU7tV6EnzeshKuwglRJ3KPlRW+i9AcIkRgiZ8knZtYXIig+pN97CZ6EpoijLo6W6cXvwJsANWFZlNJZTphBrVrXEyIF6rHbuXAVpHBGfXjt17x7TQLWhBFLl+OfolM71O66kmIOBhENg7V9/y0W4fyV+oMX+GA+PIna9SPX60/eB4UAW6AQI6jk1X+iMwfWFMKtm/VnC3jN17xrLQ6FYURAbHs4gCjMILwCHpdzU3IkzPmL4SGbYxWzqN254vo7amYI8/VrU/S3HyG2H24BgxIy7T81j2NMSwUoess6LtiBFHvuCSMWkKPHw+erpmM0ql6YpN99HjgInwGPC8yOJSWcC7MrJWX157AOA7Zkr0yJ3pdSn/Oq6VZYYI2/i9e9iTQD5AKXf0ZiiBCgNZQGkWMh5RFJWbUCHtgaN4ZKE1eNin8dFxWqccP5+4VId4HJmVFlRpjgbUmtMxA1ee9BoBBe6RAowWLs2QzDsIOIqalzX+rRpxqteej3/N1HCLgc48+0Cd1S3vBnuuASys6BsvjHbXr2NP3vF+HTtaJuTgwK793NRXvgtRVllJEYcHn8DK6e8zznv4405xhF1rBayIdniT6/qviLy02dc+UDz9KM1mrWQ0hLyMQIALx/B1TEjj4yw5tNfeNZE/5hi5rzBFKFcxwrIwQ57C9HEDn6e0bcQ7l5iCYU+wgA+H49KGoHWlNT29OpRZt4YjL7OcT2g5zLaTIjvbkYdEkVH0TiN1fCNBIRFQGA9xSCZe0lhWFq6tAjju7w/r16xT+R4iA9wlAgf2dkN6tSp1udBrNJIhORAMBlu2Go2os3gYhyu8T7gi+XIrTbfoRZ5X1d8ZImRAnOzQJglO6C0HZc+1gWNTst3suvWQ6pksKQJLMJmCbCpXZ0noEUIM1fZQeleONWuESjKwkUME2UaTspPM1Id1EgUGWHUJDVPgg0OnZRQCtYbO+1SQbg8lQpSdEwzCI0wpaQCWTW8fgEEs6b2CMxDzVMUAjWYY6Fq/y3z08yx3l7wowAJZ6yTw4oAigCSqoEBSl++MpBYSdlxNLUqUNDBYUA00RJURz1oe65iCknP4AAi6hN94ZqU5jgKuQdq+Pdved50F6HdcedRb36NVxDC5a84bt449rzLGS3hVKOvW9MUec+1KZjAwbFI3jLl4hFq+yQli7ybkTYobmCGDGvuHRUsmvNEgNFCt63iX+IJyxy6E2U1Q2WE0sEy5Q47TxxzoUN2k8BAWaQly2I16dJtrjlQQRTAJ2YqirITDF2Ilyuhg0KAz7WS+chEon3jAt/K676A0LaPrMDjRKfHPE4dfllQ/doKzRo71q9fFE1vW4dJ/JuQam247OwRrFX3jhRXH59I3DzK1TIE9Nzn4cZd7W1NOTdf5O/G4+gB5ZVU7tLjKiFWIYc+4wYMaZxxD4VzS34u+V6wdxquhmGGHuvvG8WpfdAiQlLHRXB8FG/8siGYVookdRmoDHpA3HVjXUZEDpRY8SEFEu9+iidNYCaNq9mEAZcLHr10/Nn6kWv855NQAQugGSFuWECxxCVkOnUvqcYcrMYdCnc7jqOkh0qvDIkSjbqp+6X/ze1+hL+9Exx/f+KK0bx2q/0+pVYu4oLSuEqBQhWgFqnU25fyu1H3X5ZX7XvDoHCQIqhV75Eb/UWV42s0SVeH/U5V/Y5FwC0gmWBCIbhZN6/Pm3KESUSatp4vWRh7d9Cwu2By90QEHEUlPKskr9QTRrJy5eiMTenR0ZIePZbD16vF3/4/6AcfUsD3gPqkZv1nGlI0o41rKB1owKlXF5SC9Xf71TjRvOeXQ4Dsm6VmjgOymoUoHBF/UyFIy8QMPTXL6uxefqdVxAtc+AJhwv19EnWXUP421VJna0NZ+CIaIgmyMkGMwoOQhfBJ8EEv8HmFvXsbfqDmeKy0eL8wfCn2nnAoQO8cLZ+bwYf3AwP4O3RsP0UrRD1i0E3iSHDqdUpAPOuHfrdGfrTmfCWAQLCQAC8b7l68gs96zQ6Z4g4J49O7YoUf/U3LynmjWv1v97VKxehaAu8AgEJM+l8o5GojERT5O3TxSVXHJmXuzaRXadQhzPUP+6CLwYQGDAkAooP5/PcVfrdyZTTjtr3pS6dqHVXZDSH3wuPADMiGuEwF+/ibZuwaT1v+4aLdgFB+AykGhUL6xq6RxuxxHnXHI3IEVt15XBe/4X+/BV46Yh3JyVSAS7jonW8Yj1WWNA+mKnwCfhNMCFoIKbhLgFFQQbcgF8A7p9CxQbv5hPDShdDRlRpw4fcoD97AxQ9psij/NukhI8BN8gCisGASQCQwvCXb9rkBrhCyhqTn6IYORnUuuoypjZtkO6F5ioTMRVhMQFUmUagoxCsN1o+odpTMtzxpkZhQHqTM9TJ45IFAAEp4bJXaE1sBRGtmkv2ppJsmhQu2Y9463XNGGCLaWKC9AEQcLngJTtWXQBFioOhKjv4/fDkgDkpXHIcSQkdgjtk55lM5A4AEDBcSM0AazsiHLVw+HCcoJl6dENMOynqBCgRn0vmgq2gUK0fSgxLQDSpNLT+U6CkHWFzH+Kd8bhk6nEelNtJ9WeGKzM+l8xbdkDbCgKERoa3AhTytoQlak/KMFjyxi3xntL7bMpqD+VcRBtT1LEXta2aS9aad66FW9gZY6GpTYtKUNo2hbRVMuoh3vwVYlWTG+lN6NfXIuyQWSFG1C1+E3dNb+EB3r4RLrJzc+VHTvtK9WnbDdprh74r55J3fh+vyxUj0KSTM8IStahTfzFgcLxQbPWXCO+1UxHDgNtXzkYIAKL5KXCn2JmAiBAr5mWL4/XJzpEj7kfEnTCXrGFlyrH3xmc8eNl7MMzayyVDAZmtqXnLSklp3oqy2kKh1kLOgBd62dz46RJx8WUibzRKOAGLqxB2y5GTqHvfeK+zd6fOX2pr/S1BKWrWHimBSlB8frQrr5ao/Vu7BO/4Vq+IzyWTvHOCOPNmFFt2lJQ1Sl3iur+Kq26qpuOHbyC4005JJgExpu59jol9RO7ZiEpbq1sIHlO/8Vw1FShej3xwsrhoLEpcUKrGXDJgWgilyZsny+F/rqZzUYFe8LL9XRpEiujW+xhQqGdfuJvYzFZ4DN78mV4yv5puXq+85yn5xxfI2xlBE1ofRSQfp5OVW0iUMDU9y3hkrhg2qvps15zpfGiLzWXaWiOtFXXufiwo7TrQKR1g2bKFDKRY6sUJOHSw+vG4+Ao5fYm4ZiL5uyHoQiSGKEMpaA2tYSlEGZEYgl5q1leOec6Y9k86s/pdJHjzajV/OlKlzdWyZSy69kN6k8rZuVI61LSJ+q0HKhJcNnQyaIkBt8i/Tq3pJaWH9aqVvOpf/N12hNcjEgOA1ACldkPXU8XpA6h7b3g8Nct1Ray7r+QfFsJtq8iJGCVS/mWmuHDo8aDwhnzrzoFICdkMVUgj6JZjnheXD6t9Bi9UQVm43PD4anu1mnKffneS/V1wWMNo75qxFFlNj08yUedc6nQmTLvlnSzgj6kZd+ovas8l+/xITUdqug1E9JxX9TtTELBrXwmIKHHmBT8hcmzmTRoi7zqUSfveBAnIoHpsFOevqJsUmX5vrpr2BwTKEtg+isFpYvCwKtOR4vzBlNkxIZdcGijbbz14tf486VyyfnOWevo2BEoSSqpGFXU5m3J7VgkK0jLo4hsSjd8MCXOfeuAG/dasZOERi6rpE9TUO5AaTGjj0/Jq5StuPS7CpONObeFDB9TI/hzbmuhSHdYIu8X5N8kx45GV7WQ2cvt3avJ9vP5tBGSim67FLPrFBcaz846rzT3+ppSVI4beihAnmhkigVRTL51u3ZqnF8xxpuI6VKpnTrVuH8xb3kbAlSgixIh65PV3/He1Mp3gfJ9Q0BqVx0Vfw0iYxCbAUohI6tRfXnkbnT0QHluLOoJB/ck8/fZ03vUN/OxMwVOZST2uMCa99t86QSc89Egv+UBNvBqpyqH9HIGohZibTjld9L+czh5EbTvAVYOax0iIv9+kl87nz97ng5vgUXA5tXOjRjTHmLKQOnU7kQydMN5hre4brVe+hBS3Y6l4AkyFKODKopZdqUMu5fampu3QrAnSssjlATPHylBcgANFvH8Lr1nF277h/duggvABUjr5JoeVHDZBjPxjFYpVRRDIe3daYy6CucXhXZzLtxu1GJYFywXLhwwJI5PgAcAUQVkhghquECTgEpAEcpo8jVrU+nzj2XnwpdQOFAD88fvWw9cjLZosOo7KfadjWSciUDJZZG2BmxuPL6BuuVVGrfHe+ddDxO/uRshMYPVFdeF1ebac6MivPEeTLF6dEfTJWx6Ogwiq9QXlqD+J0y5FSCULl7psxAjHxG/HiqE3Vtex2sRSwQHr7mu5YBm8jflgBWKUWtTjUuORV6sNO6km5xDyjq3qnsu4eH0drMpKFiIhRacMMp6cicwm1WfCanTPNu3lAy8jrR1Ms/FtFU9A2KKW/Y1HZ9QEEdQ8vqTOpxsPzKb0rigzG5N9IaDUpBYD5eMvo1nzGl5UC3+ZuvaSE+dSk7Majd0lRriMOl9kTJ5JzVrU/LraBRF0aif51BzqmIdQtMFvFaNRLMU5I43HZyI7u5Zg2qA1IqXqmQf1wmkIxBriOS7EMBlWqrjqfjn8dhtnFJDtU3D1+zPV9IdgbofX1YDOySJGqaLs7vLuJ+NvQJcUUADw9i36b+N1/nykaBiinvWpnE6M+sV5N8ixfz06EV2noACA1nreLP3aJD68GSkGRH1UvhKgFEKg1n3lyHF0bl7C0uZIYfehA+r1qbzwVY7ugk/WHTQVcGjK7CiGjhVDb4Lf74QKOlftzj9s1W+/oJfNRuku+AQMkUxbw7A0IkSZHUTedTR0OFW9R2B9gvJTIoYXvKGXzuM9ayEi8IgK0pudkAsAlkZUgdKoXS8xaJgYOAQZDh93Qsk6gz0S5lUr9MfzefVSLv4RHIabYEgIgAnENdi2uHLHYGIowLIQFTD8lNOReg8U/YdQbm/HTtqpI1B+aiXFvCFfr17Gq7/F3s1cXAijCFpCAgaDypMpxyVZGJphCrCGIJiZlJOJlt2oZz/R41fUObeqjFnjAeXI1zIK9vPeXbx7I2/ajuA+LvkOByMIlUGbzAogIgHpQZobWWmU0glZTalLR2rRhVq3QkZWHfo6XH/eBWuYJqJRmDHWCiCSEi4XPF646vPotv8AQeTK7eKpYh8AAAAASUVORK5CYII=';
const isGeidea = (name = '') => /جيديا|جيديه|geidea/i.test(String(name));

// Machines: Fawry yellow/blue, Geidea orange, card machines navy, others warm yellow.
export function machineLook(name = '') {
  const n = String(name).toLowerCase();
  if (/فوري|fawry/.test(n)) return { bg: '#FFD21F', head: 'linear-gradient(135deg, #FFD21F 0%, #FFC400 100%)', ink: '#0F5C9E', mark: '#0F5C9E', latin: 'FAWRY' };
  if (isGeidea(n)) return { bg: '#FFE3D6', head: 'linear-gradient(135deg, #FF4E0D 0%, #FF7A3D 100%)', ink: '#FFFFFF', mark: '#FF4E0D', latin: 'GEIDEA' };
  if (/فيزا|visa|ماستر|master|بنك|bank|ميزة|meeza/.test(n)) return { bg: '#E6ECFF', head: 'linear-gradient(135deg, #1A2B6B 0%, #2D4BB8 100%)', ink: '#fff', mark: '#F5B400', latin: 'CARD' };
  return { bg: '#FFF4C2', head: 'linear-gradient(135deg, #FFE27A 0%, #FFC94D 100%)', ink: '#5A4300', mark: '#5A4300', latin: '' };
}

export function MachineMark({ name, size = 40 }) {
  const look = machineLook(name);
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 999, background: '#fff', color: look.mark, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 3px 10px rgba(0,0,0,.15)', overflow: 'hidden' }}>
      {isGeidea(name)
        ? <img src={GEIDEA_LOGO} alt="" style={{ height: size * 0.62, width: 'auto', display: 'block' }} />
        : <Icon d={/فيزا|visa|ماستر|master|ميزة|meeza/i.test(name) ? 'card' : 'up'} size={size * 0.5} stroke={2.6} />}
    </span>
  );
}

// Photo box under an amount: dashed "take a photo" box, or the preview with change / view.
export function PhotoSlot({ data, onPick, label = 'صوّر الشاشة', tone = '#6B6F8A', light }) {
  const [view, setView] = useState(false);
  if (!data) {
    return (
      <button type="button" className={'photo-slot ps-empty' + (light ? ' light' : '')} onClick={onPick} style={{ color: tone }}>
        <Icon d="cam" size={22} />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div className="photo-slot has">
      <span className="ps-frame"><img src={data} alt="الصورة اللي اترفعت" onClick={() => setView(true)} /><span className="ps-ok">✓ اترفعت</span></span>
      <span className="ps-actions">
        <button type="button" onClick={() => setView(true)}><Icon d="eye" size={15} />شوفها كبيرة</button>
        <button type="button" onClick={onPick}><Icon d="cam" size={15} />غيّرها</button>
      </span>
      {view && <PhotoView src={data} onClose={() => setView(false)} />}
    </div>
  );
}

// Drafts: if the phone reloads the page while the camera is open (common on Android),
// the numbers and photos typed so far come back instead of disappearing.
const draftCache = {};
function readDraft(key) {
  if (!(key in draftCache)) {
    try { draftCache[key] = JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { draftCache[key] = {}; }
  }
  return draftCache[key];
}
function writeDraft(key) {
  try { localStorage.setItem(key, JSON.stringify({ ...draftCache[key], _at: Date.now() })); } catch {
    try {
      const d = { ...draftCache[key] };
      Object.keys(d).forEach((k) => { if (/photo/i.test(k)) delete d[k]; });
      localStorage.setItem(key, JSON.stringify(d));
    } catch { /* storage unavailable */ }
  }
}
export function useDraft(key, name, init) {
  const [v, setV] = useState(() => {
    const d = key ? readDraft(key) : null;
    const fresh = d && (!d._at || Date.now() - d._at < 24 * 3600e3);
    return fresh && name in d ? d[name] : typeof init === 'function' ? init() : init;
  });
  useEffect(() => {
    if (!key) return;
    readDraft(key)[name] = v;
    writeDraft(key);
  }, [key, name, v]);
  return [v, setV];
}
export function clearDraft(key) {
  if (!key) return;
  delete draftCache[key];
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
