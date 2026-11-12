import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './ui.jsx';
import { timeStr } from './lib';
import { pushOn, registerPush } from './cloud.js';
import { NOTE_TYPES, wants } from './notifyPrefs.js';

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

// ── Loud alarm for the accountant: rings until someone presses "تمام، شفتها" ──
// Browsers only allow sound after the person touched the page once, so the sound is "unlocked" on the first tap.
let actx = null;
const audio = () => {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    if (!actx) actx = new C();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  } catch { return null; }
};
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
}
const ALARM_KEY = 'mdq-alarm-on';
export const alarmEnabled = () => { try { return localStorage.getItem(ALARM_KEY) !== '0'; } catch { return true; } };
let alarm = null; // { notes, timer }
const asubs = new Set();
const emitAlarm = () => asubs.forEach((f) => f());
function siren() {
  const ctx = audio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 4; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(i % 2 ? 660 : 990, t0 + i * 0.28);
    g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.26);
    o.connect(g).connect(ctx.destination); o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 0.27);
  }
}
let titleTimer = null, baseTitle = '';
function startAlarm(notes) {
  if (!alarmEnabled()) return;
  if (alarm) { alarm.notes = [...notes, ...alarm.notes].slice(0, 6); emitAlarm(); return; }
  const started = Date.now();
  siren();
  const timer = setInterval(() => {
    if (Date.now() - started > 10 * 60 * 1000) { stopAlarm(); return; } // max 10 minutes
    siren();
  }, 2200);
  alarm = { notes, timer };
  baseTitle = document.title;
  let flip = false;
  titleTimer = setInterval(() => { flip = !flip; document.title = flip ? `🔔 ${notes[0].title}` : baseTitle; }, 1000);
  emitAlarm();
}
export function stopAlarm() {
  if (!alarm) return;
  clearInterval(alarm.timer); clearInterval(titleTimer); document.title = baseTitle || document.title;
  alarm = null; emitAlarm();
}

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
  const loud = notes.filter((n) => n.alarm);
  if (loud.length && alarmEnabled()) startAlarm(loud); else beep();
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
export function NotifyBell({ uid, onOpen, alarmable = false, settings = null }) {
  const [setOpen2, setSetOpen2] = useState(false);
  const [loudOn, setLoudOn] = useState(alarmEnabled);
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
    const h = (e) => {
      if (e.data?.type === 'mdq-note' && e.data.note) openNote(e.data.note);
      if (e.data?.type === 'mdq-push' && e.data.data) {
        const d = e.data.data;
        if (cur.list.some((n) => n.key === d.tag)) return;
        cur.list = [{ key: d.tag, id: `${d.tag}-${Date.now()}`, title: d.title, body: d.body, emoji: '📊', color: '#0E9F6E', shiftId: d.shiftId, shopId: d.shopId, go: d.go || null, atMs: Date.now(), read: false }, ...cur.list].slice(0, 60);
        save();
      }
    };
    navigator.serviceWorker?.addEventListener('message', h);
    return () => navigator.serviceWorker?.removeEventListener('message', h);
  }, []);
  const allow = async () => {
    try { const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') registerPush(uid); } catch { /* ignore */ }
  };
  // keep this device's notification address fresh (it can change)
  useEffect(() => { if (perm === 'granted') registerPush(uid); }, [uid, perm]);
  const readAll = () => { cur.list = cur.list.map((n) => ({ ...n, read: true })); save(); };
  const [diag, setDiag] = useState(null);
  // Checks this device step by step and shows a test notification right away.
  const test = async () => {
    const lines = [];
    const add = (ok, t) => lines.push({ ok, t });
    const p = 'Notification' in window ? Notification.permission : 'unsupported';
    add(p === 'granted', `إذن الإشعارات: ${p === 'granted' ? 'مسموح' : p === 'denied' ? 'مرفوض' : p === 'default' ? 'لسه ماتسألش' : 'الجهاز ده مش بيدعم الإشعارات'}`);
    let reg = null;
    try { reg = await navigator.serviceWorker?.getRegistration(); } catch { /* ignore */ }
    add(!!reg?.active, `خدمة الخلفية: ${reg?.active ? 'شغالة' : 'مش شغالة'}`);
    let sub = null;
    try { sub = await reg?.pushManager?.getSubscription(); } catch { /* ignore */ }
    add(!!sub, `الاشتراك في الإشعارات: ${sub ? 'موجود' : 'مش موجود'}`);
    if (p === 'granted') { const ok = await registerPush(uid); add(ok, `عنوان الإشعارات: ${ok ? 'اتسجّل' : 'ماتسجّلش'}`); }
    try {
      if (reg && p === 'granted') { await reg.showNotification('تجربة من الجهاز 🔔', { body: 'لو شايف الإشعار ده يبقى الموبايل بيعرض إشعارات مدقق', icon: './icon-192.png', tag: 'local-test' }); add(true, 'بعتنا إشعار تجربة دلوقتي: بص فوق في شريط الإشعارات'); }
    } catch (e) { add(false, 'عرض الإشعار فشل: ' + (e?.message || '')); }
    setDiag(lines);
  };

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
          {settings && (
            <>
              <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: '0 6px 8px' }} onClick={() => setSetOpen2(!setOpen2)}>⚙️ اختار الإشعارات اللي توصلك</button>
              {setOpen2 && (
                <div className="bell-prefs">
                  {NOTE_TYPES.map((t) => (
                    <label key={t.key}>
                      <input type="checkbox" checked={wants(settings.profile, t.key)} onChange={(e) => settings.onSave({ ...(settings.profile.notifyPrefs || {}), [t.key]: e.target.checked })} />
                      <span>{t.label}</span>
                    </label>
                  ))}
                  {settings.canAll && (
                    <label>
                      <input type="checkbox" checked={settings.profile.notifyPrefs?.scope === 'all'} onChange={(e) => settings.onSave({ ...(settings.profile.notifyPrefs || {}), scope: e.target.checked ? 'all' : 'mine' })} />
                      <span>من <b>كل الفروع</b> (مش بس الفروع المتسجّلة على حسابي)</span>
                    </label>
                  )}
                  <span className="tiny muted">بيتحفظ على حسابك، ويشتغل على كل أجهزتك.</span>
                </div>
              )}
            </>
          )}
          {alarmable && (
            <label className="bell-toggle">
              <input type="checkbox" checked={loudOn} onChange={(e) => { setLoudOn(e.target.checked); try { localStorage.setItem(ALARM_KEY, e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
              <span>🚨 زمّر بصوت عالي لما وردية تتسلّم (لحد ما تدوس «شفتها»)</span>
            </label>
          )}
          <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: '0 6px 8px' }} onClick={test}>🔧 جرّب الإشعارات على الجهاز ده</button>
          {diag && <div className="bell-diag">{diag.map((l, i) => <span key={i}>{l.ok ? '✅' : '❌'} {l.t}</span>)}</div>}
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
      <AlarmBox />
    </span>
  );
}

function AlarmBox() {
  const a = useSyncExternalStore((f) => { asubs.add(f); return () => asubs.delete(f); }, () => alarm);
  if (!a) return null;
  const n = a.notes[0];
  return (
    <div className="alarm-back" role="alertdialog" aria-modal="true" aria-label={n.title}>
      <div className="alarm-card">
        <span className="alarm-bell" aria-hidden="true">🔔</span>
        <strong className="alarm-title">{n.title}</strong>
        {n.body && <span className="alarm-body">{n.body}</span>}
        {a.notes.length > 1 && <span className="tiny muted">و{a.notes.length - 1} كمان مستنيين</span>}
        <button type="button" className="btn full" style={{ height: 58, fontSize: 18 }} onClick={() => { stopAlarm(); openNote(n); }}>افتح الوردية</button>
        <button type="button" className="btn soft full" onClick={stopAlarm}>تمام، شفتها · وقّف الصوت</button>
      </div>
    </div>
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
