import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, deleteField } from 'firebase/firestore';
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
// الورديات بأسامي لكل فرع (صباحي، مسائي…) علشان جدول المواعيد يختار منها بضغطة
export async function saveShifts(profile, shopId, list) {
  await setDoc(doc(db, 'attSched', shopId), { shopId, shifts: list.map((x) => ({ id: String(x.id), name: x.name, start: x.start, end: x.end })) }, { merge: true });
  await log(profile, shopId, 'shifts', `عدّل الورديات: ${list.map((x) => `${x.name} ${x.start}–${x.end}`).join('، ') || 'مفيش'}`, { day: todayKey() });
}
export async function logPlan(profile, shopId, text, day) {
  await log(profile, shopId, 'plan', text, { day });
}

// الجوكر (صاحب المحل بس): شخص واحد بحساب واحد شغال في كذا فرع من فروعه.
// home = فرعه الأصلي (بيفضل أول فرع في حسابه). shops = {shopId: الساعات المطلوبة منه هناك في اليوم}.
// في كل فرع: بيتحط في قايمة العمال (علشان يظهر على جهاز الحضور هناك) + ميعاده «جوكر» + مرتبه (اليومية وساعات اليوم).
// الفروع اللي اتشالت: بيتشال منها (وتسجيلاته القديمة هناك بتفضل زي ما هي).
export async function saveJoker(profile, { person, home, shops, removed, names, daily, dayHours }) {
  const ids = Object.keys(shops);
  const pay = { type: 'joker', amount: Number(daily) || 0, dayHours: Number(dayHours) || 0 };
  const others = ids.filter((id) => id !== home);
  if (others.length) await updateDoc(doc(db, 'users', person.uid), { shopIds: arrayUnion(...others) });
  if (removed.length) await updateDoc(doc(db, 'users', person.uid), { shopIds: arrayRemove(...removed.filter((id) => id !== home)) });
  const entry = { uid: person.uid, name: person.name || '', username: person.username || '', color: person.color || null, joker: home };
  for (const id of others) {
    const pub = (await getDoc(doc(db, 'shopsPublic', id))).data() || {};
    const list = pub.workers || [];
    if (!list.some((w) => w.uid === person.uid) && !(pub.cashiers || []).some((c) => c.uid === person.uid)) await setDoc(doc(db, 'shopsPublic', id), { workers: [...list, entry] }, { merge: true });
  }
  for (const id of removed.filter((x) => x !== home)) {
    const pub = (await getDoc(doc(db, 'shopsPublic', id))).data() || {};
    const list = pub.workers || [];
    if (list.some((w) => w.uid === person.uid && w.joker)) await setDoc(doc(db, 'shopsPublic', id), { workers: list.filter((w) => !(w.uid === person.uid && w.joker)) }, { merge: true });
    await setDoc(doc(db, 'attSched', id), { shopId: id, people: { [person.uid]: deleteField() } }, { merge: true });
    await log(profile, id, 'joker', `شال ${person.name} (جوكر) من الفرع ده`, { uid: person.uid, day: todayKey() });
  }
  for (const id of ids) {
    await setDoc(doc(db, 'attSched', id), { shopId: id, people: { [person.uid]: { joker: true, hours: Number(shops[id]) || 0, shops, home, start: '', end: '', dayOff: null } } }, { merge: true });
    await setDoc(doc(db, 'staffPay', id), { shopId: id, people: { [person.uid]: pay } }, { merge: true });
    await log(profile, id, 'joker', `خلّى ${person.name} جوكر: ${ids.map((x) => `${names[x] || x} ${Number(shops[x]) ? `${shops[x]} س` : 'من غير ساعات مطلوبة'}`).join('، ')} · اليومية ${pay.amount} ج لـ ${pay.dayHours} ساعات`, { uid: person.uid, day: todayKey() });
  }
}
