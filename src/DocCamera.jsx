import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ───────────────────────── Document scanner camera ─────────────────────────
// Live: finds the receipt / machine screen in the camera, draws a blue frame that follows its 4 corners,
// and (in auto mode) shoots by itself once the phone is steady.
// After the shot: straightens the paper (perspective), filters, crop & rotate by hand.

const FULL = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

// What we're looking for. Receipts/invoices = paper; InstaPay & wallets = a phone screen; machines = the machine's screen.
const KINDS = {
  paper: { screen: false, minArea: 0.07, minFill: 0.6, what: 'الفاتورة أو الإيصال', got: 'لقطنا الورقة', guide: [0.7, 0.78], filter: 'auto' },
  phone: { screen: true, minArea: 0.04, minFill: 0.72, what: 'شاشة الموبايل', got: 'لقطنا شاشة الموبايل', guide: [0.5, 0.66], filter: 'orig' },
  machine: { screen: true, minArea: 0.03, minFill: 0.72, what: 'شاشة المكنة', got: 'لقطنا شاشة المكنة', guide: [0.74, 0.42], filter: 'orig' },
};

// ---------- corner detection on a small copy of the frame ----------
function findQuad(ctx, w, h, kind = 'paper') {
  const { data } = ctx.getImageData(0, 0, w, h);
  const total = w * h;
  const g0 = new Uint8Array(total);
  for (let i = 0, j = 0; j < total; i += 4, j++) g0[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  // light blur so text inside the receipt doesn't break it into pieces
  const g = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += g0[yy * w + xx]; n++; }
      }
      g[y * w + x] = s / n;
    }
  }
  // Otsu threshold
  const hist = new Array(256).fill(0);
  for (let i = 0; i < total; i++) hist[g[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128, gap = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; gap = mF - mB; }
  }
  if (gap < 24) return null; // flat picture, nothing stands out
  const K = KINDS[kind] || KINDS.paper;
  // passes: normal split, then only the brightest part (white paper on a light table, a lit screen),
  // and for screens the dark body of the phone / machine around it.
  let p98 = 255;
  for (let t = 255, acc = 0; t >= 0; t--) { acc += hist[t]; if (acc > total * 0.02) { p98 = t; break; } }
  const passes = [{ t: thr, inv: false }];
  if (p98 - thr > 25) passes.push({ t: Math.round(thr + (p98 - thr) * 0.55), inv: false });
  // a phone is a dark body around its screen → try its outline first (keeps the app header in the picture)
  // (dark threshold split again inside the dark half, so a mid-tone table isn't counted as dark)
  const tDark = otsuRange(hist, 0, thr);
  const dark = [{ t: tDark, inv: true }, { t: thr, inv: true }];
  if (kind === 'phone') passes.unshift(...dark);
  else if (K.screen) passes.push(...dark);
  const mask = new Uint8Array(total);
  const seen = new Int32Array(total);
  const stack = new Int32Array(total);
  for (const pass of passes) {
    let on = 0;
    for (let i = 0; i < total; i++) { const m = pass.inv ? g[i] < pass.t : g[i] > pass.t; mask[i] = m ? 1 : 0; on += mask[i]; }
    if (on < total * K.minArea * 0.7 || on > total * 0.92) continue;
    seen.fill(0);
    const q = bestBlob(mask, seen, stack, w, h, K, kind === 'phone' && pass.inv);
    if (q) return q;
  }
  return null;
}

