import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db } from './firebase';
import { todayKey } from './lib';

// تعديلات الحضور من الإدارة. كل تعديل بيتسجل في attLog (مين، إمتى، ليه، كان إيه وبقى إيه) ومحدش يقدر يمسحه.
// تعديل الأوقات وإلغاء التسجيلات = صاحب الشغل بس. قرارات الساعات الزيادة وتغيير الميعاد = صاحب الشغل أو المدير.

const me = (profile) => ({ by: auth.currentUser?.uid || profile.id, byName: profile.name || '' });
async function log(profile, shopId, action, text, extra = {}) {
  await addDoc(collection(db, 'attLog'), { shopId, action, text, ...extra, ...me(profile), at: serverTimestamp(), atLocalMs: Date.now() });
}

export async function fixRecord(profile, r, atMs, reason) {
  await updateDoc(doc(db, 'attendance', r.id), { fixAtMs: atMs, fixState: 'ok', fixReason: reason, fixBy: me(profile).by, fixByName: me(profile).byName, fixedAt: serverTimestamp() });
  await log(profile, r.shopId, 'fix', `عدّل ${r.kind === 'in' ? 'حضور' : 'انصراف'} ${r.name}`, { recId: r.id, uid: r.uid, day: r.day, fromMs: r.fixAtMs || r.at?.toMillis?.() || r.atLocalMs, toMs: atMs, reason });
}
export async function voidRecord(profile, r, reason) {
  await updateDoc(doc(db, 'attendance', r.id), { fixState: 'void', fixReason: reason, fixBy: me(profile).by, fixByName: me(profile).byName, fixedAt: serverTimestamp() });
  await log(profile, r.shopId, 'void', `لغى ${r.kind === 'in' ? 'حضور' : 'انصراف'} ${r.name}`, { recId: r.id, uid: r.uid, day: r.day, reason });
}
// مسح نهائي (صاحب الشغل بس): الصورة بس، أو التسجيل كله. مالوش رجوع، بس بيتسجل في السجل مين مسح وليه.
export async function deletePhoto(profile, r, reason) {
  await updateDoc(doc(db, 'attendance', r.id), { photo: deleteField() });
  await log(profile, r.shopId, 'del-photo', `مسح صورة ${r.kind === 'in' ? 'حضور' : 'انصراف'} ${r.name} نهائي`, { recId: r.id, uid: r.uid, day: r.day, reason });
}
export async function deleteRecord(profile, r, reason) {
  await deleteDoc(doc(db, 'attendance', r.id));
  await log(profile, r.shopId, 'del', `مسح ${r.kind === 'in' ? 'حضور' : 'انصراف'} ${r.name} نهائي`, { recId: r.id, uid: r.uid, day: r.day, fromMs: r.fixAtMs || r.at?.toMillis?.() || r.atLocalMs, reason });
}
// مسح بصمة وش حد: صاحب الشغل بس، وبعد ما يكتب الباسورد بتاعه تاني. الشخص هيسجّل وشّه من جديد، ولحد كده بيسجّل بالرقم السري.
export async function deleteFace(profile, r, password, reason) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  await deleteDoc(doc(db, 'faces', r.id));
  await log(profile, r.shopId, 'del-face', `مسح بصمة وش ${r.name}`, { uid: r.uid || r.id, reason });
}
// «جيت الساعة كام؟»: صاحب الشغل يوافق (الوقت يتعدّل للي قاله) أو يرفض (يفضل وقت التسجيل الحقيقي)
export async function decideClaim(profile, r, ok) {
  await updateDoc(doc(db, 'attendance', r.id), ok
    ? { fixAtMs: r.claimAtMs, fixState: 'ok', fixReason: 'وافق على الوقت اللي العامل قاله', fixBy: me(profile).by, fixByName: me(profile).byName, fixedAt: serverTimestamp() }
    : { fixState: 'rejected', fixReason: 'رفض الوقت اللي العامل قاله', fixBy: me(profile).by, fixByName: me(profile).byName, fixedAt: serverTimestamp() });
  await log(profile, r.shopId, ok ? 'claim-ok' : 'claim-no', `${ok ? 'وافق على' : 'رفض'} إن ${r.name} جه الساعة اللي قالها`, { recId: r.id, uid: r.uid, day: r.day, toMs: r.claimAtMs });
}
// نسي يسجّل خالص: صاحب الشغل يضيف التسجيل بإيده
export async function addManual(profile, { shopId, shopName, person, kind, day, atMs, reason }) {
  const ref = await addDoc(collection(db, 'attendance'), {
    uid: person.uid, name: person.name || '', shopId, shopName: shopName || '', kind, at: serverTimestamp(), atLocalMs: Date.now(), day,
    method: 'manual', photo: null, deviceId: '', fixAtMs: atMs, fixState: 'ok', fixReason: reason, fixBy: me(profile).by, fixByName: me(profile).byName, fixedAt: serverTimestamp(),
  });
  await log(profile, shopId, 'add', `ضاف ${kind === 'in' ? 'حضور' : 'انصراف'} لـ ${person.name} بإيده`, { recId: ref.id, uid: person.uid, day, toMs: atMs, reason });
}

const dayRef = (shopId, day) => doc(db, 'attDays', `${shopId}_${day}`);
// الساعات الزيادة: أوفر تايم / تبديل / رفض (أو رجوع لـ «مستني قرار»)
export async function setExtra(profile, { shopId, day, person, d, minutes }) {
  await setDoc(dayRef(shopId, day), { shopId, day, extra: { [person.uid]: d ? { d, minutes, ...me(profile), atMs: Date.now() } : deleteField() } }, { merge: true });
  await log(profile, shopId, 'extra', d ? `قرار الساعات الزيادة لـ ${person.name}: ${d}` : `رجّع قرار الساعات الزيادة لـ ${person.name}`, { uid: person.uid, day, d: d || null, minutes });
}
// تغيير ميعاد ليوم واحد (أو إجازة النهارده). null = يرجع لميعاده العادي.
export async function setOneDay(profile, { shopId, day, person, s, reason }) {
  await setDoc(dayRef(shopId, day), { shopId, day, sched: { [person.uid]: s || deleteField() } }, { merge: true });
  await log(profile, shopId, 'oneday', s ? `غيّر ميعاد ${person.name} ليوم ${day}: ${s.off ? 'إجازة' : `${s.start}–${s.end}`}` : `رجّع ميعاد ${person.name} العادي ليوم ${day}`, { uid: person.uid, day, reason: reason || '' });
}
// الميعاد العادي لكل شخص
export async function saveSched(profile, shopId, person, s) {
  await setDoc(doc(db, 'attSched', shopId), { shopId, people: { [person.uid]: s } }, { merge: true });
  if (profile) await log(profile, shopId, 'sched', `غيّر ميعاد ${person.name} العادي: ${s.start || '—'}–${s.end || '—'}`, { uid: person.uid, day: todayKey() });
}
