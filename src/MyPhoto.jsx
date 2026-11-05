import { useState } from 'react';
import { Avatar, Icon, Modal, useToast } from './ui.jsx';

// Change your own picture: selfie from the front camera or a photo from the gallery, cut to a square.
function squareFrom(file, side = 320, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = side; c.height = side;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
function pick(capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    if (capture) input.setAttribute('capture', capture);
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.onchange = () => done(input.files?.[0] || null);
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

export default function MyPhoto({ profile, photo, onSave, onClose }) {
  const toast = useToast();
  const [next, setNext] = useState(undefined); // undefined = no change, null = remove
  const [busy, setBusy] = useState(false);
  const shown = next === undefined ? photo : next;
  const choose = async (capture) => {
    const f = await pick(capture);
    if (!f) return;
    try { setNext(await squareFrom(f)); } catch { toast('الصورة دي مش بتتفتح، جرّب صورة تانية', 'err'); }
  };
  const save = async () => {
    setBusy(true);
    try { await onSave(next); toast(next ? 'صورتك اتغيرت' : 'الصورة اتشالت'); onClose(); }
    catch (e) { console.error(e); toast('مش قادرين نحفظ الصورة، اتأكد من النت', 'err'); setBusy(false); }
  };
  return (
    <Modal title="صورتك" icon="cam" color="var(--blue)" onClose={onClose} width={420}>
      <div className="stack" style={{ alignItems: 'center', gap: 16 }}>
        <span className="my-photo"><Avatar name={profile.name} photo={shown} color={profile.color || '#4CC3FF'} size={140} /></span>
        <strong style={{ fontSize: 18 }}>{profile.name}</strong>
        <div className="my-photo-btns">
          <button type="button" className="btn soft" onClick={() => choose('user')}><Icon d="cam" size={20} />صوّر سيلفي</button>
          <button type="button" className="btn soft" onClick={() => choose(null)}><Icon d="gallery" size={20} />من الصور</button>
        </div>
        {shown && <button type="button" className="link" onClick={() => setNext(null)}>شيل الصورة</button>}
        <button type="button" className="btn full" disabled={next === undefined || busy} onClick={save}><Icon d="check" size={18} />{busy ? 'بنحفظ…' : 'احفظ الصورة'}</button>
        <span className="tiny muted" style={{ textAlign: 'center' }}>الصورة بتظهر للمحاسب والإدارة جنب اسمك</span>
      </div>
    </Modal>
  );
}
