import { getAuth } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { dbOf, sessionApp } from './firebase';
import { todayKey } from './lib';
import { markPending, verifyCashierPin } from './sessions.js';

// الحضور والانصراف: كل تسجيل سطر في attendance/{id} باسم الشخص نفسه (uid)، مش باسم الكاشير اللي فاتح الجهاز.
// الحساب واحد لكل شخص: نفس الحضور سواء اشتغل النهارده كاشير أو عامل.
// الوقت الحقيقي = at (وقت السيرفر). atLocalMs = ساعة الجهاز، ولو بعيدة عن وقت السيرفر يبقى التسجيل
// اتعمل من غير نت أو ساعة الجهاز غلط ← علامة ⚠️ للمراجعة.

export const KIND_LABEL = { in: 'حضور', out: 'انصراف' };
export const LATE_SYNC_MIN = 3; // فرق أكتر من كده بين ساعة الجهاز والسيرفر = ⚠️

const LAST = 'mdq-att-last';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { return {}; } };
// آخر تسجيل للشخص النهارده على الجهاز ده، علشان نقترح «حضور» ولا «انصراف».
export function lastPunch(uid) { const x = readLast()[uid]; return x && x.day === todayKey() ? x : null; }
function saveLast(uid, kind) {
  const all = readLast();
  all[uid] = { day: todayKey(), kind, atMs: Date.now() };
  Object.keys(all).forEach((k) => { if (all[k].day !== todayKey()) delete all[k]; });
  try { localStorage.setItem(LAST, JSON.stringify(all)); } catch { /* ignore */ }
}

// الصورة: صغيرة (عرض 240) علشان تتخزن جوه السطر نفسه (الخطة المجانية مفيهاش تخزين صور).
export function snapPhoto(video, width = 240, quality = 0.6) {
  if (!video || !video.videoWidth) return null;
  const h = Math.round((video.videoHeight / video.videoWidth) * width);
  const c = document.createElement('canvas');
  c.width = width; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(video, 0, 0, width, h);
  return c.toDataURL('image/jpeg', quality);
}

// جلسة الشخص على الجهاز ده (اتعملت أول مرة دخل برقمه السري هنا). من غيرها مينفعش نسجّل باسمه.
async function sessionOf(person) {
  const a = sessionApp(person.uid);
  const au = getAuth(a);
  if (au.authStateReady) await au.authStateReady();
  return au.currentUser?.uid === person.uid ? a : null;
}
export async function hasSession(person) { try { return !!(await sessionOf(person)); } catch { return false; } }

// بصمة وش الشخص (من جلسته هو). null = مش متسجل.
export async function myFace(person) {
  const a = await sessionOf(person);
  if (!a) return null;
  const s = await getDoc(doc(dbOf(a), 'faces', person.uid));
  return s.exists() ? s.data() : null;
}

// أسباب التسجيل بالرقم السري بدل الوش (بتظهر ⚠️ للمدير)
export const FALLBACK = {
  'no-camera': 'الكاميرا مش شغالة',
  'no-face': 'وشّه لسه مش متسجل',
  'not-approved': 'تسجيل وشّه لسه مستني موافقة',
  'no-session': 'أول مرة على الجهاز ده',
  'face-failed': 'الجهاز متعرّفش على وشّه',
  'chose-pin': 'اختار الرقم السري',
};

async function write(person, rec) {
  const a = await sessionOf(person);
  if (!a) { const e = new Error('no session'); e.code = 'offline-first'; throw e; }
  const p = addDoc(collection(dbOf(a), 'attendance'), rec);
  // ثانيتين ونص بس: لو السيرفر رد يبقى تمام، ولو لأ يبقى مستني النت (محفوظ على الجهاز ويتبعت بعدين).
  const res = await Promise.race([p.then(() => 'ok', (e) => e), new Promise((r) => setTimeout(() => r('wait'), 2500))]);
  if (res !== 'ok' && res !== 'wait') { const e = new Error('save'); e.code = res?.code || 'save-failed'; throw e; }
  if (res === 'wait') markPending(person.uid);
  saveLast(person.uid, rec.kind);
  return { sent: res === 'ok', atMs: rec.atLocalMs };
}
const base = (person, kind, shop, photo, deviceId) => ({
  uid: person.uid, name: person.name || '', shopId: shop.shopId, shopName: shop.name || '',
  kind, at: serverTimestamp(), atLocalMs: Date.now(), day: todayKey(), photo: photo || null, deviceId: deviceId || '',
});

// بالرقم السري (احتياطي): يتأكد من الرقم من غير ما يغيّر مين فاتح التطبيق، ويسجّل السبب.
export async function punch({ person, pin, kind, shop, photo, deviceId, fallback }) {
  await verifyCashierPin(person, pin);
  return write(person, { ...base(person, kind, shop, photo, deviceId), method: 'pin', fallback: fallback || 'chose-pin' });
}

// بالوش: الجهاز اتعرّف عليه وعمل الحركتين.
export async function punchFace({ person, kind, shop, photo, deviceId, faceDist, live }) {
  return write(person, { ...base(person, kind, shop, photo, deviceId), method: 'face', faceDist: Math.round(faceDist * 1000) / 1000, live });
}

// ───── تسجيل الوش (خطوة 2) ─────
// faces/{uid}: بصمة وش الشخص (أرقام مش صورة) + صورة صغيرة واحدة للمدير يراجع بيها + موافقته على التصوير.
// الشخص بيسجّل لنفسه بس برقمه السري. بيبقى «مستني موافقة» لحد ما صاحب المحل أو المدير يوافق من تاب «الحضور».
export const CONSENT_V = 1;
export const CONSENT_TEXT = 'أنا موافق إن جهاز الفرع يصوّرني وقت الحضور والانصراف وأثناء التفقّد في الشيفت، ويحفظ «بصمة وشّي» (أرقام مش صورة) علشان يتعرّف عليّا، وإن موقعي يتشاف أثناء الجرد من الموبايل. البيانات دي بيشوفها صاحب الشغل والإدارة بس، وأقدر أطلب مسحها في أي وقت.';

export async function saveFace({ person, shop, desc, photo }) {
  const a = sessionApp(person.uid);
  const au = getAuth(a);
  if (au.authStateReady) await au.authStateReady();
  if (au.currentUser?.uid !== person.uid) { const e = new Error('no session'); e.code = 'offline-first'; throw e; }
  const p = setDoc(doc(dbOf(a), 'faces', person.uid), {
    uid: person.uid, name: person.name || '', shopId: shop.shopId, desc, n: desc.length / 128, photo: photo || null,
    consentV: CONSENT_V, consentAt: serverTimestamp(), at: serverTimestamp(), deviceId: devIdOf(), approved: false,
  });
  const res = await Promise.race([p.then(() => 'ok', (e) => e), new Promise((r) => setTimeout(() => r('wait'), 4000))]);
  if (res !== 'ok' && res !== 'wait') { const e = new Error('save'); e.code = res?.code || 'save-failed'; throw e; }
  if (res === 'wait') markPending(person.uid);
  return res === 'ok';
}
const devIdOf = () => { try { return localStorage.getItem('mdq-dev') || ''; } catch { return ''; } };
