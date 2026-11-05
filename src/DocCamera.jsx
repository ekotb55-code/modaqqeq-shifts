import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ───────── Finding the document / screen in a picture ─────────
// Works on a small copy: the receipt or the machine screen is usually the largest bright area,
// so we threshold (Otsu), keep the biggest bright blob and take its box.
function detectBox(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    g[j] = v; hist[v]++;
  }
  const total = w * h;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  const mask = new Uint8Array(total);
  let bright = 0;
  for (let i = 0; i < total; i++) if (g[i] > thr) { mask[i] = 1; bright++; }
  if (bright < total * 0.06 || bright > total * 0.9) return null;
  // Largest 4-connected bright blob.
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let bestBox = null, bestN = 0;
  for (let s = 0; s < total; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= total || seen[q] || !mask[q]) continue;
        if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
        seen[q] = 1; stack[sp++] = q;
      }
    }
    if (n > bestN) { bestN = n; bestBox = { x0, y0, x1, y1 }; }
  }
  if (!bestBox) return null;
  const bw = bestBox.x1 - bestBox.x0 + 1, bh = bestBox.y1 - bestBox.y0 + 1;
  const area = bw * bh;
  if (area < total * 0.08 || bestN / area < 0.45 || area > total * 0.97) return null;
  const m = 0.02;
  return {
    x: Math.max(0, bestBox.x0 / w - m), y: Math.max(0, bestBox.y0 / h - m),
    w: Math.min(1, bw / w + 2 * m), h: Math.min(1, bh / h + 2 * m),
  };
}

function boxOfImage(img) {
  const W = 160, H = Math.max(1, Math.round((img.height / img.width) * W));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  return detectBox(ctx, W, H);
}

function cropTo(img, box, maxSide, quality) {
  const sx = box ? box.x * img.width : 0, sy = box ? box.y * img.height : 0;
  const sw = box ? Math.min(img.width - sx, box.w * img.width) : img.width;
  const sh = box ? Math.min(img.height - sy, box.h * img.height) : img.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function CameraUI({ maxSide, quality, title, onDone }) {
  const video = useRef(null);
  const overlay = useRef(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(true);
  const [shot, setShot] = useState(null); // { img, box }
  const boxRef = useRef(null);

  useEffect(() => {
    let stream = null, timer = null, alive = true;
    const small = document.createElement('canvas');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        timer = setInterval(() => {
          const v = video.current;
          if (!v || !v.videoWidth) return;
          const W = 160, H = Math.round((v.videoHeight / v.videoWidth) * W);
          small.width = W; small.height = H;
          const ctx = small.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, W, H);
          const b = detectBox(ctx, W, H);
          const prev = boxRef.current;
          // Smooth the frame so it doesn't jump.
          boxRef.current = b && prev ? { x: prev.x * 0.5 + b.x * 0.5, y: prev.y * 0.5 + b.y * 0.5, w: prev.w * 0.5 + b.w * 0.5, h: prev.h * 0.5 + b.h * 0.5 } : b;
          drawOverlay();
        }, 250);
      } catch (e) {
        console.error(e);
        setErr('مش قادرين نفتح الكاميرا هنا. اسمح للتطبيق يستخدم الكاميرا، أو اختار صورة من الموبايل.');
      }
    })();
    return () => { alive = false; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drawOverlay = () => {
    const c = overlay.current, v = video.current;
    if (!c || !v || !v.videoWidth) return;
    const r = v.getBoundingClientRect();
    c.width = r.width; c.height = r.height;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    // video is object-fit: contain inside the box
    const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const vw = v.videoWidth * s, vh = v.videoHeight * s, ox = (r.width - vw) / 2, oy = (r.height - vh) / 2;
    const b = boxRef.current;
    if (!b) return;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, c.width, c.height);
    const x = ox + b.x * vw, y = oy + b.y * vh, w = b.w * vw, h = b.h * vh;
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = '#B6F000'; ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#B6F000';
    const L = 22;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, dx, dy]) => { ctx.fillRect(cx, cy, L * dx, 6 * dy); ctx.fillRect(cx, cy, 6 * dx, L * dy); });
  };

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const img = await loadImg(c.toDataURL('image/jpeg', 0.92));
    setShot({ img, box: boxRef.current });
  };
  const fromFile = async (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try { const img = await loadImg(url); setShot({ img, box: boxOfImage(img) }); } catch { setErr('الصورة دي مش بتتفتح، جرّب صورة تانية'); }
  };
  const accept = (useBox) => onDone(cropTo(shot.img, useBox ? shot.box : null, maxSide, quality));
  const preview = shot ? cropTo(shot.img, auto ? shot.box : null, 900, 0.8) : null;

  return (
    <div className="cam-ui" role="dialog" aria-label={title || 'التصوير'}>
      <div className="cam-top">
        <button type="button" className="cam-x" onClick={() => onDone(null)} aria-label="قفل">✕</button>
        <strong>{title || 'صوّر'}</strong>
        <span style={{ width: 44 }} />
      </div>
      {!shot ? (
        <>
          <div className="cam-view">
            {!err && <video ref={video} playsInline muted autoPlay />}
            {!err && <canvas ref={overlay} className="cam-overlay" />}
            {err && (
              <div className="cam-err">
                <span>{err}</span>
                <button type="button" className="btn lime" onClick={() => camRef.current?.click()}>📷 افتح كاميرا الموبايل</button>
              </div>
            )}
          </div>
          <span className="cam-hint">{err ? '' : 'وجّه الكاميرا على الفاتورة أو الشاشة · الإطار الأخضر بيحددها لوحده'}</span>
          <div className="cam-bar">
            <button type="button" className="cam-side" onClick={() => fileRef.current?.click()}>🖼️<span>من الصور</span></button>
            <button type="button" className="cam-shoot" onClick={capture} disabled={!!err} aria-label="صوّر" />
            <span className="cam-side" style={{ visibility: 'hidden' }} />
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => fromFile(e.target.files?.[0])} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => fromFile(e.target.files?.[0])} />
        </>
      ) : (
        <>
          <div className="cam-view"><img src={preview} alt="الصورة بعد القص" className="cam-result" /></div>
          <span className="cam-hint">{shot.box ? (auto ? '✓ اتقصّت على الفاتورة / الشاشة' : 'الصورة كاملة') : 'مقدرناش نحدد الفاتورة، هتتبعت الصورة كاملة'}</span>
          <div className="cam-bar">
            <button type="button" className="cam-side" onClick={() => setShot(null)}>↺<span>صوّر تاني</span></button>
            <button type="button" className="btn lime" style={{ height: 60, paddingInline: 28, fontSize: 18 }} onClick={() => accept(auto && !!shot.box)}>✓ تمام</button>
            {shot.box ? <button type="button" className="cam-side" onClick={() => setAuto(!auto)}>{auto ? '⤢' : '✂'}<span>{auto ? 'الصورة كاملة' : 'قص تلقائي'}</span></button> : <span className="cam-side" style={{ visibility: 'hidden' }} />}
          </div>
        </>
      )}
    </div>
  );
}

// Opens the camera over the page and resolves with a JPEG data URL (or null).
export function captureDocument({ maxSide = 1100, quality = 0.7, title } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<CameraUI maxSide={maxSide} quality={quality} title={title} onDone={done} />);
  });
}
