// التعرّف على الوش في المتصفح نفسه (مكتبة مجانية @vladmandic/face-api). مفيش صور بتتبعت لأي حد.
// الموديلات (~7 ميجا) بتتحمّل مرة واحدة من ./face-models وبتتحفظ على الجهاز.
// «بصمة الوش» = 128 رقم بيوصفوا الوش. وشين لنفس الشخص المسافة بينهم صغيرة (أقل من ~0.5).

let fapi = null;
let loading = null;

export function loadFace() {
  if (fapi) return Promise.resolve(fapi);
  if (!loading) {
    loading = (async () => {
      const f = await import('@vladmandic/face-api');
      await f.tf.ready();
      // تليفون الحضور بيفتح من att/ فالموديلات فوقه بفولدر
      const url = location.pathname.includes('/att/') ? '../face-models' : './face-models';
      await Promise.all([
        f.nets.tinyFaceDetector.loadFromUri(url),
        f.nets.faceLandmark68Net.loadFromUri(url),
        f.nets.faceRecognitionNet.loadFromUri(url),
        f.nets.faceExpressionNet.loadFromUri(url),
      ]);
      fapi = f;
      return f;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// كل الوشوش اللي في الصورة دلوقتي، بالبصمة والملامح والتعبير.
export async function detectFaces(video) {
  const f = await loadFace();
  if (!video || !video.videoWidth) return [];
  return f.detectAllFaces(video, new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
}

// أخف وأسرع (ملامح بس من غير بصمة): للحركات اللي بتحصل بسرعة زي التغميض، علشان الموبايل ميفوّتهاش بين صورة والتانية.
// والعين المقفولة بتقلل ثقة الكاشف في الوش، فبنقبل ثقة أقل هنا.
export async function detectLite(video) {
  const f = await loadFace();
  if (!video || !video.videoWidth) return [];
  return f.detectAllFaces(video, new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })).withFaceLandmarks();
}

export const distance = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
};

// البصمات بتتحفظ في Firestore كـ array واحدة مسطّحة (Firestore مبيقبلش array جوه array).
export const DESC_LEN = 128;
export const flatten = (descs) => descs.flatMap((d) => Array.from(d, (x) => Math.round(x * 1e4) / 1e4));
export const unflatten = (flat) => {
  const out = [];
  for (let i = 0; i + DESC_LEN <= (flat || []).length; i += DESC_LEN) out.push(flat.slice(i, i + DESC_LEN));
  return out;
};

// اتجاه الوش تقريبي من الملامح: سالب = لافف ناحية، موجب = الناحية التانية (للخطوة الجاية: «لِف يمين/شمال»).
export function yawOf(landmarks) {
  const p = landmarks.positions;
  const nose = p[30], l = p[0], r = p[16];
  const w = r.x - l.x || 1;
  return ((nose.x - l.x) / w - 0.5) * 2;
}

// فتحة العين (EAR): العين المفتوحة حوالي 0.3، والمقفولة أقل من 0.2.
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ear = (p, i) => (d2(p[i + 1], p[i + 5]) + d2(p[i + 2], p[i + 4])) / (2 * d2(p[i], p[i + 3]) || 1);
export function eyesOf(landmarks) { const p = landmarks.positions; return (ear(p, 36) + ear(p, 42)) / 2; }

// الحركات العشوائية ضد الغش بصورة أو فيديو. كل حركة ليها: الكلام اللي بيظهر، وإزاي نعرف إنها اتعملت.
// base = قيم الوش وهو باصص عادي (العين واللفّة) علشان نقارن بيها.
// اللفّة: yawOf سالب لما الشخص يلف ناحية يمينه (الصورة مش معكوسة: يمينه = شمال الصورة).
export const ACTIONS = {
  // التغميض: بنقارن بفتحة عينه هو وهو باصص عادي (العين بتقفل لو قلّت ربع أو أكتر)، مش برقم ثابت
  blink: { say: 'غمّض عينيك ثانيتين', lite: true, ok: (f, b) => eyesOf(f.landmarks) < Math.max(0.2, b.eyes * 0.75) },
  right: { say: 'لِف وشّك ناحية اليمين', ok: (f, b) => yawOf(f.landmarks) < b.yaw - 0.3 },
  left: { say: 'لِف وشّك ناحية الشمال', ok: (f, b) => yawOf(f.landmarks) > b.yaw + 0.3 },
  smile: { say: 'ابتسم', ok: (f) => (f.expressions?.happy || 0) > 0.7 },
};
// حركتين مختلفتين عشوائي (مش يمين وشمال مع بعض)
// حركة بديلة لو الأولى منفعتش (مش من اللي اتطلبت قبل كده)
export function spareAction(used) {
  const keys = Object.keys(ACTIONS).filter((k) => !used.includes(k) && k !== 'blink');
  return keys[Math.floor(Math.random() * keys.length)] || 'smile';
}
export function pickActions() {
  const keys = Object.keys(ACTIONS);
  const a = keys[Math.floor(Math.random() * keys.length)];
  const rest = keys.filter((k) => k !== a && !(['right', 'left'].includes(a) && ['right', 'left'].includes(k)));
  return [a, rest[Math.floor(Math.random() * rest.length)]];
}
export const MATCH = 0.5; // أقل من كده = نفس الشخص
export const bestDist = (desc, refs) => Math.min(...refs.map((r) => distance(desc, r)));

// التعليمات بالصوت (صوت الموبايل نفسه بالعربي) علشان العامل ينفّذ على طول من غير ما يقرا الشاشة
let voice = null;
export function speak(text) {
  try {
    const ss = window.speechSynthesis;
    if (!ss) return;
    if (!voice) { const vs = ss.getVoices(); voice = vs.find((v) => v.lang === 'ar-EG') || vs.find((v) => /^ar/i.test(v.lang)) || null; }
    ss.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[✓…]/g, ''));
    u.lang = voice?.lang || 'ar-EG';
    if (voice) u.voice = voice;
    u.rate = 1.05;
    ss.speak(u);
  } catch { /* مفيش صوت: الكلام على الشاشة كفاية */ }
}
try { window.speechSynthesis?.getVoices(); window.speechSynthesis?.addEventListener?.('voiceschanged', () => { voice = null; }); } catch { /* ignore */ }
