import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ───────── In-app guided tour ─────────
// Each screen registers its own steps with useTour(). A step points at an element marked
// data-tour="name" (missing elements are skipped). The host shows the tours a user hasn't seen yet,
// once per user and device, and the "؟" button replays everything on the current screen.

const tours = new Map();
const subs = new Set();
const ping = () => subs.forEach((f) => f());
const seenKey = (t) => `mdq-tour-${t.uid || 'x'}-${t.id}`;
const isSeen = (t) => { try { return localStorage.getItem(seenKey(t)) === '1'; } catch { return true; } };
const markSeen = (t) => { try { localStorage.setItem(seenKey(t), '1'); } catch { /* ignore */ } };

export function useTour(id, steps, { uid, prio = 1, enabled = true } = {}) {
  const ref = useRef(steps);
  ref.current = steps;
  useEffect(() => {
    if (!enabled) return undefined;
    tours.set(id, { id, uid, prio, get steps() { return ref.current; } });
    ping();
    return () => { tours.delete(id); ping(); };
  }, [id, uid, prio, enabled]);
}

export const startTour = () => window.dispatchEvent(new Event('mdq-tour'));

export function HelpButton() {
  return (
    <button type="button" className="icon-btn help-btn" data-tour="help" aria-label="اشرحلي الصفحة دي" title="اشرحلي الصفحة دي" onClick={startTour}>؟</button>
  );
}

export function TourHost() {
  const [run, setRun] = useState(null);
  useEffect(() => {
    let timer = 0;
    const pick = (all) => [...tours.values()].filter((t) => all || !isSeen(t)).sort((a, b) => a.prio - b.prio);
    const check = () => {
      clearTimeout(timer);
      // wait a moment so the page settles (data loaded, inner screens mounted)
      timer = setTimeout(() => {
        // don't cover the intro, the camera or an open window: try again a bit later
        if (document.querySelector('.intro, .cam-ui, .overlay')) { check(); return; }
        setRun((cur) => {
        if (cur) return cur;
        const list = pick(false);
          return list.length ? { list, steps: list.flatMap((t) => t.steps) } : null;
        });
      }, 1100);
    };
    const all = () => { clearTimeout(timer); const list = pick(true); if (list.length) setRun({ list, steps: list.flatMap((t) => t.steps) }); };
    subs.add(check);
    window.addEventListener('mdq-tour', all);
    check();
    return () => { subs.delete(check); window.removeEventListener('mdq-tour', all); clearTimeout(timer); };
  }, []);
  if (!run) return null;
  const done = () => { run.list.forEach(markSeen); setRun(null); setTimeout(ping, 0); };
  return <Tour steps={run.steps} onDone={done} />;
}

const visible = (el) => !!el && el.getClientRects().length > 0;
const find = (sel) => { if (!sel) return null; const all = document.querySelectorAll(`[data-tour="${sel}"]`); return [...all].find(visible) || null; };

function Tour({ steps, onDone }) {
  // only steps whose element is on the screen now (or general steps with no element)
  const [list] = useState(() => steps.filter((s) => !s.at || find(s.at)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [vw, setVw] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const card = useRef(null);
  const [ch, setCh] = useState(180);
  const step = list[i];
  const last = i === list.length - 1;
  const next = () => (last ? onDone() : setI(i + 1));

  useEffect(() => {
    if (!step) return undefined;
    const el = find(step.at);
    if (el && !el.closest('.topbar')) {
      // center small parts; tall ones start just under the sticky header
      const r = el.getBoundingClientRect(), vh = window.innerHeight;
      const head = document.querySelector('.topbar')?.offsetHeight || 0;
      const top = r.height > (vh - head) * 0.55 ? r.top - head - 16 : r.top - (vh - r.height) / 2;
      window.scrollTo({ top: Math.max(0, window.scrollY + top), behavior: 'smooth' });
    }
    let raf = 0;
    const loop = () => {
      // small phones shrink the page with CSS zoom: convert screen pixels to the page's pixels
      const z = (document.body.getBoundingClientRect().width / (document.body.offsetWidth || 1)) || 1;
      const e = find(step.at);
      if (e) {
        const b = e.getBoundingClientRect(), r = { x: b.x / z, y: b.y / z, w: b.width / z, h: b.height / z };
        setRect((o) => (o && Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.w - r.w) < 0.5 && Math.abs(o.h - r.h) < 0.5 ? o : r));
      } else setRect(null);
      const W = window.innerWidth / z, H = window.innerHeight / z;
      setVw((o) => (Math.abs(o.w - W) < 0.5 && Math.abs(o.h - H) < 0.5 ? o : { w: W, h: H }));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);
  useLayoutEffect(() => { if (card.current) setCh(card.current.offsetHeight); }, [i, rect?.w, vw.w]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onDone();
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { if (!list.length) onDone(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!step) return null;

  const pad = 8, gap = 14, M = 12;
  const spot = step.at && rect ? { left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2 } : null;
  const cw = Math.min(380, vw.w - M * 2);
  let pos;
  if (!spot) pos = { left: (vw.w - cw) / 2, top: Math.max(M, (vw.h - ch) / 2) };
  else {
    const below = spot.top + spot.height + gap, above = spot.top - gap - ch;
    const top = below + ch <= vw.h - M ? below : above >= M ? above
      : spot.top + spot.height / 2 > vw.h / 2 ? M : vw.h - ch - M; // big element: dock to the free side
    const left = Math.min(vw.w - cw - M, Math.max(M, spot.left + spot.width / 2 - cw / 2));
    pos = { left, top };
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={step.title}>
      <div className="tour-block" onClick={(e) => e.stopPropagation()} style={spot ? undefined : { background: 'rgba(15,14,30,.62)' }} />
      {spot && <div className="tour-spot" style={spot} />}
      <div className="tour-card" key={i} ref={card} style={{ ...pos, width: cw }}>
        {step.hello && <img src="./modaqqeq-logo.png" alt="مدقق" className="tour-logo" />}
        <div className="tour-head">
          <strong>{step.title}</strong>
          {list.length > 1 && <span className="tour-count">{i + 1} / {list.length}</span>}
        </div>
        <p className="tour-text">{step.text}</p>
        {list.length > 1 && <div className="tour-dots" aria-hidden="true">{list.map((s, k) => <i key={k} className={k === i ? 'on' : k < i ? 'past' : ''} />)}</div>}
        <div className="tour-actions">
          {!last ? <button type="button" className="link" onClick={onDone}>تخطّي الشرح</button> : <span />}
          <span style={{ display: 'flex', gap: 8 }}>
            {i > 0 && <button type="button" className="btn soft sm" onClick={() => setI(i - 1)}>رجوع</button>}
            <button type="button" className="btn sm" onClick={next} autoFocus>{last ? (step.end || 'تمام، فهمت') : 'التالي'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