// Largest blob that looks like a rectangle seen at an angle → its 4 corners (TL, TR, BR, BL), 0..1.
function bestBlob(mask, seen, stack, w, h, K, holes) {
  const total = w * h;
  const blobs = [];
  for (let s = 0; s < total; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, n = 0, edges = 0;
    let minS = 1e9, maxS = -1e9, minD = 1e9, maxD = -1e9, tl = 0, br = 0, tr = 0, bl = 0;
    const id = blobs.length + 1;
    stack[sp++] = s; seen[s] = id;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0) edges |= 1; if (x === w - 1) edges |= 2; if (y === 0) edges |= 4; if (y === h - 1) edges |= 8;
      const S = x + y, D = x - y;
      if (S < minS) { minS = S; tl = p; } if (S > maxS) { maxS = S; br = p; }
      if (D > maxD) { maxD = D; tr = p; } if (D < minD) { minD = D; bl = p; }
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = id; stack[sp++] = p + w; }
    }
    blobs.push({ id, n, edges, c: [tl, tr, br, bl] });
  }
  const big = blobs.filter((b) => b.n >= total * K.minArea * 0.7).sort((a, b) => b.n - a.n);
  for (const b of big) {
    if (b.edges === 15) continue; // touches all 4 sides: that's the background
    if (K.screen && (b.edges & 3) === 3 && (b.edges & 12)) continue; // screens are fully inside the picture
    const q = b.c.map((p) => ({ x: (p % w) + 0.5, y: ((p / w) | 0) + 0.5 }));
    const area = polyArea(q);
    if (area < total * K.minArea || !convex(q)) continue;
    let fill = b.n / area;
    // the phone's screen is a hole inside its dark body: count it as part of the phone
    if (holes && fill < K.minFill) fill = filledCount(seen, stack, w, h, b.id) / area;
    if (fill < K.minFill || fill > 1.3) continue;
    const minEdge = Math.min(...q.map((p, i) => Math.hypot(p.x - q[(i + 1) % 4].x, p.y - q[(i + 1) % 4].y)));
    if (minEdge < Math.min(w, h) * (K.screen ? 0.12 : 0.15)) continue;
    // push the corners out a little (blur eats the edge)
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    return q.map((p) => ({
      x: Math.min(1, Math.max(0, (cx + (p.x - cx) * 1.012) / w)),
      y: Math.min(1, Math.max(0, (cy + (p.y - cy) * 1.012) / h)),
    }));
  }
  return null;
}
function otsuRange(hist, lo, hi) {
  let n = 0, sum = 0;
  for (let t = lo; t <= hi; t++) { n += hist[t]; sum += t * hist[t]; }
  let wB = 0, sumB = 0, best = -1, thr = (lo + hi) >> 1;
  for (let t = lo; t <= hi; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sum - sumB) / wF, between = wB * wF * d * d;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}
// Pixels of blob `id` plus the holes inside it (everything the outside can't reach).
function filledCount(label, stack, w, h, id) {
  const total = w * h, out = new Uint8Array(total);
  let sp = 0, outside = 0;
  const push = (p) => { if (!out[p] && label[p] !== id) { out[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp]; outside++;
    const x = p % w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w); if (p < total - w) push(p + w);
  }
  return total - outside;
}
function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p.x * r.y - r.x * p.y; }
  return Math.abs(a) / 2;
}
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-6) return false;
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}
function detectOn(source, sw, sh, kind, DW = 200) {
  const W = DW, H = Math.max(1, Math.round((sh / sw) * W));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  return findQuad(ctx, W, H, kind);
}
const moved = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

