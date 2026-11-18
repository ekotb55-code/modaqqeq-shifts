// ===== عداد طلبات النت لسيرفر الورديات (حساب pos-assist@modaqqeq.com) - ملف لوحده =====
// - بيعدّ كل طلب نت (UrlFetch) والخدمة اللي طلبته: الإشعارات / نقل الصور / رسايل البنك / عرض الصور / حاجات تانية
// - الحد اليومي بتاع جوجل للحساب كله (100 ألف) مشترك مع سيرفرات تانية على نفس الحساب (الصور، تسوية الخزنة)
// - داش بورد الدعم: ?a=usage (العداد) • ?a=usageSet&data={token,key,off,by} (قفل/فتح - المدير بس)
// - مفتاح القفل لـ «نقل الصور» بس - الإشعارات ورسايل البنك مابتتقفلش
// ⚠️ خلّي الملف ده تحت Code.gs في المحرر.

const SU_SW = ['photos'];
const SU_DIR_API_DEF = 'https://script.google.com/macros/s/AKfycbxUjxuVtROKO7MrxHtmBfzOxsjgwgfvWMVodCHxUdxuFszmgTyWMQFavjt82iJ8U0s/exec';
const SU_CAT = {
  sendNotifications_: 'push', tokensOf_: 'push', runUsers_: 'push', staffOf_: 'push', testPush: 'push',
  movePhotos_: 'photos', cleanup: 'photos',
  sms_: 'sms', smsOne_: 'sms', mateOf_: 'sms', patchGroup_: 'sms', personalFromNote_: 'sms',
  getImg_: 'img'
};
let __suN = 0, __suBy = {}, __suIn = false;

