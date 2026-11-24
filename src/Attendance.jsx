import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, Modal } from './ui.jsx';
import { KIND_LABEL, lastPunch, punch, snapPhoto } from './attendance.js';

// شاشة «حضور / انصراف» على جهاز الفرع (كمبيوتر الكاشير + كاميرا).
// الخطوات: اختار اسمك ← حضور ولا انصراف ← الكاميرا شايفاك وانت بتكتب رقمك السري ← بعد آخر رقم بناخد صورة ونسجّل.
// device = بيانات الفرع المحفوظة على الجهاز (mdq-device-shop): shopId, name, cashiers, workers.

const devId = () => { try { let d = localStorage.getItem('mdq-dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('mdq-dev', d); } return d; } catch { return ''; } };

const ERR = {
  'auth/invalid-credential': 'الرقم السري غلط، جرّب تاني',
  'auth/wrong-password': 'الرقم السري غلط، جرّب تاني',
  'bad-pin': 'الرقم السري غلط، جرّب تاني',
  'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني',
  'offline-first': 'أول مرة تسجّل على الجهاز ده محتاج نت · شغّل نت ثواني وجرّب، وبعد كده هيشتغل من غير نت',
  'auth/network-request-failed': 'أول مرة تسجّل على الجهاز ده محتاج نت · شغّل نت ثواني وجرّب، وبعد كده هيشتغل من غير نت',
  'permission-denied': 'الحساب ده مش متسجل في الفرع ده. كلّم المدير.',
  'auth/user-disabled': 'الحساب ده موقوف. كلّم المدير.',
};

export function peopleOf(device) {
  const seen = new Set();
  return [...(device?.cashiers || []), ...(device?.workers || [])].filter((p) => p.uid && p.username && !seen.has(p.uid) && seen.add(p.uid))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

function useCamera(on) {
  const video = useRef(null);
  const [state, setState] = useState('wait'); // wait | ok | none
  useEffect(() => {
    if (!on) return undefined;
    let stream = null;
    let dead = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
        setState('ok');
      } catch (e) { console.warn('camera', e?.name); if (!dead) setState('none'); }
    })();
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on]);
  return [video, state];
}

export default function AttendanceModal({ device, onClose }) {
  const people = peopleOf(device);
  const [who, setWho] = useState(null);
  const [kind, setKind] = useState(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [shake, setShake] = useState(false);
  const [done, setDone] = useState(null);
  const [video, cam] = useCamera(!!(who && kind) && !done);

  const pick = (p) => { setWho(p); setMsg(''); setPin(''); const l = lastPunch(p.uid); setKind(null); setDone(null); setSuggest(l?.kind === 'in' ? 'out' : 'in'); };
  const [suggest, setSuggest] = useState('in');
  const back = () => { if (kind) { setKind(null); setPin(''); setMsg(''); } else { setWho(null); } };

  // بعد ما يخلص يرجع لقايمة الأسامي لوحده
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => { setDone(null); setWho(null); setKind(null); setPin(''); }, 6000);
    return () => clearTimeout(t);
  }, [done]);

  const go = async (p) => {
    setBusy(true); setMsg('');
    const photo = cam === 'ok' ? snapPhoto(video.current) : null;
    try {
      const r = await punch({ person: who, pin: p, kind, shop: device, photo, deviceId: devId() });
      setDone({ ...r, photo, kind, name: who.name });
    } catch (e) {
      setMsg(ERR[e.code] || 'حصلت مشكلة، جرّب تاني');
      setShake(true); setTimeout(() => setShake(false), 450);
      setPin('');
    }
    setBusy(false);
  };
  const press = (d) => {
    if (busy) return;
    if (d === 'del') { setPin((x) => x.slice(0, -1)); return; }
    setMsg('');
    if (pin.length >= 4) return;
    const n = pin + d;
    setPin(n);
    if (n.length === 4) { setBusy(true); setTimeout(() => go(n), 120); }
  };
  useEffect(() => {
    if (!who || !kind || done) return undefined;
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) { e.stopPropagation(); press(e.key); }
      else if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const t = (ms) => new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });

  let body;
  if (done) {
    body = (
      <div className="stack" style={{ alignItems: 'center', gap: 12, textAlign: 'center', padding: '10px 0' }}>
        {done.photo ? <img src={done.photo} alt="" style={{ width: 160, borderRadius: 20 }} /> : <Avatar name={done.name} color={who?.color} size={110} />}
        <span style={{ fontSize: 46 }}>✅</span>
        <h2 className="h2">اتسجّل {KIND_LABEL[done.kind]} {done.name.split(' ')[0]} الساعة {t(done.atMs)}</h2>
        {!done.sent && <span className="badge warn" style={{ whiteSpace: 'normal' }}>مفيش نت دلوقتي: التسجيل محفوظ على الجهاز وهيتبعت لوحده لما النت يرجع، وهيتعلّم ⚠️ للمراجعة.</span>}
        {!done.photo && <span className="badge warn" style={{ whiteSpace: 'normal' }}>الكاميرا مش شغالة، فالتسجيل اتعمل من غير صورة ⚠️</span>}
        <button type="button" className="btn" onClick={() => { setDone(null); setWho(null); setKind(null); setPin(''); }}>تمام</button>
      </div>
    );
  } else if (!who) {
    body = (
      <div className="stack" style={{ gap: 12 }}>
        <span className="muted">اختار اسمك</span>
        <div className="wl-grid">
          {people.map((p) => (
            <button key={p.uid} type="button" className="wl-card" onClick={() => pick(p)}>
              <Avatar name={p.name} photo={p.photo} color={p.color || '#B39DFF'} size={80} />
              <strong>{p.name}</strong>
            </button>
          ))}
        </div>
        {people.length === 0 && <span className="muted">لسه مفيش أسامي على الجهاز ده. الكاشير يدخل مرة بالنت والأسامي هتظهر.</span>}
      </div>
    );
  } else if (!kind) {
    body = (
      <div className="stack" style={{ alignItems: 'center', gap: 16 }}>
        <Avatar name={who.name} photo={who.photo} color={who.color || '#B39DFF'} size={96} />
        <h2 className="h2">أهلًا يا {who.name.split(' ')[0]}</h2>
        <div className="chips" style={{ gap: 12, justifyContent: 'center' }}>
          {['in', 'out'].map((k) => (
            <button key={k} type="button" className={'btn' + (k === suggest ? '' : ' soft')} style={{ minWidth: 150, height: 64, fontSize: 22 }} onClick={() => setKind(k)}>
              {k === 'in' ? '👋 ' : '🏠 '}{KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="button" className="link" onClick={back}>مش أنت؟ اختار اسم تاني</button>
      </div>
    );
  } else {
    body = (
      <div className="chips" style={{ gap: 18, alignItems: 'flex-start', justifyContent: 'center' }}>
        <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
          <div style={{ width: 260, height: 195, borderRadius: 22, overflow: 'hidden', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: cam === 'ok' ? 'block' : 'none' }} />
            {cam !== 'ok' && <span style={{ color: '#fff', padding: 16, textAlign: 'center' }}>{cam === 'wait' ? 'بنفتح الكاميرا…' : 'الكاميرا مش شغالة ⚠️'}</span>}
          </div>
          <span className="tiny muted" style={{ maxWidth: 260, textAlign: 'center' }}>بص للكاميرا. بتسجيلك بتوافق إن الجهاز ياخد صورتك وقت الحضور والانصراف.</span>
        </div>
        <div className="stack wl-pin" style={{ gap: 10 }}>
          <h2 className="h2">{KIND_LABEL[kind]} · {who.name.split(' ')[0]}</h2>
          <span className="muted">{busy ? 'لحظة…' : 'اكتب الرقم السري بتاعك'}</span>
          <div className={'pin-dots' + (shake ? ' shake' : '')} role="status" aria-label={`اتكتب ${pin.length} من 4`}>
            {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
          </div>
          {msg && <span className="badge bad" style={{ whiteSpace: 'normal' }}>{msg}</span>}
          <div className="pin-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} disabled={busy}>{d}</button>)}
            <span />
            <button type="button" onClick={() => press('0')} disabled={busy}>0</button>
            <button type="button" className="pin-del" onClick={() => press('del')} disabled={busy} aria-label="امسح آخر رقم">⌫</button>
          </div>
          <button type="button" className="link" onClick={back}>رجوع</button>
        </div>
      </div>
    );
  }
  return (
    <Modal title="حضور / انصراف" icon="clock" color="#B6F000" onClose={onClose} width={760}>
      {body}
    </Modal>
  );
}

// زرار يفتح الشاشة (على صفحة الدخول وجوه برنامج الكاشير)
export function AttendanceButton({ device, style }) {
  const [open, setOpen] = useState(false);
  if (!device?.attendance) return null;
  return (
    <>
      <button type="button" className="btn" style={{ height: 56, fontSize: 19, ...style }} onClick={() => setOpen(true)}><Icon d="clock" size={22} />حضور / انصراف</button>
      {open && <AttendanceModal device={device} onClose={() => setOpen(false)} />}
    </>
  );
}
