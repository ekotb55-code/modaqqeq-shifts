import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, Modal } from './ui.jsx';
import { CONSENT_TEXT, KIND_LABEL, lastPunch, punch, saveFace, snapPhoto } from './attendance.js';
import { distance, detectFaces, flatten, loadFace } from './face.js';
import { verifyCashierPin } from './sessions.js';

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

// كاميرات وهمية (برامج زي EOS Webcam Utility أو OBS) بتطلع صورة ثابتة مش الشخص: نتجنبها.
const FAKE_CAM = /virtual|eos webcam|obs|snap camera|droidcam|manycam|xsplit|splitcam|nvidia broadcast|iriun|camo/i;
const CAM_KEY = 'mdq-att-cam';

function useCamera(on) {
  const video = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('wait'); // wait | ok | none
  const [cams, setCams] = useState([]);
  const [camId, setCamIdRaw] = useState(() => { try { return localStorage.getItem(CAM_KEY) || ''; } catch { return ''; } });
  const setCamId = (id) => { setCamIdRaw(id); try { localStorage.setItem(CAM_KEY, id); } catch { /* ignore */ } };
  useEffect(() => {
    if (!on) return undefined;
    let stream = null;
    let dead = false;
    const open = (id) => navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id }, width: { ideal: 640 }, height: { ideal: 480 } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        try { stream = await open(camId); } catch { stream = await open(''); }
        // أسامي الكاميرات بتبان بعد أول إذن. لو اللي اشتغلت وهمية وفيه كاميرا حقيقية، نبدّل عليها.
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        setCams(list);
        const curId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || '';
        const cur = list.find((d) => d.deviceId === curId);
        const real = list.find((d) => !FAKE_CAM.test(d.label));
        if (!camId && cur && FAKE_CAM.test(cur.label) && real) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await open(real.deviceId);
          if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
          setCamIdRaw(real.deviceId);
        } else if (!camId && curId) setCamIdRaw(curId);
        streamRef.current = stream;
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
        setState('ok');
      } catch (e) { console.warn('camera', e?.name); if (!dead) setState('none'); }
    })();
    return () => { dead = true; streamRef.current = null; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on, camId]); // eslint-disable-line react-hooks/exhaustive-deps
  // الشاشة بتتغيّر والفيديو بيتعمل من جديد: نوصّله بنفس الكاميرا المفتوحة
  const attach = (el) => {
    video.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) { el.srcObject = streamRef.current; el.play().catch(() => {}); }
  };
  return [video, state, cams, camId, setCamId, attach];
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
  const [video, cam, cams, camId, setCamId, attachVideo] = useCamera(!!(who && kind) && !done);

  const pick = (p) => { setWho(p); setMsg(''); setPin(''); const l = lastPunch(p.uid); setKind(null); setDone(null); setSuggest(l?.kind === 'in' ? 'out' : 'in'); };
  const [suggest, setSuggest] = useState('in');
  const [enroll, setEnroll] = useState(null); // null | consent | capture
  const back = () => { setEnroll(null); if (kind) { setKind(null); setPin(''); setMsg(''); } else { setWho(null); } };
  const reset = () => { setDone(null); setWho(null); setKind(null); setPin(''); setEnroll(null); };
  // تسجيل الوش: نبدأ نحمّل الموديلات من بدري علشان ميستناش
  useEffect(() => { if (kind === 'enroll') loadFace().catch(() => {}); }, [kind]);

  // بعد ما يخلص يرجع لقايمة الأسامي لوحده
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(reset, done.enrolled ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [done]);

  const go = async (p) => {
    setBusy(true); setMsg('');
    const photo = cam === 'ok' ? snapPhoto(video.current) : null;
    try {
      if (kind === 'enroll') { await verifyCashierPin(who, p); setPin(''); setEnroll('consent'); setBusy(false); return; }
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
    if (!who || !kind || done || enroll) return undefined;
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) { e.stopPropagation(); press(e.key); }
      else if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const t = (ms) => new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' });

  const camBox = (
    <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
      <div style={{ width: 260, height: 195, borderRadius: 22, overflow: 'hidden', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video ref={attachVideo} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: cam === 'ok' ? 'block' : 'none' }} />
        {cam !== 'ok' && <span style={{ color: '#fff', padding: 16, textAlign: 'center' }}>{cam === 'wait' ? 'بنفتح الكاميرا…' : 'الكاميرا مش شغالة ⚠️'}</span>}
      </div>
      {cams.length > 1 && (
        <select className="input" style={{ width: 260, height: 38 }} value={camId} onChange={(e) => setCamId(e.target.value)} aria-label="الكاميرا">
          {cams.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `كاميرا ${i + 1}`}</option>)}
        </select>
      )}
    </div>
  );

  let body;
  if (done?.enrolled) {
    body = (
      <div className="stack" style={{ alignItems: 'center', gap: 12, textAlign: 'center', padding: '10px 0' }}>
        {done.photo && <img src={done.photo} alt="" style={{ width: 160, borderRadius: 20 }} />}
        <span style={{ fontSize: 46 }}>✅</span>
        <h2 className="h2">اتسجّل وش {done.name.split(' ')[0]}</h2>
        <span className="muted">مستني موافقة المدير. لحد ما الحضور بالوش يشتغل، سجّل حضورك بالرقم السري زي ما انت.</span>
        {!done.sent && <span className="badge warn" style={{ whiteSpace: 'normal' }}>مفيش نت دلوقتي: محفوظ على الجهاز وهيتبعت لوحده لما النت يرجع.</span>}
        <button type="button" className="btn" onClick={reset}>تمام</button>
      </div>
    );
  } else if (enroll === 'consent') {
    body = (
      <div className="stack" style={{ alignItems: 'center', gap: 16, textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
        <h2 className="h2">قبل ما نسجّل وشّك</h2>
        <p style={{ fontSize: 18, lineHeight: 1.8, background: 'rgba(255,255,255,.8)', borderRadius: 18, padding: 16 }}>{CONSENT_TEXT}</p>
        <div className="chips" style={{ gap: 12, justifyContent: 'center' }}>
          <button type="button" className="btn" style={{ minWidth: 150, height: 56, fontSize: 20 }} onClick={() => setEnroll('capture')}>موافق</button>
          <button type="button" className="btn soft" style={{ minWidth: 120, height: 56 }} onClick={back}>مش موافق</button>
        </div>
      </div>
    );
  } else if (enroll === 'capture') {
    body = (
      <div className="chips" style={{ gap: 18, alignItems: 'flex-start', justifyContent: 'center' }}>
        {camBox}
        <EnrollCapture video={video} camOk={cam === 'ok'} onCancel={back} onDone={async (descs, photo) => {
          const sent = await saveFace({ person: who, shop: device, desc: flatten(descs), photo });
          setDone({ enrolled: true, sent, photo, name: who.name });
        }} />
      </div>
    );
  } else if (done) {
    body = (
      <div className="stack" style={{ alignItems: 'center', gap: 12, textAlign: 'center', padding: '10px 0' }}>
        {done.photo ? <img src={done.photo} alt="" style={{ width: 160, borderRadius: 20 }} /> : <Avatar name={done.name} color={who?.color} size={110} />}
        <span style={{ fontSize: 46 }}>✅</span>
        <h2 className="h2">اتسجّل {KIND_LABEL[done.kind]} {done.name.split(' ')[0]} الساعة <bdi>{t(done.atMs)}</bdi></h2>
        {!done.sent && <span className="badge warn" style={{ whiteSpace: 'normal' }}>مفيش نت دلوقتي: التسجيل محفوظ على الجهاز وهيتبعت لوحده لما النت يرجع، وهيتعلّم ⚠️ للمراجعة.</span>}
        {!done.photo && <span className="badge warn" style={{ whiteSpace: 'normal' }}>الكاميرا مش شغالة، فالتسجيل اتعمل من غير صورة ⚠️</span>}
        <button type="button" className="btn" onClick={reset}>تمام</button>
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
        <button type="button" className="btn soft sm" onClick={() => setKind('enroll')}>📸 سجّل وشّك (مرة واحدة)</button>
        <button type="button" className="link" onClick={back}>مش أنت؟ اختار اسم تاني</button>
      </div>
    );
  } else {
    body = (
      <div className="chips" style={{ gap: 18, alignItems: 'flex-start', justifyContent: 'center' }}>
        <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
          {camBox}
          <span className="tiny muted" style={{ maxWidth: 260, textAlign: 'center' }}>بص للكاميرا. بتسجيلك بتوافق إن الجهاز ياخد صورتك وقت الحضور والانصراف.</span>
        </div>
        <div className="stack wl-pin" style={{ gap: 10 }}>
          <h2 className="h2">{kind === 'enroll' ? 'تسجيل الوش' : KIND_LABEL[kind]} · {who.name.split(' ')[0]}</h2>
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

// تسجيل الوش: 5 لقطات بإرشادات بسيطة. كل لقطة لازم فيها وش واحد بس وواضح، وكلهم لازم يبقوا شبه بعض.
const STEPS = ['بص للكاميرا على طول', 'لِف وشّك سنة صغيرة يمين', 'لِف وشّك سنة صغيرة شمال', 'ارفع راسك سنة صغيرة', 'بص للكاميرا تاني على طول'];

function EnrollCapture({ video, camOk, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [note, setNote] = useState('بنجهّز التعرّف على الوش…');
  const [err, setErr] = useState('');
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!camOk) return undefined;
    let dead = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        await loadFace();
        const descs = [];
        let photo = null;
        for (let i = 0; i < STEPS.length && !dead; i++) {
          setStep(i); setNote(STEPS[i]);
          await sleep(1300);
          let got = null;
          for (let tries = 0; tries < 25 && !dead && !got; tries++) {
            const faces = await detectFaces(video.current);
            if (faces.length > 1) setNote('فيه أكتر من وش قدام الكاميرا. لازم تبقى لوحدك.');
            else if (!faces.length) setNote(`${STEPS[i]} · مش شايفين وشّك، قرّب من الكاميرا`);
            else if (faces[0].detection.score < 0.6) setNote(`${STEPS[i]} · النور ضعيف أو الوش مش واضح`);
            else got = faces[0];
            if (!got) await sleep(300);
          }
          if (dead) return;
          if (!got) { setErr('مقدرناش نشوف وشّك كويس. قرّب من الكاميرا وخلّي النور قدّامك، وجرّب تاني.'); return; }
          descs.push(got.descriptor);
          if (i === 0) photo = snapPhoto(video.current);
        }
        if (dead) return;
        // كل اللقطات لازم تبقى لنفس الشخص
        let worst = 0;
        for (let a = 0; a < descs.length; a++) for (let b = a + 1; b < descs.length; b++) worst = Math.max(worst, distance(descs[a], descs[b]));
        if (worst > 0.6) { setErr('اللقطات مش شبه بعض (يمكن حد دخل في الصورة). جرّب تاني وانت لوحدك قدام الكاميرا.'); return; }
        setNote('بنحفظ…');
        await onDone(descs, photo);
      } catch (e) {
        console.error(e);
        if (!dead) setErr(e?.code === 'offline-first' ? 'محتاج نت أول مرة. شغّل نت وجرّب تاني.' : 'حصلت مشكلة في التعرّف على الوش. جرّب تاني.');
      }
    })();
    return () => { dead = true; };
  }, [camOk, run]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack" style={{ gap: 12, alignItems: 'center', maxWidth: 320, textAlign: 'center' }}>
      <h2 className="h2">تسجيل الوش</h2>
      {!camOk ? <span className="badge warn" style={{ whiteSpace: 'normal' }}>لازم كاميرا علشان نسجّل الوش ⚠️</span> : err ? (
        <>
          <span className="badge bad" style={{ whiteSpace: 'normal' }}>{err}</span>
          <button type="button" className="btn" onClick={() => { setErr(''); setStep(0); setRun((x) => x + 1); }}>جرّب تاني</button>
        </>
      ) : (
        <>
          <strong style={{ fontSize: 22 }}>{note}</strong>
          <div className="chips" style={{ gap: 6 }} aria-label={`لقطة ${step + 1} من ${STEPS.length}`}>
            {STEPS.map((x, i) => <span key={x} style={{ width: 16, height: 16, borderRadius: 999, background: i < step ? 'var(--blue)' : i === step ? '#B6F000' : 'rgba(0,0,0,.15)' }} />)}
          </div>
        </>
      )}
      <button type="button" className="link" onClick={onCancel}>إلغاء</button>
    </div>
  );
}
