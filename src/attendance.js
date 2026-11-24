import { getAuth } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
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
  g.translate(width, 0); g.scale(-1, 1); // زي المراية، زي ما الشخص شايف نفسه
  g.drawImage(video, 0, 0, width, h);
  return c.toDataURL('image/jpeg', quality);
}

// يتأكد من الرقم السري (من غير ما يغيّر مين فاتح التطبيق) وبعدين يسجّل باسم الشخص.
// مش بيستنى السيرفر: لو مفيش نت بيتسجل على الجهاز ويتبعت لما النت يرجع.
export async function punch({ person, pin, kind, shop, photo, deviceId }) {
  await verifyCashierPin(person, pin);
  const a = sessionApp(person.uid);
  const au = getAuth(a);
  if (au.authStateReady) await au.authStateReady();
  const u = au.currentUser;
  if (!u || u.uid !== person.uid) { const e = new Error('no session'); e.code = 'offline-first'; throw e; }
  const rec = {
    uid: person.uid, name: person.name || '', shopId: shop.shopId, shopName: shop.name || '',
    kind, at: serverTimestamp(), atLocalMs: Date.now(), day: todayKey(), method: 'pin',
    photo: photo || null, deviceId: deviceId || '',
  };
  const p = addDoc(collection(dbOf(a), 'attendance'), rec);
  // ثانيتين ونص بس: لو السيرفر رد يبقى تمام، ولو لأ يبقى مستني النت (محفوظ على الجهاز ويتبعت بعدين).
  const res = await Promise.race([p.then(() => 'ok', (e) => e), new Promise((r) => setTimeout(() => r('wait'), 2500))]);
  if (res !== 'ok' && res !== 'wait') { const e = new Error('save'); e.code = res?.code || 'save-failed'; throw e; }
  if (res === 'wait') markPending(person.uid);
  const sent = res === 'ok';
  saveLast(person.uid, kind);
  return { sent, atMs: rec.atLocalMs };
}
