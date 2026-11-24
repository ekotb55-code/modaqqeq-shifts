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
      const url = './face-models';
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
