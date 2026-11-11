import { useEffect, useState } from 'react';
import { Icon, useToast } from './ui.jsx';

// ───── "حدّث" button + notice when a newer version of the app is on the site ─────
// The installed app on a phone can stay open for days without reloading, so we compare the
// app file name in the live index.html with the one running now.
const runningJs = () => {
  const el = document.querySelector('script[type="module"][src*="index-"]');
  return el ? el.getAttribute('src').split('/').pop() : null;
};
async function latestJs() {
  const r = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
  const t = await r.text();
  return (t.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0] || null;
}
async function applyUpdate() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* ignore */ }
  try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* ignore */ }
  window.location.reload();
}

let fresh = null; // name of the newer file, when there is one
const subs = new Set();
async function check() {
  const now = runningJs();
  if (!now || !navigator.onLine) return null;
  try {
    const l = await latestJs();
    if (l && l !== now && l !== fresh) { fresh = l; subs.forEach((f) => f()); }
    return l;
  } catch { return null; }
}
let started = false;
function startChecks() {
  if (started) return; started = true;
  setTimeout(check, 15000);
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
function useFresh() {
  const [, set] = useState(0);
  useEffect(() => { startChecks(); const f = () => set((x) => x + 1); subs.add(f); return () => subs.delete(f); }, []);
  return fresh;
}

export function UpdateButton({ noBanner = false }) {
  const toast = useToast();
  const isNew = useFresh();
  const [busy, setBusy] = useState(false);
  const [hide, setHide] = useState(null);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const now = runningJs();
    const l = isNew || await check();
    if (!now || (l && l !== now)) { toast('بننزّل آخر نسخة… اللي كاتبه متحفظ'); applyUpdate(); return; }
    setBusy(false);
    toast(navigator.onLine ? 'عندك آخر نسخة ✓' : 'مفيش نت دلوقتي، جرّب تاني لما النت يرجع');
  };
  return (
    <>
      <button type="button" className={'icon-btn upd-btn' + (isNew ? ' has' : '') + (busy ? ' busy' : '')} onClick={go} aria-label={isNew ? 'فيه نسخة جديدة · حدّث التطبيق' : 'حدّث التطبيق'} title={isNew ? 'فيه نسخة جديدة · دوس علشان تحدّث' : 'حدّث التطبيق'}>
        <Icon d="refresh" />
        {isNew && <span className="upd-dot" />}
      </button>
      {!noBanner && isNew && hide !== isNew && (
        <div className="upd-banner" role="status">
          <span>✨ فيه نسخة جديدة من التطبيق</span>
          <button type="button" className="btn sm" onClick={go} disabled={busy}>{busy ? 'لحظة…' : 'حدّث دلوقتي'}</button>
          <button type="button" className="upd-x" aria-label="بعدين" onClick={() => setHide(isNew)}>✕</button>
        </div>
      )}
    </>
  );
}
