import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './ui.jsx';
import { timeStr } from './lib';
import { pushOn, registerPush } from './cloud.js';

// ───────── Notifications ─────────
// No server on the free plan, so every device watches its own shifts while the app is open
// (also in the background on the computer) and shows: a bell with a list, a small banner + sound,
// and a phone/computer system notification when the person allowed it.
// What happened while the app was closed shows up the next time it opens.

const LKEY = (uid) => `mdq-notes-${uid}`;
const SKEY = (uid) => `mdq-seen-${uid}`;
const PKEY = (uid, w) => `mdq-primed-${uid}-${w}`;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

let cur = { uid: null, list: [] };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
function load(uid) { if (cur.uid !== uid) cur = { uid, list: read(LKEY(uid), []) }; }
function save() { write(LKEY(cur.uid), cur.list.slice(0, 60)); emit(); }

let banner = null; // { note }
const bsubs = new Set();
const setBanner = (b) => { banner = b; bsubs.forEach((f) => f()); };

function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = new C();
    [0, 0.16].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* ignore */ }
}

async function systemNotify(note) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // with push on, the script already sends a system notification for this: don't show it twice
  if (pushOn()) return;
  const opts = { body: note.body, icon: './icon-192.png', badge: './icon-192.png', tag: note.key, data: { note }, dir: 'rtl', lang: 'ar' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(note.title, opts); return; }
  } catch { /* fall back */ }
  try { const n = new Notification(note.title, opts); n.onclick = () => { window.focus(); openNote(note); n.close(); }; } catch { /* ignore */ }
}

// Called by the watchers. `items` = everything that could notify right now, each with a stable key.
// The very first time a watcher runs on a device it only remembers what's there (no flood of old news).
export function feed(uid, watcher, items) {
  if (!uid) return;
  load(uid);
  const seen = new Set(read(SKEY(uid), []));
  const primed = read(PKEY(uid, watcher), false);
  const fresh = items.filter((n) => !seen.has(n.key));
  if (!fresh.length) { if (!primed) write(PKEY(uid, watcher), true); return; }
  fresh.forEach((n) => seen.add(n.key));
  write(SKEY(uid), [...seen].slice(-600));
  if (!primed) { write(PKEY(uid, watcher), true); return; }
  const now = Date.now();
  const notes = fresh.map((n) => ({ ...n, id: `${n.key}-${now}`, atMs: n.atMs || now, read: false }));
  cur.list = [...notes, ...cur.list].slice(0, 60);
  save();
  beep();
  setBanner({ note: notes[0], more: notes.length - 1 });
  notes.slice(0, 3).forEach((n) => systemNotify(n));
}

let opener = null;
function openNote(note) {
  cur.list = cur.list.map((n) => (n.id === note.id ? { ...n, read: true } : n));
  save();
  setBanner(null);
  if (opener) opener(note);
}

function useNotes(uid) {
  load(uid);
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cur.list);
}

// Bell + list + banner. onOpen(note) takes the person to the shift / chat.
export function NotifyBell({ uid, onOpen }) {
  const list = useNotes(uid);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const box = useRef(null);
  opener = onOpen;
  const unread = list.filter((n) => !n.read).length;
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  // a click on a system notification comes back through the service worker
  useEffect(() => {
    const h = (e) => { if (e.data?.type === 'mdq-note' && e.data.note) openNote(e.data.note); };
    navigator.serviceWorker?.addEventListener('message', h);
    return () => navigator.serviceWorker?.removeEventListener('message', h);
  }, []);
  const allow = async () => {
    try { const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') registerPush(uid); } catch { /* ignore */ }
  };
  // keep this device's notification address fresh (it can change)
  useEffect(() => { if (perm === 'granted') registerPush(uid); }, [uid, perm]);
  const readAll = () => { cur.list = cur.list.map((n) => ({ ...n, read: true })); save(); };

  return (
    <span className="bell-wrap" ref={box}>
      <button type="button" className={'icon-btn bell' + (unread ? ' has' : '')} data-tour="bell" aria-label={unread ? `الإشعارات · ${unread} جديد` : 'الإشعارات'} title="الإشعارات" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon d="bell" />
        {unread > 0 && <span className="bell-n">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="الإشعارات">
          <div className="spread" style={{ padding: '4px 4px 8px' }}>
            <strong>الإشعارات</strong>
            {unread > 0 && <button type="button" className="link" onClick={readAll}>علّم الكل مقروء</button>}
          </div>
          {perm === 'default' && (
            <button type="button" className="bell-allow" onClick={allow}>🔔 فعّل الإشعارات على الجهاز ده<span className="tiny">علشان يوصلك تنبيه حتى لو التطبيق في الخلفية</span></button>
          )}
          {perm === 'denied' && <span className="tiny muted bell-hint">إشعارات الجهاز مقفولة من المتصفح. تقدر تفتحها من إعدادات الموقع (علامة القفل جنب العنوان).</span>}
          <div className="bell-list">
            {list.length === 0 && <span className="tiny muted" style={{ padding: 16, textAlign: 'center' }}>مفيش إشعارات لسه</span>}
            {list.map((n) => (
              <button key={n.id} type="button" className={'bell-item' + (n.read ? '' : ' new')} onClick={() => { setOpen(false); openNote(n); }}>
                <span className="bell-ic" style={{ background: n.color || 'var(--blue)' }}>{n.emoji || '🔔'}</span>
                <span className="stack" style={{ gap: 1, minWidth: 0, textAlign: 'right' }}>
                  <strong>{n.title}</strong>
                  {n.body && <span className="small muted bell-body">{n.body}</span>}
                  <span className="tiny muted">{timeStr(new Date(n.atMs))}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Banner />
    </span>
  );
}

function Banner() {
  const b = useSyncExternalStore((f) => { bsubs.add(f); return () => bsubs.delete(f); }, () => banner);
  useEffect(() => { if (!b) return undefined; const t = setTimeout(() => setBanner(null), 7000); return () => clearTimeout(t); }, [b]);
  if (!b) return null;
  const n = b.note;
  return (
    <button type="button" className="note-banner" onClick={() => openNote(n)} role="status" aria-live="polite">
      <span className="bell-ic" style={{ background: n.color || 'var(--blue)' }}>{n.emoji || '🔔'}</span>
      <span className="stack" style={{ gap: 0, minWidth: 0, textAlign: 'right' }}>
        <strong>{n.title}{b.more > 0 ? ` · و${b.more} كمان` : ''}</strong>
        {n.body && <span className="small bell-body">{n.body}</span>}
      </span>
      <span className="note-x" aria-hidden="true" onClick={(e) => { e.stopPropagation(); setBanner(null); }}>✕</span>
    </button>
  );
}
