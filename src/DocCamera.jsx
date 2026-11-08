import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ───────────────────────── Simple Camera ─────────────────────────
// كاميرا عادية جداً بدون أي تتبع أو قص أو فلاتر

// ---------- icons ----------
const Ico = ({ d, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  x: <path d="M6 6l12 12M18 6L6 18" />,
  flashOn: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  flashOff: <><path d="M13 2L9.5 6.7M7.3 9.6L4 14h7l-1 8 4.2-5.6M16.4 12.9L20 10h-7l.6-4.3" /><path d="M3 3l18 18" /></>,
  gallery: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>
};

function CameraUI({ maxSide, quality, title, onDone }) {
  const video = useRef(null);
  const fileRef = useRef(null);
  const trackRef = useRef(null);
  
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('live'); // 'live' | 'review'
  const [result, setResult] = useState(null);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);

  // ── فتح الكاميرا ──
  useEffect(() => {
    let stream = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, 
            audio: false 
        });
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        try {
          const caps = track.getCapabilities?.() || {};
          if (caps.torch) setTorchOk(true);
        } catch { /* ignore */ }
        
        if (video.current) {
            video.current.srcObject = stream;
            await video.current.play().catch(() => {});
        }
      } catch (e) {
        console.error(e);
        setErr('مش قادرين نفتح الكاميرا هنا. تقدر تختار من الصور.');
      }
    })();

    const onKey = (e) => { if (e.key === 'Escape') onDone(null); };
    window.addEventListener('keydown', onKey);
    
    return () => {
      window.removeEventListener('keydown', onKey);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onDone]);

  // ── زرار التصوير ──
  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    try { navigator.vibrate?.(30); } catch { /* ignore */ }
    
    // إنشاء صورة بالحجم المناسب بدون أي تعديلات
    const c = document.createElement('canvas');
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    
    setResult(c.toDataURL('image/jpeg', quality));
    setMode('review');
  };

  // ── اختيار صورة من المعرض ──
  const fromFile = (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        setResult(c.toDataURL('image/jpeg', quality));
        setMode('review');
        URL.revokeObjectURL(url);
    };
    img.onerror = () => setErr('الصورة دي مش بتتفتح، جرّب صورة تانية');
    img.src = url;
  };

  const toggleTorch = async () => {
    const t = trackRef.current; if (!t) return;
    try { await t.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setTorchOk(false); }
  };

  const retake = () => {
    setResult(null);
    setMode('live');
  };

  return (
    <div className="cam-ui" role="dialog" aria-label={title || 'التصوير'}>
      
      {/* ── واجهة الكاميرا الحية ── */}
      <div className="cam-live" style={{ display: mode === 'live' ? 'flex' : 'none' }}>
        <div className="cam-top">
          <button type="button" className="cam-ib" onClick={() => onDone(null)} aria-label="قفل الكاميرا"><Ico d={I.x} /></button>
          <span className="cam-title">{title || 'صوّر'}</span>
          {torchOk ? (
            <button type="button" className={'cam-ib' + (torch ? ' on' : '')} onClick={toggleTorch} aria-label={torch ? 'اطفي الفلاش' : 'نوّر الفلاش'}>
                <Ico d={torch ? I.flashOn : I.flashOff} />
            </button>
          ) : <span className="cam-ib" aria-hidden="true" />}
        </div>
        
        <div className="cam-view">
          {!err && <video ref={video} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {err && (
            <div className="cam-err">
              <span>{err}</span>
              <button type="button" className="cam-cancel" style={{ paddingInline: 24 }} onClick={() => fileRef.current?.click()}>🖼️ اختار من الصور</button>
            </div>
          )}
        </div>
        
        {!err && (
          <div className="cam-controls">
            <div className="cam-row">
              <button type="button" className="cam-gal" onClick={() => fileRef.current?.click()} aria-label="اختار من الصور"><Ico d={I.gallery} size={22} /></button>
              <button type="button" className="cam-shoot" onClick={shoot} aria-label="صوّر">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="37" fill="none" stroke="#fff" strokeWidth="4" />
                </svg>
                <i />
              </button>
              <span />
            </div>
            <span className="cam-info">دوس على الزرار الأبيض علشان تصوّر</span>
          </div>
        )}
      </div>

      {/* ── واجهة مراجعة الصورة ── */}
      {mode === 'review' && result && (
        <div className="cam-rev">
          <div className="cam-top">
            <button type="button" className="cam-ib" onClick={() => onDone(null)} aria-label="قفل الكاميرا"><Ico d={I.x} /></button>
            <span className="cam-title">{title || 'الصورة'}</span>
            <span className="cam-ib" aria-hidden="true" />
          </div>
          
          <div className="cam-panel">
            <img src={result} alt="الصورة المُلتقطة" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
          
          <div className="cam-actions">
            <button type="button" className="cam-cancel" onClick={retake}>صوّر تاني</button>
            <button type="button" className="cam-next" onClick={() => onDone(result)}>التالي</button>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

// ── نقطة الدخول (نفس الدالة اللي بتنادي عليها في باقي التطبيق) ──
export function captureDocument({ maxSide = 1100, quality = 0.7, title } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<CameraUI maxSide={maxSide} quality={quality} title={title} onDone={done} />);
  });
}