function suDay_() { return Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'); }
// مين اللي طلب: أول دالة معروفة في السلسلة
function suCat_() {
  const st = String(new Error().stack || '');
  const re = /at (?:[\w$.]*\.)?([\w$]+) \(/g;
  let m;
  while ((m = re.exec(st))) { if (SU_CAT[m[1]]) return SU_CAT[m[1]]; }
  return 'other';
}
function suHit_(n) { const c = suCat_(); __suN += n; __suBy[c] = (__suBy[c] || 0) + n; }
function suFlush_() {
  if (!__suN) return;
  const lock = LockService.getScriptLock();
  let got = false;
  try {
    got = lock.tryLock(3000);
    if (!got) return;
    const pr = PropertiesService.getScriptProperties(), d = suDay_();
    let by = {}, hrs = {};
    try { by = JSON.parse(pr.getProperty('SU_C_' + d) || '{}') || {}; } catch (e) {}
    try { hrs = JSON.parse(pr.getProperty('SU_H') || '{}') || {}; } catch (e) {}
    Object.keys(__suBy).forEach(c => { by[c] = (by[c] || 0) + __suBy[c]; });
    const h = Math.floor(Date.now() / 3600000);
    hrs[h] = (hrs[h] || 0) + __suN;
    Object.keys(hrs).forEach(x => { if (Number(x) < h - 26) delete hrs[x]; });
    pr.setProperty('SU_N_' + d, String((Number(pr.getProperty('SU_N_' + d)) || 0) + __suN));
    pr.setProperty('SU_C_' + d, JSON.stringify(by));
    pr.setProperty('SU_H', JSON.stringify(hrs));
    __suN = 0; __suBy = {};
  } catch (e) {
  } finally { if (got) try { lock.releaseLock(); } catch (e) {} }
}
function suOff_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SU_OFF') || '{}') || {}; } catch (e) { return {}; } }
function suUsage_() {
  suFlush_();
  const pr = PropertiesService.getScriptProperties(), d = suDay_();
  let by = {}, hrs = {};
  try { by = JSON.parse(pr.getProperty('SU_C_' + d) || '{}') || {}; } catch (e) {}
  try { hrs = JSON.parse(pr.getProperty('SU_H') || '{}') || {}; } catch (e) {}
  const h = Math.floor(Date.now() / 3600000), hours = [];
  for (let i = 23; i >= 0; i--) hours.push(hrs[h - i] || 0);
  let runs = ''; try { runs = Session.getEffectiveUser().getEmail(); } catch (e) {}
  return { ok: true, used: Number(pr.getProperty('SU_N_' + d)) || 0, by: by, hours: hours, sw: SU_SW, off: suOff_(), runs: runs, since: pr.getProperty('SU_SINCE') || '', at: new Date().toISOString() };
}
// قفل/فتح - المدير بس: بنسأل «دليل الموظفين» عن التوكن بتاع الداش بورد
function suUsageSet_(d) {
  const key = String(d.key || '');
  if (SU_SW.indexOf(key) === -1) throw new Error('الخدمة دي مالهاش مفتاح');
  if (!String(d.token || '')) throw new Error('انتهت الجلسة - ادخل تاني');
  const api = PropertiesService.getScriptProperties().getProperty('SU_DIR_API') || SU_DIR_API_DEF;
  let j = null;
  try { j = JSON.parse(UrlFetchApp.fetch(api + '?action=dUsage&data=' + encodeURIComponent(JSON.stringify({ token: d.token })), { muteHttpExceptions: true }).getContentText('UTF-8')); }
  catch (e) { throw new Error('مقدرتش أتأكد من حسابك - جرّب تاني'); }
  if (!j || !j.ok) throw new Error((j && j.error) || 'مقدرتش أتأكد من حسابك - جرّب تاني');
  if (!j.boss) throw new Error('الإيقاف والتشغيل للمدير بس');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const o = suOff_();
    if (d.off === true) o[key] = { at: new Date().toISOString(), by: String(d.by || '').slice(0, 60) }; else delete o[key];
    PropertiesService.getScriptProperties().setProperty('SU_OFF', JSON.stringify(o));
  } finally { lock.releaseLock(); }
  return suUsage_();
}
function suJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

(function () {
  try {
    const pr = PropertiesService.getScriptProperties();
    if (!pr.getProperty('SU_SINCE')) pr.setProperty('SU_SINCE', new Date().toISOString());
  } catch (e) {}
  // العدّ
  try {
    const f = UrlFetchApp.fetch, fa = UrlFetchApp.fetchAll;
    if (!f.__su) {
      const w = function (url, opt) { suHit_(1); return opt === undefined ? f.call(UrlFetchApp, url) : f.call(UrlFetchApp, url, opt); };
      w.__su = true; UrlFetchApp.fetch = w;
      const wa = function (reqs) { suHit_((reqs && reqs.length) || 1); return fa.call(UrlFetchApp, reqs); };
      wa.__su = true; UrlFetchApp.fetchAll = wa;
    }
  } catch (e) {}
  // آخر كل طلب أو تشغيلة: نكتب اللي اتعدّ
  const wrap = n => {
    try {
      const o = globalThis[n];
      if (typeof o !== 'function' || o.__su) return;
      const w = function () { try { return o.apply(this, arguments); } finally { suFlush_(); } };
      w.__su = true; globalThis[n] = w;
    } catch (e) {}
  };
  ['tick', 'cleanup'].forEach(wrap);
  // نقل الصور موقوف من الداش بورد؟
  try {
    const oMove = movePhotos_;
    movePhotos_ = function () { if (suOff_().photos) return; return oMove.apply(this, arguments); };
  } catch (e) {}
  // طلبات العداد من الداش بورد (?a=usage / ?a=usageSet)
  try {
    const oGet = doGet;
    doGet = function (e) {
      const p = (e && e.parameter) || {};
      try {
        if (p.a === 'usage') return suJson_(suUsage_());
        if (p.a === 'usageSet') { try { return suJson_(suUsageSet_(JSON.parse(p.data || '{}'))); } catch (err) { return suJson_({ ok: false, error: String(err.message || err) }); } }
        return oGet.apply(this, arguments);
      } finally { suFlush_(); }
    };
    const oPost = doPost;
    doPost = function () { try { return oPost.apply(this, arguments); } finally { suFlush_(); } };
  } catch (e) {}
})();

// اختبار من المحرر (مابيعملش طلبات نت)
function suSelfTest() {
  Logger.log(JSON.stringify({ wrapped: !!UrlFetchApp.fetch.__su, tick: !!(globalThis.tick && globalThis.tick.__su), usage: suUsage_() }));
}
