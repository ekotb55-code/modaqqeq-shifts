// جرد الوردية: قبل تقفيل الوردية الكاشير اللي بيسلّم واللي بيستلم بيعدّوا الأصناف الثابتة مع بعض.
// الجرد نفسه هو «الجرد العشوائي» بتاع التطبيق المجمع (نفس الشيت ونفس تاب «أصناف الجرد الثابتة»)،
// بس بنوع «وردية»: الأصناف الثابتة بس، والفروقات بتظهر للكاشير على طول.
// السحب من برنامج البيع بيبقى ملف واحد فيه كل الأصناف (طلب واحد)، والسكريبت بياخد منه الثابت بس.

// سكريبت الجرد المركزي (دليل الموظفين) وسكريبت «تجربة الربط»
const JARD_URL = 'https://script.google.com/macros/s/AKfycbxUjxuVtROKO7MrxHtmBfzOxsjgwgfvWMVodCHxUdxuFszmgTyWMQFavjt82iJ8U0s/exec';
const JARD_TEST_URL = 'https://script.google.com/macros/s/AKfycbyZM7c-AcAPJPpbfYnPnnvlC7cuL91zmufhQ1URKiJkbgq3ep7okWzwwosPPIbEPjnP/exec';
// نفس مفتاح تطبيق الجرد (موجود أصلاً في التطبيق المجمع المنشور)
const JARD_KEY = 'b4d1771abd401101';

export const SHIFT_JARD_DEF = { on: false, store: '', test: false };
export const shiftJardOf = (shop) => ({ ...SHIFT_JARD_DEF, ...(shop?.shiftJard || {}) });
export const shiftJardOn = (shop) => { const c = shiftJardOf(shop); return !!(c.on && String(c.store || '').trim()); };

const NET_MSG = 'مفيش نت أو السيرفر مش بيرد · اتأكد من النت وجرّب تاني';

async function call(cfg, action, data = {}, timeoutMs = 120000) {
  const base = cfg.test ? JARD_TEST_URL : JARD_URL;
  const q = new URLSearchParams({ jstore: String(cfg.store || '').trim(), key: JARD_KEY, action, data: JSON.stringify(data) });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}?${q.toString()}`, { signal: ctl.signal, redirect: 'follow' });
  } catch {
    throw new Error(NET_MSG);
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error(NET_MSG);
  let j;
  try { j = await res.json(); } catch { throw new Error('رد غريب من سكريبت الجرد · كلّم الدعم'); }
  if (!j || j.ok !== true) throw new Error(j?.error || 'حصلت مشكلة في الجرد · جرّب تاني');
  return j;
}

// بيبدأ جرد الوردية (أو يكمّل نفس الجرد لو كان اتبدأ للوردية دي) - بيسحب الكميات من البرنامج لحظتها
export const jardStart = (cfg, { shiftId, user }) => call(cfg, 'rndStart', { kind: 'وردية', shift: shiftId, user });
// counts = { م: الكمية }
export const jardFinish = (cfg, { id, counts, user }) => call(cfg, 'rndFinish', { id, counts, user, countedAt: new Date().toISOString() });
// آخر العد: بيسحب الكميات تاني وبيرجّع الأصناف اللي اتباع منها أثناء الجرد (تتعد تاني)
export const jardRecheck = (cfg, id) => call(cfg, 'rndRecheck', { id });
export const jardReport = (cfg, id) => call(cfg, 'rndReport', { id });
// للإعدادات: الأصناف الثابتة اللي في شيت الفرع
// check: بيتأكد كمان إن كل صنف موجود في برنامج البيع (بالاسم أو الباركود)
export const jardFixed = (cfg) => call(cfg, 'rndCfg', { check: true }, 120000);
