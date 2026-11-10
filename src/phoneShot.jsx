import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { deleteField, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { captureDocument } from './DocCamera.jsx';
import { isDesktop } from './remoteDraft';

// ───── Take a photo on the computer with the phone ─────
// The computer leaves a request in drafts/{uid}.shot; the phone (same account, app open) shows a prompt,
// opens the scanner camera, and puts the picture back in the same place; the computer picks it up.

const ref = (uid) => doc(db, 'drafts', uid);

function Waiting({ state, title, onCancel }) {
  return (
    <div className="pshot-back" role="dialog" aria-modal="true" aria-label="مستنيين الصورة من الموبايل">
      <div className="pshot-card">
        <span className={'pshot-phone' + (state === 'opened' ? ' on' : '')} aria-hidden="true">📲</span>
        <strong className="pshot-title">{state === 'opened' ? 'الكاميرا اتفتحت على الموبايل…' : 'صوّر من الموبايل'}</strong>
        <span className="pshot-what">{title}</span>
        {state === 'cancelled'
          ? <span className="pshot-text" style={{ color: '#E5484D' }}>التصوير اتلغى من الموبايل.</span>
          : (
            <ol className="pshot-steps">
              <li>افتح تطبيق مدقق على الموبايل بنفس الحساب.</li>
              <li>هيطلعلك «الكمبيوتر طالب صورة» · دوس «صوّر دلوقتي».</li>
              <li>الصورة هتظهر هنا لوحدها.</li>
            </ol>
          )}
        {state !== 'cancelled' && <span className="pshot-wait"><i /><i /><i /> مستنيين الموبايل</span>}
        <button type="button" className="btn soft full" onClick={onCancel}>{state === 'cancelled' ? 'قفل' : 'إلغاء'}</button>
      </div>
    </div>
  );
}

// On the computer: resolves with the photo (JPEG data URL) or null.
export function requestFromPhone({ kind = 'paper', title = 'صوّر', maxSide = 1100, quality = 0.7 } = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2, 10);
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let unsub = null, done = false, state = 'waiting';
    const finish = (v) => {
      if (done) return;
      done = true;
      if (unsub) unsub();
      setDoc(ref(uid), { shot: deleteField() }, { merge: true }).catch(() => {});
      root.unmount(); host.remove();
      resolve(v);
    };
    const draw = () => root.render(<Waiting state={state} title={title} onCancel={() => finish(null)} />);
    draw();
    setDoc(ref(uid), { shot: { id, kind, title, maxSide, quality, status: 'waiting', atMs: Date.now() } }, { merge: true })
      .catch(() => { state = 'cancelled'; draw(); });
    unsub = onSnapshot(ref(uid), (s) => {
      const sh = s.data()?.shot;
      if (!sh || sh.id !== id) return;
      if (sh.status === 'done' && sh.data) finish(sh.data);
      else if (sh.status !== state && ['opened', 'cancelled'].includes(sh.status)) { state = sh.status; draw(); }
    }, () => {});
  });
}

// One function for every photo box: "here" = this device's camera, "phone" = ask the phone.
export function takePhoto(source, opts) {
  return source === 'phone' ? requestFromPhone(opts) : captureDocument(opts);
}

// On the phone: watches for requests from the computer and asks the cashier to shoot.
export function PhoneShotListener({ uid }) {
  const [req, setReq] = useState(null);
  const handled = useRef(new Set());
  useEffect(() => {
    if (!uid || isDesktop()) return undefined;
    return onSnapshot(ref(uid), (s) => {
      const sh = s.data()?.shot;
      // fresh requests only (a forgotten one older than 10 minutes is ignored)
      if (sh && sh.status === 'waiting' && !handled.current.has(sh.id) && Date.now() - (sh.atMs || 0) < 10 * 60 * 1000) {
        setReq(sh);
        try { navigator.vibrate?.([80, 60, 80]); } catch { /* ignore */ }
      } else if (!sh || sh.status !== 'waiting') setReq((r) => (r && (!sh || sh.id === r.id) ? null : r));
    }, () => {});
  }, [uid]);
  if (!req) return null;
  const answer = async (shoot) => {
    const r = req;
    handled.current.add(r.id);
    setReq(null);
    const put = (patch) => setDoc(ref(uid), { shot: { ...r, ...patch } }, { merge: true }).catch(() => {});
    if (!shoot) { put({ status: 'cancelled' }); return; }
    put({ status: 'opened' });
    const data = await captureDocument({ kind: r.kind, title: r.title, maxSide: r.maxSide || 1100, quality: r.quality || 0.7 });
    put(data ? { status: 'done', data } : { status: 'cancelled' });
  };
  return (
    <div className="pshot-back" role="dialog" aria-modal="true" aria-label="الكمبيوتر طالب صورة">
      <div className="pshot-card">
        <span className="pshot-phone on" aria-hidden="true">💻</span>
        <strong className="pshot-title">الكمبيوتر طالب صورة</strong>
        <span className="pshot-what">{req.title}</span>
        <button type="button" className="btn full" style={{ height: 60, fontSize: 18 }} onClick={() => answer(true)}>📷 صوّر دلوقتي</button>
        <button type="button" className="link" onClick={() => answer(false)}>مش دلوقتي</button>
      </div>
    </div>
  );
}