// ---------- straightening (unit square → quad homography, Heckbert) ----------
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y; g = 0; h = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det; h = (dx1 * dy3 - dx3 * dy1) / det;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  return { a, b, c, d, e, f, g, h };
}
function warp(src, quadN, maxSide) {
  const W = src.width, H = src.height, s = src.data;
  const q = quadN.map((p) => ({ x: p.x * (W - 1), y: p.y * (H - 1) }));
  const dist = (u, v) => Math.hypot(u.x - v.x, u.y - v.y);
  let ow = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), oh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(ow, oh, 1));
  ow = Math.max(2, Math.round(ow * k)); oh = Math.max(2, Math.round(oh * k));
  const out = new ImageData(ow, oh), o = out.data;
  const { a, b, c, d, e, f, g, h } = squareToQuad(q);
  let j = 0;
  for (let y = 0; y < oh; y++) {
    const v = (y + 0.5) / oh;
    for (let x = 0; x < ow; x++, j += 4) {
      const u = (x + 0.5) / ow;
      const z = g * u + h * v + 1;
      let sx = (a * u + b * v + c) / z, sy = (d * u + e * v + f) / z;
      if (sx < 0) sx = 0; else if (sx > W - 1.001) sx = W - 1.001;
      if (sy < 0) sy = 0; else if (sy > H - 1.001) sy = H - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      o[j] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      o[j + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      o[j + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      o[j + 3] = 255;
    }
  }
  return out;
}

// ---------- filters ----------
export const FILTERS = [
  { id: 'auto', name: 'محسّنة' },
  { id: 'orig', name: 'الأصلية' },
  { id: 'gray', name: 'رمادي' },
  { id: 'bw', name: 'مستند' },
];
function levels(lum, n) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) hist[lum[i]]++;
  let lo = 0, hi = 255, acc = 0;
  for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc > n * 0.01) { lo = t; break; } }
  acc = 0;
  for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc > n * 0.01) { hi = t; break; } }
  return hi - lo < 30 ? [0, 255] : [lo, hi];
}
function applyFilter(img, id) {
  if (id === 'orig') return img;
  const d = img.data, n = img.width * img.height;
  const lum = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) lum[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  if (id === 'bw') {
    // adaptive threshold against the local average → clean black text on white
    const w = img.width, h = img.height, r = Math.max(6, Math.round(Math.min(w, h) / 22));
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += lum[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const S = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        const mean = S / ((x1 - x0) * (y1 - y0));
        const v = lum[y * w + x];
        const out = v < mean * 0.86 ? Math.max(0, v - 60) : 255;
        const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = out;
      }
    }
    return img;
  }
  const [lo, hi] = levels(lum, n);
  const k = 255 / (hi - lo);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    if (id === 'gray') { const v = (lum[j] - lo) * k; d[i] = d[i + 1] = d[i + 2] = v; continue; }
    d[i] = (d[i] - lo) * k; d[i + 1] = (d[i + 1] - lo) * k; d[i + 2] = (d[i + 2] - lo) * k;
  }
  return img;
}
function toCanvas(img, rot) {
  const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height;
  c0.getContext('2d').putImageData(img, 0, 0);
  if (!rot) return c0;
  const c = document.createElement('canvas');
  const side = rot % 180 !== 0;
  c.width = side ? img.height : img.width; c.height = side ? img.width : img.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(c0, -img.width / 2, -img.height / 2);
  return c;
}
const copyImg = (im) => new ImageData(new Uint8ClampedArray(im.data), im.width, im.height);
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const store = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// ---------- icons ----------
const Ico = ({ d, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  x: <path d="M6 6l12 12M18 6L6 18" />,
  flashOn: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  flashOff: <><path d="M13 2L9.5 6.7M7.3 9.6L4 14h7l-1 8 4.2-5.6M16.4 12.9L20 10h-7l.6-4.3" /><path d="M3 3l18 18" /></>,
  gallery: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  crop: <><path d="M6 2v14a2 2 0 002 2h14" /><path d="M2 6h14a2 2 0 012 2v14" /></>,
  rotate: <><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  magic: <><path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10" /><path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  scan: <><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" /><path d="M7 12h10" /></>,
  full: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  check: <path d="M5 12l5 5 9-10" />,
};

const AUTO_FRAMES = 8; // ≈1.1 s steady → shoot

function CameraUI({ maxSide, quality, title, kind: kindIn, onDone }) {
  const kind = KINDS[kindIn] ? kindIn : 'paper';
  const K = KINDS[kind];
  const video = useRef(null);
  const overlay = useRef(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const trackRef = useRef(null);
  const target = useRef(null); // last detected corners
  const shown = useRef(null); // corners drawn (eased)
  const alpha = useRef(0);
  const steady = useRef(0);
  const busy = useRef(false);
  const modeRef = useRef('live');
  const autoRef = useRef(true);

  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(() => store.get('mdq-cam-auto', '1') === '1');
  const [found, setFound] = useState(false);
  const [progress, setProgress] = useState(0);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const [fx, setFx] = useState(0);
  const [mode, setMode] = useState('live'); // live | review | crop
  const [shot, setShot] = useState(null); // { canvas, data, auto }
  const [quad, setQuad] = useState(FULL);
  const [rot, setRot] = useState(0);
  const [filter, setFilter] = useState(() => store.get(`mdq-cam-filter-${kind}`, K.filter));
  const [showFilters, setShowFilters] = useState(false);
  modeRef.current = mode; autoRef.current = auto;

  // ── camera stream + detection loop ──
  useEffect(() => {
    let stream = null, timer = null, raf = 0, alive = true;
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = overlay.current, v = video.current;
      if (!c || !v || !v.videoWidth || modeRef.current !== 'live') return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const t = target.current;
      if (t) shown.current = shown.current ? shown.current.map((p, i) => ({ x: p.x + (t[i].x - p.x) * 0.35, y: p.y + (t[i].y - p.y) * 0.35 })) : t;
      alpha.current += ((t ? 1 : 0) - alpha.current) * 0.2;
      const q = shown.current;
      const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const vw = v.videoWidth * s, vh = v.videoHeight * s, ox = (r.width - vw) / 2, oy = (r.height - vh) / 2;
      // dashed guide in the shape of what we want (phone / machine screen / paper) while nothing is found
      if (alpha.current < 0.6) {
        const [gw, gh] = K.guide;
        let w = vw * gw, h = vh * gh;
        if (kind === 'phone') { h = Math.min(vh * gh, w * 2.05); w = h / 2.05; }
        const x = ox + (vw - w) / 2, y = oy + (vh - h) / 2, rr = kind === 'phone' ? 26 : 14;
        ctx.globalAlpha = 0.75 * (1 - alpha.current / 0.6);
        ctx.setLineDash([12, 9]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, rr) : ctx.rect(x, y, w, h); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      if (!q || alpha.current < 0.02) return;
      const P = q.map((p) => [ox + p.x * vw, oy + p.y * vh]);
      ctx.globalAlpha = alpha.current;
      ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = 'rgba(66,133,244,.16)'; ctx.fill();
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = '#4F8CFF'; ctx.stroke();
      ctx.fillStyle = '#fff';
      P.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      ctx.globalAlpha = 1;
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        try {
          const caps = track.getCapabilities?.() || {};
          if (caps.torch) setTorchOk(true);
          if (caps.focusMode?.includes?.('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        } catch { /* ignore */ }
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        setReady(true);
        raf = requestAnimationFrame(draw);
        timer = setInterval(() => {
          const v = video.current;
          if (!v || !v.videoWidth || modeRef.current !== 'live' || busy.current) return;
          const W = 200, H = Math.round((v.videoHeight / v.videoWidth) * W);
          if (small.width !== W || small.height !== H) { small.width = W; small.height = H; }
          sctx.drawImage(v, 0, 0, W, H);
          const q = findQuad(sctx, W, H, kind);
          const prev = target.current;
          if (q && prev && moved(q, prev) < 0.02) steady.current++; else steady.current = q ? 1 : 0;
          target.current = q;
          setFound(!!q);
          const p = autoRef.current && q ? Math.min(1, (steady.current - 1) / (AUTO_FRAMES - 1)) : 0;
          setProgress(p);
          if (autoRef.current && q && steady.current >= AUTO_FRAMES) shootRef.current?.();
        }, 140);
      } catch (e) {
        console.error(e);
        setErr('مش قادرين نفتح الكاميرا هنا. اسمح للتطبيق يستخدم الكاميرا، أو صوّر بكاميرا الموبايل.');
      }
    })();
    const onKey = (e) => { if (e.key === 'Escape') onDone(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false; clearInterval(timer); cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openShot = (canvas, q, start) => {
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    setShot({ canvas, data, auto: q, whole: !!start });
    setQuad(start || q || FULL); setRot(0); setShowFilters(false);
    setMode('review');
  };

  const shoot = () => {
    const v = video.current;
    if (busy.current || !v || !v.videoWidth) return;
    busy.current = true;
    setFx((k) => k + 1);
    try { navigator.vibrate?.(30); } catch { /* ignore */ }
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0);
    // sharper corners from a bigger copy of the same frame
    const live = target.current;
    const fine = detectOn(c, c.width, c.height, kind, 480);
    const q = fine && (!live || moved(fine, live) < 0.08) ? fine : live;
    steady.current = 0; setProgress(0);
    openShot(c, q);
    busy.current = false;
  };
  const shootRef = useRef(shoot);
  shootRef.current = shoot;

  const fromFile = async (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImg(url);
      const k = Math.min(1, 2200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
      const found = detectOn(c, c.width, c.height, kind, 480);
      // a screenshot from the gallery is already the screen → keep it whole; the auto frame stays one tap away
      openShot(c, found, K.screen ? FULL : null);
    } catch { setErr('الصورة دي مش بتتفتح، جرّب صورة تانية'); } finally { URL.revokeObjectURL(url); }
  };

  const toggleTorch = async () => {
    const t = trackRef.current; if (!t) return;
    try { await t.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setTorchOk(false); }
  };
  const setAutoMode = (v) => { setAuto(v); store.set('mdq-cam-auto', v ? '1' : '0'); steady.current = 0; setProgress(0); };
  const chooseFilter = (id) => { setFilter(id); store.set(`mdq-cam-filter-${kind}`, id); };
  const retake = () => { setShot(null); setMode('live'); target.current = null; shown.current = null; steady.current = 0; };

  // ── result ──
  const warped = useMemo(() => (shot ? warp(shot.data, quad, maxSide) : null), [shot, quad, maxSide]);
  const finalCanvas = useMemo(() => (warped ? toCanvas(applyFilter(copyImg(warped), filter), rot) : null), [warped, filter, rot]);
  const result = useMemo(() => (finalCanvas ? finalCanvas.toDataURL('image/jpeg', quality) : null), [finalCanvas, quality]);
  const thumbs = useMemo(() => {
    if (!shot || !showFilters) return null;
    const small = warp(shot.data, quad, 150);
    return Object.fromEntries(FILTERS.map((f) => [f.id, toCanvas(applyFilter(copyImg(small), f.id), rot).toDataURL('image/jpeg', 0.7)]));
  }, [shot, quad, rot, showFilters]);

  const hint = err ? '' : !ready ? 'بنفتح الكاميرا…'
    : found ? (auto ? `${K.got}… ثبّت الموبايل ومتحركوش` : `${K.got} · دوس على زرار التصوير`)
      : `حط ${K.what} جوّه الإطار`;

  return (
    <div className="cam-ui" role="dialog" aria-label={title || 'التصوير'}>
      {/* live camera stays mounted so "صوّر تاني" is instant */}
      <div className="cam-live" style={{ display: mode === 'live' ? 'flex' : 'none' }}>
        <div className="cam-top">
          <button type="button" className="cam-ib" onClick={() => onDone(null)} aria-label="قفل الكاميرا"><Ico d={I.x} /></button>
          <span className="cam-title">{title || 'صوّر'}</span>
          {torchOk
            ? <button type="button" className={'cam-ib' + (torch ? ' on' : '')} onClick={toggleTorch} aria-label={torch ? 'اطفي الفلاش' : 'نوّر الفلاش'} aria-pressed={torch}><Ico d={torch ? I.flashOn : I.flashOff} /></button>
            : <span className="cam-ib" aria-hidden="true" />}
        </div>
        <div className="cam-view">
          {!err && <video ref={video} playsInline muted autoPlay />}
          {!err && <canvas ref={overlay} className="cam-overlay" />}
          {!err && <span className={'cam-toast' + (found ? ' found' : '')} role="status" aria-live="polite">{hint}</span>}
          {fx > 0 && <span key={fx} className="cam-flash" />}
          {err && (
            <div className="cam-err">
              <span>{err}</span>
              <button type="button" className="cam-next" style={{ paddingInline: 24 }} onClick={() => camRef.current?.click()}>📷 افتح كاميرا الموبايل</button>
              <button type="button" className="cam-cancel" style={{ paddingInline: 24 }} onClick={() => fileRef.current?.click()}>🖼️ اختار من الصور</button>
            </div>
          )}
        </div>
        {!err && (
          <div className="cam-controls">
            <div className="cam-row">
              <button type="button" className="cam-gal" onClick={() => fileRef.current?.click()} aria-label="اختار من الصور"><Ico d={I.gallery} size={22} /></button>
              <button type="button" className={'cam-shoot' + (auto && found ? ' scanning' : '')} onClick={shoot} disabled={!ready} aria-label="صوّر">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="37" fill="none" stroke="#fff" strokeWidth="4" />
                  {progress > 0 && <circle cx="40" cy="40" r="37" fill="none" stroke="#4F8CFF" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${progress * 232.5} 232.5`} transform="rotate(-90 40 40)" />}
                </svg>
                <i />
              </button>
              <span />
            </div>
            <div className="cam-seg" role="radiogroup" aria-label="طريقة التصوير">
              <button type="button" role="radio" aria-checked={auto} className={auto ? 'on' : ''} onClick={() => setAutoMode(true)}>الالتقاط التلقائي</button>
              <button type="button" role="radio" aria-checked={!auto} className={!auto ? 'on' : ''} onClick={() => setAutoMode(false)}>يدويًا</button>
            </div>
            <span className="cam-info"><Ico d={I.info} size={15} />{auto ? 'ثبّت الموبايل والصورة هتتاخد لوحدها' : 'دوس على الزرار الأبيض علشان تصوّر'} · تقدر تظبط القص بعد التصوير</span>
          </div>
        )}
      </div>

      {mode === 'review' && shot && (
        <div className="cam-rev">
          <div className="cam-top">
            <button type="button" className="cam-ib" onClick={() => onDone(null)} aria-label="قفل الكاميرا"><Ico d={I.x} /></button>
            <span className="cam-title">{title || 'الصورة'}</span>
            <span className="cam-ib" aria-hidden="true" />
          </div>
          <div className="cam-panel">
            {result && <img src={result} alt="الصورة بعد القص والتعديل" />}
            <div className="cam-panel-tools">
              <button type="button" className="cam-round" onClick={retake} aria-label="امسحها وصوّر تاني" title="صوّر تاني"><Ico d={I.trash} size={22} /></button>
              <button type="button" className="cam-round" onClick={() => setMode('crop')} aria-label="القص والتدوير" title="القص والتدوير"><Ico d={I.crop} size={22} /></button>
            </div>
            {shot.whole ? <span className="cam-note">دي الصورة كاملة · لو عايز تقصها دوس «القص والتدوير»</span>
              : !shot.auto && <span className="cam-note">مقدرناش نحدد {K.screen ? 'الشاشة' : 'الورقة'} لوحدنا · ظبطها من «القص والتدوير»</span>}
          </div>
          <div className="cam-chips">
            <button type="button" className="cam-chip" onClick={() => setMode('crop')}><Ico d={I.crop} size={18} />القص والتدوير</button>
            <button type="button" className={'cam-chip' + (showFilters ? ' on' : '')} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><Ico d={I.magic} size={18} />الفلاتر</button>
          </div>
          {showFilters && thumbs && (
            <div className="cam-filters">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={'cam-fl' + (filter === f.id ? ' on' : '')} onClick={() => chooseFilter(f.id)} aria-pressed={filter === f.id}>
                  <img src={thumbs[f.id]} alt="" /><span>{f.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="cam-actions">
            <button type="button" className="cam-cancel" onClick={retake}>صوّر تاني</button>
            <button type="button" className="cam-next" onClick={() => onDone(result)} disabled={!result}>التالي</button>
          </div>
        </div>
      )}

      {mode === 'crop' && shot && (
        <CropView shot={shot} quad={quad} rot={rot} title={title}
          onCancel={() => setMode('review')}
          onDone={(q, r) => { setQuad(q); setRot(r); setMode('review'); }} />
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

// ── Crop & rotate: drag the 4 corners, with a magnifier under the finger ──
function CropView({ shot, quad, rot: rot0, title, onCancel, onDone }) {
  const wrap = useRef(null);
  const box = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [q, setQ] = useState(quad);
  const [rot, setRot] = useState(rot0);
  const [drag, setDrag] = useState(-1);
  const src = useMemo(() => shot.canvas.toDataURL('image/jpeg', 0.85), [shot]);
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const iw = shot.canvas.width, ih = shot.canvas.height;
  const s = size.w ? Math.min(size.w / iw, size.h / ih) : 0;
  const bw = iw * s, bh = ih * s;
  const move = (e) => {
    if (drag < 0 || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setQ((old) => old.map((p, i) => (i === drag ? { x, y } : p)));
  };
  const pts = q.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ');
  const ok = convex(q.map((p) => ({ x: p.x * iw, y: p.y * ih })));
  const L = 116, Z = 2.6;
  const lp = drag >= 0 ? q[drag] : null;

  return (
    <div className="cam-rev">
      <div className="cam-top">
        <button type="button" className="cam-ib" onClick={onCancel} aria-label="رجوع من غير حفظ"><Ico d={I.x} /></button>
        <span className="cam-title">اسحب النقط على الأطراف</span>
        <span className="cam-ib" aria-hidden="true" />
      </div>
      <div className="cam-cropwrap" ref={wrap}>
        {s > 0 && (
          <div className="cam-cropbox" ref={box} style={{ width: bw, height: bh, left: (size.w - bw) / 2, top: (size.h - bh) / 2 }}
            onPointerMove={move} onPointerUp={() => setDrag(-1)} onPointerCancel={() => setDrag(-1)}>
            <img src={src} alt="الصورة الأصلية" draggable={false} />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <path d={`M0,0H1000V1000H0Z M${pts.replace(/ /g, ' L')}Z`} fill="rgba(0,0,0,.5)" fillRule="evenodd" />
              <polygon points={pts} fill="rgba(66,133,244,.12)" stroke={ok ? '#4F8CFF' : '#FF5A5A'} strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </svg>
            {q.map((p, i) => (
              <span key={i} className={'cam-h' + (drag === i ? ' on' : '')} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                role="slider" aria-label={['الركن اللي فوق شمال', 'الركن اللي فوق يمين', 'الركن اللي تحت يمين', 'الركن اللي تحت شمال'][i]} aria-valuenow={Math.round(p.x * 100)}
                onPointerDown={(e) => { e.preventDefault(); box.current?.setPointerCapture?.(e.pointerId); setDrag(i); }} />
            ))}
            {lp && (
              <span className="cam-loupe" style={{
                width: L, height: L,
                left: Math.min(bw - L, Math.max(0, lp.x * bw - L / 2)),
                top: lp.y * bh - L - 40 < 0 ? lp.y * bh + 40 : lp.y * bh - L - 40,
                backgroundImage: `url(${src})`, backgroundSize: `${bw * Z}px ${bh * Z}px`,
                backgroundPosition: `${L / 2 - lp.x * bw * Z}px ${L / 2 - lp.y * bh * Z}px`,
              }} />
            )}
          </div>
        )}
      </div>
      <div className="cam-chips">
        <button type="button" className="cam-chip" onClick={() => setRot((rot + 90) % 360)}><Ico d={I.rotate} size={18} />لف{rot ? ` (${rot}°)` : ''}</button>
        {shot.auto && <button type="button" className="cam-chip" onClick={() => setQ(shot.auto)}><Ico d={I.scan} size={18} />تحديد تلقائي</button>}
        <button type="button" className="cam-chip" onClick={() => setQ(FULL)}><Ico d={I.full} size={18} />الصورة كلها</button>
      </div>
      <div className="cam-actions">
        <button type="button" className="cam-cancel" onClick={onCancel}>رجوع</button>
        <button type="button" className="cam-next" onClick={() => onDone(q, rot)} disabled={!ok}>{ok ? 'تم' : 'النقط متلخبطة'}</button>
      </div>
    </div>
  );
}

// Opens the scanner over the page and resolves with a JPEG data URL (or null).
// kind: 'paper' (receipt / invoice), 'phone' (InstaPay / wallet screen), 'machine' (machine screen).
export function captureDocument({ maxSide = 1100, quality = 0.7, title, kind = 'paper' } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<CameraUI maxSide={maxSide} quality={quality} title={title} kind={kind} onDone={done} />);
  });
}
