/**
 * مدقق · الورديات — السكريبت المجاني (Google Apps Script)
 *
 * بيعمل حاجتين:
 *  ١. الإشعارات: كل دقيقة بيشوف الإشعارات اللي التطبيق ساب طلبها في "outbox"
 *     ويبعتها للموبايلات والكمبيوترات اللي فعّلت الإشعارات (Firebase Cloud Messaging).
 *  ٢. الصور: بينقل صور الورديات من Firebase لـ Google Drive (15 جيجا مجانًا)،
 *     وبيمسح الصور اللي عدّى عليها أكتر من شهرين.
 *
 * التشغيل لأول مرة: اختار الدالة setup من فوق ودوس Run.
 * لازم الحساب اللي بيشغّل السكريبت يكون صاحب مشروع Firebase (pos-assist@modaqqeq.com، Editor على مشروع Firebase وفولدر الصور).
 */

const PROJECT = 'modaqqeq-shifts';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const KEEP_DAYS = 60; // الصور بتتمسح بعد كده
// مين يوصله إيه — كل واحد يقدر يغيّر اختياره من الجرس جوّه التطبيق (نفس الجدول في src/notifyPrefs.js)
const PREF_OF = { handover: 'handover', reopen_done: 'handover', dispute: 'request', ack: 'request', msg: 'msg', close_report: 'close', sms_claim: 'wallet', sms_big: 'wallet', sms_refused: 'wallet', sms_owner: 'wallet' };
const DEFAULTS = {
  accountant: { handover: true, request: true, msg: true, close: false },
  reviewer: { handover: true, request: true, msg: true, close: false },
  owner: { close: true, wallet: true },
  manager: { close: true, wallet: true },
  admin: {},
  support: {},
};
function wants_(u, key) {
  const p = u.notifyPrefs || {};
  if (key in p) return !!p[key];
  return !!(DEFAULTS[u.role] || {})[key];
}

// ───────── التجهيز (مرة واحدة) ─────────
function setup() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('FOLDER');
  if (!folderId) {
    folderId = DriveApp.createFolder('صور مدقق - الورديات').getId();
    props.setProperty('FOLDER', folderId);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(4).create();

  // نتأكد إن السكريبت قادر يقرا قاعدة البيانات ويبعت إشعارات
  const r1 = req_('get', FS + '/users?pageSize=1');
  if (r1.code !== 200) throw new Error('مش قادر يقرا Firebase (' + r1.code + '): ' + r1.text.slice(0, 300));
  const r2 = req_('post', 'https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send',
    { validate_only: true, message: { token: 'test-token', data: { t: '1' } } });
  if (r2.code === 403) throw new Error('خدمة الإشعارات مقفولة في المشروع: ' + r2.text.slice(0, 300));
  Logger.log('✅ تمام! كل حاجة شغالة. فولدر الصور: https://drive.google.com/drive/folders/' + folderId);
}

// ───────── كل دقيقة ─────────
function tick() {
  const now = new Date();
  const h = Number(Utilities.formatDate(now, 'Africa/Cairo', 'H'));
  // بالليل (من 3 لـ 7 الصبح) كل 5 دقايق بس علشان نوفّر من الحد اليومي
  if (h >= 3 && h < 7 && now.getMinutes() % 5 !== 0) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    sendNotifications_();
    movePhotos_(now.getTime() + 25000);
  } finally { lock.releaseLock(); }
}

// ───────── الإشعارات ─────────
function sendNotifications_() {
  const list = req_('get', FS + '/outbox?pageSize=40');
  const docs = (list.json && list.json.documents) || [];
  if (!docs.length) return;
  console.log('outbox: ' + docs.length);
  const staffCache = {};
  adminsCache_ = null;
  const messages = [];
  const owners = []; // token doc name for each message (to delete dead ones)
  docs.forEach(function (d) {
    const ev = fields_(d);
    let uids = [];
    if (ev.to === 'cashier' && ev.toUid) uids = [ev.toUid];
    else if (ev.to === 'shopCashiers' && ev.shopId) uids = runUsers_({ fieldFilter: { field: { fieldPath: 'shopIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: ev.shopId } } })
      .filter(function (u) { return u.role === 'cashier' && !u.disabled; }).map(function (u) { return u.id; });
    else if (ev.to === 'staff' && ev.shopId) {
      if (!staffCache[ev.shopId]) staffCache[ev.shopId] = staffOf_(ev.shopId);
      const key = PREF_OF[ev.type] || 'handover';
      uids = staffCache[ev.shopId].filter(function (u) { return wants_(u, key); }).map(function (u) { return u.id; });
    }
    uids = uids.filter(function (u) { return u && u !== ev.byUid; });
    console.log('event ' + ev.type + ' → ' + ev.to + ' · ' + uids.length + ' people');
    const go = ev.type === 'close' ? 'view' : ev.type === 'reopen' || (ev.type === 'msg' && ev.to === 'cashier') ? 'attn' : '';
    tokensOf_(uids).forEach(function (t) {
      messages.push({
        message: {
          token: t.token,
          data: { title: String(ev.title || 'مدقق'), body: String(ev.body || ''), tag: (ev.shiftId || '') + ':' + (ev.type || '') + ':' + (ev.atMs || ''), shiftId: String(ev.shiftId || ''), shopId: String(ev.shopId || ''), type: String(ev.type || ''), go: go || String(ev.go || ''), actUrl: String(ev.actUrl || ''), alarm: ['handover', 'reopen_done', 'dispute'].indexOf(ev.type) >= 0 ? '1' : '0' },
          webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        },
      });
      owners.push(t.name);
    });
  });
  console.log('devices: ' + messages.length);
  // نبعت كله مرة واحدة
  const url = 'https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send';
  const auth = headers_();
  for (let i = 0; i < messages.length; i += 50) {
    const chunk = messages.slice(i, i + 50);
    const res = UrlFetchApp.fetchAll(chunk.map(function (m) {
      return { url: url, method: 'post', contentType: 'application/json', payload: JSON.stringify(m), headers: auth, muteHttpExceptions: true };
    }));
    res.forEach(function (r, k) {
      const code = r.getResponseCode();
      console.log('send → ' + code + ' ' + r.getContentText().slice(0, 300));
      if (code === 404 || /UNREGISTERED|not a valid FCM registration token/.test(r.getContentText())) {
        req_('delete', 'https://firestore.googleapis.com/v1/' + owners[i + k]); // الجهاز ده لغى الإشعارات
      }
    });
  }
  docs.forEach(function (d) { req_('delete', 'https://firestore.googleapis.com/v1/' + d.name); });
}

// كل الموظفين المسؤولين عن الفرع + الإدارة والدعم اللي اختاروا «كل الفروع»
let adminsCache_ = null;
function staffOf_(shopId) {
  const users = runUsers_({ fieldFilter: { field: { fieldPath: 'shopIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: shopId } } });
  if (!adminsCache_) adminsCache_ = runUsers_({ fieldFilter: { field: { fieldPath: 'role' }, op: 'IN', value: { arrayValue: { values: [{ stringValue: 'admin' }, { stringValue: 'support' }] } } } })
    .filter(function (u) { return u.notifyPrefs && u.notifyPrefs.scope === 'all'; });
  const seen = {};
  return users.concat(adminsCache_).filter(function (u) {
    if (seen[u.id] || u.disabled || u.role === 'cashier') return false;
    seen[u.id] = true; return true;
  });
}
function runUsers_(where) {
  const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'users' }], where: where } });
  return (r.json || []).filter(function (x) { return x.document; }).map(function (x) {
    const u = fields_(x.document); u.id = x.document.name.split('/').pop(); return u;
  });
}

function tokensOf_(uids) {
  const out = [];
  for (let i = 0; i < uids.length; i += 30) {
    const part = uids.slice(i, i + 30);
    if (!part.length) continue;
    const r = req_('post', FS + ':runQuery', { structuredQuery: {
      from: [{ collectionId: 'pushTokens' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'IN', value: { arrayValue: { values: part.map(function (u) { return { stringValue: u }; }) } } } },
    } });
    (r.json || []).forEach(function (x) { if (x.document) { const t = fields_(x.document); if (t.token) out.push({ token: t.token, name: x.document.name }); } });
  }
  return out;
}

// تجربة يدوية: بتبعت إشعار تجربة لكل الأجهزة اللي فعّلت الإشعارات
function testPush() {
  const r = req_('get', FS + '/pushTokens?pageSize=50');
  const docs = (r.json && r.json.documents) || [];
  console.log('devices: ' + docs.length);
  docs.forEach(function (d) {
    const t = fields_(d);
    const res = req_('post', 'https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', { message: {
      token: t.token, data: { title: 'تجربة إشعار من مدقق 🔔', body: 'لو شايف الرسالة دي يبقى الإشعارات شغالة', tag: 'test-' + Date.now() },
      webpush: { headers: { Urgency: 'high', TTL: '600' } } } });
    console.log((t.device || '') + ' ' + (t.uid || '') + ' → ' + res.code + ' ' + res.text.slice(0, 300));
  });
}

// ───────── الصور → Google Drive ─────────
function movePhotos_(deadline) {
  const list = req_('get', FS + '/photoQueue?pageSize=20');
  const docs = (list.json && list.json.documents) || [];
  if (!docs.length) return;
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER'));
  docs.forEach(function (q) {
    if (Date.now() > deadline) return; // الباقي في الدقيقة الجاية
    const path = fields_(q).path || '';
    if (!/^shifts\/[^/]+\/photos\/[^/]+$/.test(path)) { req_('delete', 'https://firestore.googleapis.com/v1/' + q.name); return; }
    const r = req_('get', FS + '/' + path);
    if (r.code === 200) {
      const p = fields_(r.json);
      if (p.data && String(p.data).indexOf('data:') === 0 && !p.driveId) {
        const m = String(p.data).match(/^data:([^;]+);base64,(.*)$/);
        if (m) {
          const month = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM');
          const folder = subFolder_(root, month);
          const parts = path.split('/');
          const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], parts[1] + '_' + parts[3] + '.jpg'));
          file.setDescription(path);
          // نشيل الصورة من Firebase ونسيب مكانها رقم الملف في Drive
          req_('patch', FS + '/' + path + '?updateMask.fieldPaths=data&updateMask.fieldPaths=driveId&updateMask.fieldPaths=driveMonth',
            { fields: { driveId: { stringValue: file.getId() }, driveMonth: { stringValue: month } } });
        }
      }
    }
    req_('delete', 'https://firestore.googleapis.com/v1/' + q.name);
  });
}

function subFolder_(root, name) {
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// كل يوم الساعة 4 الصبح: نمسح فولدرات الشهور القديمة
function cleanup() {
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER'));
  const it = root.getFolders();
  const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    const monthEnd = new Date(Number(m[1]), Number(m[2]), 1).getTime(); // أول الشهر اللي بعده
    if (monthEnd < limit) f.setTrashed(true);
  }
  // تحويلات البنك اللي محدش أكدها من ٣ أيام: تتشال من قدام الكاشير
  const q = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'walletIn' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'new' } } }, limit: 300 } });
  (q.json || []).forEach(function (x) {
    if (!x.document) return;
    if ((fields_(x.document).atMs || 0) < Date.now() - 3 * 24 * 3600 * 1000) req_('patch', 'https://firestore.googleapis.com/v1/' + x.document.name + '?updateMask.fieldPaths=status', { fields: { status: { stringValue: 'expired' } } });
  });
}

// ───────── عرض صورة من Drive جوّه التطبيق ─────────
// التطبيق بيبعت مفتاح دخول الشخص؛ بنقرا بيانات الصورة بصلاحياته هو،
// فلو قواعد Firebase مش سامحاله يشوف الوردية دي، مش هياخد الصورة.
function doPost(e) {
  try {
    if (e.parameter && e.parameter.k) return json_(sms_(e.parameter.k, smsText_(e)));
    if (e.parameter && e.parameter.a === 'personal') return json_(personalFromNote_(e.parameter.g, e.parameter.t));
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'img') return json_(getImg_(body));
    if (body.action === 'mykeys') return json_(myKeys_(body.idToken));
    if (body.action === 'pair') return json_(pair_(body.code));
    if (body.action === 'shopkeys') return json_(shopKeys_(body.shopId, body.token));
    if (body.action === 'purchases') return json_(purchases_(body));
    if (body.action === 'purchase') return json_(purchase_(body));
    if (body.action === 'pimage') return json_(purImage_(body));
    if (body.action === 'pstores') return json_(purStores_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}
function doGet(e) {
  if (e && e.parameter && e.parameter.a === 'personal') return json_(personalFromNote_(e.parameter.g, e.parameter.t));
  if (e && e.parameter && e.parameter.k && e.parameter.t) return json_(sms_(e.parameter.k, e.parameter.t));
  return json_({ ok: true, app: 'modaqqeq-shifts' });
}

// ───────── رسايل البنك من موبايل صاحب المحل ─────────
// تطبيق MacroDroid على الموبايل بيبعت نص الرسالة على الرابط بتاع المحفظة (?k=المفتاح).
// بنسجّلها في walletIn والكاشير بيأكد إن التحويل ده بتاع عميله.
function smsText_(e) {
  if (e.parameter.t) return String(e.parameter.t);
  const raw = (e.postData && e.postData.contents) || '';
  try { const j = JSON.parse(raw); if (j && typeof j === 'object') return String(j.text || j.message || j.sms || j.body || ''); } catch (err) { /* نص عادي */ }
  return String(raw);
}
// نفس الطريقة اللي في src/smsFormat.js بالظبط — لو اتغيرت هنا تتغير هناك
function normSms_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }).replace(/٫/g, '.').replace(/٬/g, ',');
}
function esc_(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// dir: 'in' فلوس دخلت الحساب، 'out' فلوس طلعت منه. balance: الرصيد اللي في الرسالة لو موجود.
const IN_RE_ = /استقبلت|استلمت|[اإأ]ستلام|[اإأ]يداع|received|credited/i;
const OUT_RE_ = /تم تحويل|تم سحب|تم دفع|تم شراء|حولت|سحبت|دفعت|sent|transferred to|debited|withdraw/i;
function smsDir_(t) { if (IN_RE_.test(t)) return 'in'; if (OUT_RE_.test(t)) return 'out'; return null; }
function smsBalance_(t) {
  const m = t.match(/رصيد[^\d]{0,40}?([\d,]*\d(?:\.\d+)?)/) || t.match(/balance(?: is)?\s*:?\s*(?:EGP|LE)?\s*([\d,]+(?:\.\d+)?)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
function parseSms_(text) {
  const t = normSms_(text);
  const dir = smsDir_(t);
  if (!dir) return null;
  const am = t.match(/مبلغ\s*:?\s*([\d,]+(?:\.\d+)?)/) || t.match(/([\d,]+(?:\.\d+)?)\s*(?:جم|جنيه|ج\.م|EGP|LE)/i) || t.match(/(?:EGP|LE)\s*([\d,]+(?:\.\d+)?)/i);
  if (!am) return null;
  const amount = Number(am[1].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  const by = t.match(/باسم\s+(.+?)\s*(?:[،,.;]|\s(?:رصيد|رقم|يوم|في)(?:\s|$))/);
  const nm = by || t.match(/(?:^|\s)(?:من|إلى|الى|لـ?)\s+(?!رقم)(.+?)\s*(?:\s(?:يوم|في|بتاريخ|رقم|برقم)(?:\s|$)|[،,])/);
  const ph = t.match(/(?:^|\D)(\+?2?01\d{9})(?!\d)/);
  const dt = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const tm = t.match(/(\d{1,2}:\d{2})/);
  const rf = t.match(/(?:رقم المعاملة|رقم العملية|الرقم المرجعي|المرجع|Ref(?:erence)?(?: No)?\.?|Transaction ID)\s*:?\s*([A-Za-z0-9]{4,})/i);
  const ipa = t.match(/([A-Za-z0-9._-]+@[A-Za-z0-9]+)/);
  const name = nm ? nm[1].trim() : ipa ? ipa[1] : ''; // إشعار انستاباي: العنوان بدل الاسم
  const ch = t.match(/مصاريف(?:\s*الخدمة)?\s*:?\s*([\d,]+(?:\.\d+)?)/);
  return { dir: dir, amount: amount, charge: ch ? Number(ch[1].replace(/,/g, '')) : 0, balance: smsBalance_(t), fromName: /^\+?\d+$/.test(name) ? '' : name.slice(0, 80), fromPhone: ph ? ph[1] : '', smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', ref: rf ? rf[1] : '', text: t.slice(0, 400) };
}
// صيغة اتعلّمت من التطبيق (الإعداد ← رسايل البنك ← علّم السيستم رسالة جديدة)
function applyFormat_(f, text) {
  const t = normSms_(text);
  if (!f || !f.key || t.indexOf(normSms_(f.key)) < 0) return null;
  const rest = function (fd) {
    if (!fd || !fd.before) return null;
    const m = t.match(new RegExp('(?:^|\\s)' + esc_(fd.before) + '\\s*:?\\s*'));
    return m ? t.slice(m.index + m[0].length) : null;
  };
  const num = function (fd, re) { const r = rest(fd); const m = r !== null ? r.match(re) : null; return m ? m[1] : ''; };
  const words = function (fd) {
    const r = rest(fd);
    if (r === null) return '';
    let end = fd.after ? r.indexOf(fd.after) : -1;
    if (end < 0) end = Math.min(r.length, 50);
    return r.slice(0, end).trim().replace(/[،,.:]+$/, '').slice(0, 80);
  };
  const amount = Number(num(f.amount, /^([\d,]+(?:\.\d+)?)/).replace(/,/g, ''));
  if (!(amount > 0)) return null;
  const tm = t.match(/(\d{1,2}:\d{2})/);
  const dt = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const bal = num(f.balance, /^([\d,]+(?:\.\d+)?)/);
  return { dir: f.dir === 'out' ? 'out' : 'in', amount: amount, balance: bal ? Number(bal.replace(/,/g, '')) : smsBalance_(t), fromName: words(f.name), fromPhone: num(f.phone, /^(\+?\d{8,13})/), ref: num(f.ref, /^([A-Za-z0-9]{3,})/), smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', text: t.slice(0, 400) };
}
function smsFormats_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('smsFormats');
  if (c) return JSON.parse(c);
  const r = req_('get', FS + '/smsFormats?pageSize=100');
  const list = ((r.json && r.json.documents) || []).map(function (d) { return fields_(d); }).filter(function (f) { return f.key && f.on !== false; });
  cache.put('smsFormats', JSON.stringify(list), 120); // دقيقتين
  return list;
}
function parseAny_(text) {
  const fm = smsFormats_();
  for (let i = 0; i < fm.length; i++) { const r = applyFormat_(fm[i], text); if (r) return r; }
  return parseSms_(text);
}

// رسالة واحدة في المرة: لو الإشعار ورسالة البنك وصلوا في نفس اللحظة، التاني يلاقي الأول ويكمّل عليه بدل ما يتسجّل تحويل جديد.
function sms_(key, text) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { /* busy: go on anyway */ }
  try { return smsOne_(key, text); } finally { try { lock.releaseLock(); } catch (e) { /* ignore */ } }
}
function smsOne_(key, text) {
  if (!/^[a-z0-9]{10,40}$/.test(String(key))) return { ok: false, error: 'bad key' };
  const kr = req_('get', FS + '/smsKeys/' + key);
  if (kr.code !== 200) return { ok: false, error: 'bad key' };
  const k = fields_(kr.json);
  const p = parseAny_(text);
  // المحفظة «تبع المحل» (زي فودافون كاش): كل رسالة داخل/طالع بتتسجل لوحدها. «بتروح لصاحب المحل»: بس الداخل، والكاشير يأكده.
  const sr = req_('get', FS + '/shops/' + k.shopId);
  const shop = sr.code === 200 ? fields_(sr.json) : {};
  const wallet = k.wallet || 'insta';
  const shopMode = (shop.walletModes || {})[wallet] === 'shop';
  const okMsg = !!p && (shopMode || p.dir === 'in');
  req_('patch', FS + '/smsKeys/' + key + '?updateMask.fieldPaths=lastAtMs&updateMask.fieldPaths=lastText&updateMask.fieldPaths=lastOk',
    { fields: toFields_({ lastAtMs: Date.now(), lastText: String(text || '').replace(/\s+/g, ' ').slice(0, 200), lastOk: okMsg }) });
  if (!okMsg) return { ok: true, skipped: true };
  const now = new Date();
  const home = shopMode ? k.shopId : ((k.shopIds && k.shopIds[0]) || k.shopId);
  // إشعار انستاباي بيوصل أسرع بس من غير رقم عملية، والرسالة النصية بتيجي بعده فيها رقم العملية.
  // الاتنين يبقوا تحويل واحد: اللي ييجي التاني يكمّل على الأول (نفس المحفظة ونفس المبلغ في آخر 45 دقيقة)، بالترتيب.
  // الإشعار فيه عنوان انستاباي (xxx@instapay) ومفيهوش رقم عملية؛ رسالة من غير رقم عملية ومن غير عنوان = رسالة بنك عادية (زي الأول)
  const isNote = !p.ref && /[a-z0-9._-]@[a-z]/i.test(p.text);
  if (isNote) {
    // MacroDroid ممكن يبعت نفس الإشعار مرتين ورا بعض — ده بس اللي نعتبره تكرار؛ نفس المبلغ من نفس الشخص بعد كده = تحويل جديد
    const ck = 'n:' + key + ':' + md5_(p.text);
    const cache = CacheService.getScriptCache();
    if (cache.get(ck)) return { ok: true, dup: true };
    cache.put(ck, '1', 30);
    const mate = mateOf_(home, wallet, p, now, 'sms');
    if (mate) { patchGroup_(mate, { noteSeen: true, fromIpa: p.fromName || '' }); return { ok: true, matched: true }; }
  } else {
    // نفس الرسالة وصلت مرتين؟ (برقم العملية، ولو البرنامج ماقراهوش: بنص الرسالة)
    if (req_('post', FS + '/smsRefs?documentId=' + encodeURIComponent(key + '_' + (p.ref || 't' + md5_(p.text))), { fields: toFields_({ atMs: now.getTime() }) }).code === 409) return { ok: true, dup: true };
    const mate = mateOf_(home, wallet, p, now, 'note');
    if (mate) {
      patchGroup_(mate, { ref: p.ref || '', fromName: p.fromName || mate.fromName || '', fromIpa: mate.fromName || '', fromPhone: p.fromPhone || mate.fromPhone || '', smsDate: p.smsDate, smsTime: p.smsTime,
        balance: p.balance, charge: p.charge || 0, smsText: p.text, bankOk: true, bankAtMs: now.getTime() });
      return { ok: true, matched: true };
    }
  }
  const refKey = p.ref || (isNote ? 'n' + now.getTime().toString(36) + md5_(p.text).slice(0, 6) : md5_(p.text));
  const base = { wallet: wallet, dir: p.dir, amount: p.amount, charge: p.charge || 0, balance: p.balance, fromName: p.fromName, fromPhone: p.fromPhone, ref: p.ref, smsDate: p.smsDate, smsTime: p.smsTime, text: p.text,
    src: isNote ? 'note' : 'sms', bankOk: !isNote, atMs: now.getTime(), day: Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd') };
  if (shopMode) base.group = key + '_' + refKey;
  if (shopMode) {
    const r0 = req_('post', FS + '/walletIn?documentId=' + encodeURIComponent(k.shopId + '_' + refKey), { fields: toFields_(Object.assign({ shopId: k.shopId, status: 'auto' }, base)) });
    if (r0.code === 409) return { ok: true, dup: true };
    return r0.code === 200 ? { ok: true } : { ok: false, error: 'save ' + r0.code };
  }
  // «بتروح لصاحب المحل»: one copy per branch of this account; one lock (smsLocks/group) so only one cashier takes it.
  // Bigger than the limit → not for the cashiers: the owner / accountant decide in «التحويلات».
  // كل رابط ليه اختياراته (الإعداد ← رسايل البنك ← الحماية). بتتنسخ على كل تحويل علشان التطبيق يعرفها.
  const g = Object.assign({ limit: true, window: true, invoice: true, notify: true, personal: true }, k.guards || {});
  const max = Number(k.maxAmount) > 0 ? Number(k.maxAmount) : 3000;
  const big = g.limit && p.amount > max;
  base.windowMin = g.window ? (Number(k.windowMin) > 0 ? Number(k.windowMin) : 60) : 0;
  base.needInvoice = !!g.invoice;
  base.notifyClaim = !!g.notify;
  base.allowPersonal = !!g.personal;
  const shopIds = (k.shopIds && k.shopIds.length ? k.shopIds : [k.shopId]).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  const group = key + '_' + refKey;
  let saved = 0;
  shopIds.forEach(function (sid) {
    const r = req_('post', FS + '/walletIn?documentId=' + encodeURIComponent(sid + '_' + refKey), { fields: toFields_(Object.assign({ shopId: sid, group: group, status: big ? 'big' : 'new' }, base)) });
    if (r.code === 200) saved++;
  });
  if (!saved) return { ok: true, dup: true }; // نفس الرسالة وصلت مرتين
  // صاحب المحل: إشعار لكل تحويل، فيه زرار «شخصي» يشيله من عند الكاشيرية من غير ما يفتح التطبيق (أندرويد).
  // sms_big القديم بقى جوّه الإشعار ده.
  const actUrl = ScriptApp.getService().getUrl() + '?a=personal&g=' + encodeURIComponent(group) + '&t=' + actToken_(group);
  req_('post', FS + '/outbox', { fields: toFields_({ type: 'sms_owner', shopId: shopIds[0], shiftId: '', to: 'staff', toUid: '', byUid: '', atMs: now.getTime(), go: 'wallet', actUrl: g.personal ? actUrl : '',
    title: (big ? '⚠️ تحويل كبير ' : '💰 وصل ') + p.amount + ' ج' + (p.fromName ? ' من ' + p.fromName : ''),
    body: big ? 'أكبر من الحد · مش ظاهر للكاشير · ابعته للكاشير من «التحويلات» أو دوس «شخصي»' : (g.personal ? 'ظاهر للكاشيرية دلوقتي · لو بتاعك إنت دوس «شخصي»' : 'ظاهر للكاشيرية دلوقتي') }) });
  shopIds.forEach(function (sid) {
    if (big) return;
    const ev = big
      ? { type: 'sms_big', shopId: sid, shiftId: '', to: 'staff', toUid: '', byUid: '', atMs: now.getTime(), title: '⚠️ تحويل كبير ' + p.amount + ' ج', body: (p.fromName ? 'من ' + p.fromName + ' · ' : '') + 'أكبر من الحد · مش هيظهر للكاشير إلا لو بعته من «التحويلات»' }
      : { type: 'sms', shopId: sid, shiftId: '', to: 'shopCashiers', toUid: '', byUid: '', atMs: now.getTime(), title: '💰 وصل تحويل ' + p.amount + ' ج', body: (p.fromName ? 'من ' + p.fromName + ' · ' : '') + (base.windowMin ? 'لو ده عميلك أكّده في التطبيق خلال ' + base.windowMin + ' دقيقة' : 'لو ده عميلك أكّده في التطبيق') };
    req_('post', FS + '/outbox', { fields: toFields_(ev) });
  });
  // تطبيق «مدقق Owners» بيعرض شباك عايم بالتحويل وزرار «شخصي»
  const WL = WALLET_NAMES_;
  return { ok: true, popup: { amount: p.amount, from: p.fromName || '', wallet: WL[wallet] || wallet, big: !!big, actUrl: g.personal ? actUrl : '' } };
}
function md5_(t) { return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(t)).map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 16); }
// أقدم تحويل لسه مستني نصّه التاني: من «src» التاني، نفس المحفظة ونفس المبلغ، في آخر 45 دقيقة
function mateOf_(shopId, wallet, p, now, src) {
  const days = [Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd')];
  if (Number(Utilities.formatDate(now, 'Africa/Cairo', 'H')) < 1) days.push(Utilities.formatDate(new Date(now.getTime() - 3600 * 1000), 'Africa/Cairo', 'yyyy-MM-dd'));
  let list = [];
  days.forEach(function (day) {
    const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'walletIn' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'shopId' }, op: 'EQUAL', value: { stringValue: shopId } } },
      { fieldFilter: { field: { fieldPath: 'day' }, op: 'EQUAL', value: { stringValue: day } } }] } } } });
    list = list.concat((r.json || []).filter(function (x) { return x.document; }).map(function (x) { const f = fields_(x.document); f.name = x.document.name; return f; }));
  });
  const since = now.getTime() - 45 * 60 * 1000;
  const cands = list.filter(function (x) {
    if (x.wallet !== wallet || x.dir !== p.dir || Number(x.amount) !== Number(p.amount) || (x.atMs || 0) < since) return false;
    if (src === 'note') return x.src === 'note' && !x.bankOk;   // رسالة البنك بتدوّر على إشعار من غير رسالة
    return x.src === 'sms' && !x.noteSeen;                      // إشعار متأخر بيدوّر على رسالة من غير إشعار
  }).sort(function (a, b) { return (a.atMs || 0) - (b.atMs || 0); });
  return cands[0] || null;
}
// ───────── تطبيق «مدقق Owners» بيجيب محافظه لوحده ─────────
// كل محفظة في الإعدادات ليها «مع مين؟»: موبايل المحل ('shop') أو أكونت شخص (uid).
// صاحب الأكونت يدخل التطبيق فيجيله المحافظ اللي باسمه؛ وموبايل المحل يتربط مرة بكود/QR من الإعدادات.
const WALLET_NAMES_ = { insta: 'انستاباي', insta2: 'انستاباي شخصي', vf: 'فودافون كاش', vf2: 'فودافون كاش شخصي', nbe: 'الأهلي فون كاش' };
const WEB_KEY_ = 'AIzaSyCRCvSveuol7K9eQdDVTPEFundBVD8HtWs'; // مفتاح Firebase العام (نفس اللي في التطبيق)
function keysWhere_(filters) {
  const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters: filters } };
  const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'smsKeys' }], where: where } });
  const base = ScriptApp.getService().getUrl();
  const shopNames = {};
  return ((r.json || []).filter(function (x) { return x.document; })).map(function (x) {
    const f = fields_(x.document);
    const id = x.document.name.split('/').pop();
    if (!(f.shopId in shopNames)) { const sr = req_('get', FS + '/shops/' + f.shopId); shopNames[f.shopId] = sr.code === 200 ? (fields_(sr.json).name || f.shopName || '') : (f.shopName || ''); }
    return { k: id, url: base + '?k=' + id, wallet: f.wallet || 'insta', label: WALLET_NAMES_[f.wallet] || f.wallet || '', shopId: f.shopId, shopName: shopNames[f.shopId] };
  });
}
function eqF_(field, v) { return { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: String(v) } } }; }
// مين صاحب الطلب (بتسجيل دخوله في مدقق) — بنفتكره ساعة إلا ربع علشان مانسألش جوجل كل مرة
function uidOf_(idToken) {
  if (!idToken) return '';
  const cache = CacheService.getScriptCache();
  const ck = 'tok:' + md5_(idToken);
  const hit = cache.get(ck);
  if (hit) return hit;
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + WEB_KEY_, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: String(idToken) }), muteHttpExceptions: true });
  let uid = '';
  try { uid = (JSON.parse(r.getContentText()).users || [])[0].localId || ''; } catch (e) { uid = ''; }
  if (uid) cache.put(ck, uid, 45 * 60);
  return uid;
}
function myKeys_(idToken) {
  const uid = uidOf_(idToken);
  if (!uid) return { ok: false, error: 'login' };
  const ur = req_('get', FS + '/users/' + uid);
  const u = ur.code === 200 ? fields_(ur.json) : {};
  if (!u.role || u.disabled || ['owner', 'manager', 'admin', 'support'].indexOf(u.role) < 0) return { ok: false, error: 'role', name: u.name || '' };
  return { ok: true, name: u.name || '', role: u.role, keys: keysWhere_([eqF_('holder', uid)]) };
}
// كود الربط بيتعمل من الإعدادات وبيعيش ربع ساعة ويتستخدم مرة واحدة
function pair_(code) {
  if (!/^\d{6}$/.test(String(code || ''))) return { ok: false, error: 'code' };
  const r = req_('get', FS + '/devicePairs/' + code);
  if (r.code !== 200) return { ok: false, error: 'code' };
  const p = fields_(r.json);
  req_('delete', FS + '/devicePairs/' + code);
  if (!(Number(p.expMs) > Date.now())) return { ok: false, error: 'expired' };
  const dr = req_('get', FS + '/shopDevices/' + p.shopId);
  const d = dr.code === 200 ? fields_(dr.json) : {};
  if (!d.token) return { ok: false, error: 'code' };
  return { ok: true, shopId: p.shopId, shopName: p.shopName || '', token: d.token };
}
function shopKeys_(shopId, token) {
  if (!shopId || !token) return { ok: false, error: 'unpaired' };
  const dr = req_('get', FS + '/shopDevices/' + shopId);
  const d = dr.code === 200 ? fields_(dr.json) : {};
  if (!d.token || d.token !== String(token)) return { ok: false, error: 'unpaired' };
  const sr = req_('get', FS + '/shops/' + shopId);
  return { ok: true, shopName: sr.code === 200 ? (fields_(sr.json).name || '') : '', keys: keysWhere_([eqF_('shopId', shopId), eqF_('holder', 'shop')]) };
}
// ───────── المشتريات لصاحب المحل ─────────
// من شيت «فواتير المشتريات» بتاع لوحة الدعم (متشارك مع الحساب ده مشاهدة بس) — من غير ما نلمس مشروع «دليل الموظفين».
// المحل بيتربط بالاسم: اسمه في تطبيق الورديات = اسمه في المشتريات، أو الاسم اللي اتختار في الإعدادات (purchasesName).
function purSS_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PUR_SHEET');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* اتشال أو اتغيّر: ندوّر تاني */ } }
  const it = DriveApp.searchFiles("title = 'فواتير المشتريات' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  if (!it.hasNext()) throw new Error('nosheet');
  const f = it.next();
  props.setProperty('PUR_SHEET', f.getId());
  return SpreadsheetApp.openById(f.getId());
}
function purRows_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { m: {}, rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const m = {};
  v[0].forEach(function (h, i) { h = String(h).trim(); if (h) m[h] = i; });
  return { m: m, rows: v.slice(1).filter(function (r) { return String(r[m['id']] || r[m['id الفاتورة']] || '').trim(); }) };
}
// نفس توحيد الكتابة اللي في تطبيق الورديات (src/lib.js · normShopName)
function normShop_(s) {
  return String(s || '').trim().toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, '');
}
function iso_(v) { return v instanceof Date ? v.toISOString() : (v ? String(v) : ''); }
function purObj_(t, r) {
  const g = function (c) { return (c in t.m) ? r[t.m[c]] : ''; };
  const n = function (c) { return Number(g(c)) || 0; };
  const list = function (c) { return String(g(c) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
  return {
    id: String(g('id')), store: String(g('المحل')), supplier: String(g('المورد')), number: String(g('رقم فاتورة المورد')),
    createdAt: iso_(g('وقت الرفع')), user: String(g('الموظف')), count: n('عدد الأصناف'), total: n('الإجمالي'), notes: String(g('ملاحظات')),
    status: String(g('الحالة')).trim(), receivedBy: String(g('استلمها')), receivedAt: iso_(g('وقت الاستلام')),
    systemNo: String(g('رقم الفاتورة في السيستم')), balance: String(g('رصيد المورد')), doneBy: String(g('أدخلها')), doneAt: iso_(g('وقت الإدخال')),
    photos: list('صور الفرع'), screens: list('سكرينات السيستم'), merged: String(g('الصورة المدمجة') || '').trim(),
    typedTotal: g('الإجمالي المكتوب') === '' ? null : Number(g('الإجمالي المكتوب')), totalNote: String(g('ملاحظة الإجمالي')),
    priceChanges: n('تعديلات أسعار البيع'), pricesBy: String(g('عدّل الأسعار')),
    rejectReason: String(g('سبب الرفض')), rejectedBy: String(g('رفضها')), rejectedAt: iso_(g('وقت الرفض')), rejectCount: n('مرات الرفض'),
    reviewedBy: String(g('راجعها الفرع')), reviewedAt: iso_(g('وقت المراجعة')), reviewNotes: String(g('ملاحظات المراجعة')),
    urgeCount: n('مرات الاستعجال'), urgedAt: iso_(g('آخر استعجال')), urgeLog: String(g('سجل الاستعجال')),
    report: String(g('تقرير المدير')), priceUps: n('زيادات الأسعار'), priceDowns: n('نقص الأسعار'),
    qaBy: String(g('راجعتها الجودة')), qaAt: iso_(g('وقت اعتماد الجودة')), qaChecks: String(g('بنود الجودة')), qaNotes: String(g('ملاحظات الجودة')),
    qaRejects: n('مرات رجوع الجودة'), qaLog: String(g('سجل الجودة'))
  };
}
// محلات صاحب الأكونت: اسم كل واحد في المشتريات ← المحل
function purAccess_(idToken) {
  const uid = uidOf_(idToken);
  if (!uid) return { error: 'login' };
  const ur = req_('get', FS + '/users/' + uid);
  const u = ur.code === 200 ? fields_(ur.json) : {};
  if (!u.role || u.disabled || ['owner', 'manager', 'admin', 'support'].indexOf(u.role) < 0) return { error: 'role' };
  const map = {}, shops = [];
  (u.shopIds || []).forEach(function (id) {
    const sr = req_('get', FS + '/shops/' + id);
    if (sr.code !== 200) return;
    const s = fields_(sr.json);
    const key = normShop_(s.purchasesName || s.name);
    map[key] = { id: id, name: s.name || '' };
    shops.push({ id: id, name: s.name || '', key: key });
  });
  return { uid: uid, role: u.role, all: !(u.shopIds || []).length && ['admin', 'support'].indexOf(u.role) >= 0, map: map, shops: shops };
}
function purchases_(d) {
  const a = purAccess_(d.idToken);
  if (a.error) return { ok: false, error: a.error };
  let ss;
  try { ss = purSS_(); } catch (e) { return { ok: false, error: 'nosheet' }; }
  const days = Math.min(Math.max(Number(d.days) || 7, 1), 92);
  const since = Date.now() - days * 86400000;
  const t = purRows_(ss, 'الفواتير');
  const found = {};
  const list = t.rows.map(function (r) { return purObj_(t, r); }).filter(function (v) {
    const k = normShop_(v.store);
    if (!a.all && !a.map[k]) return false;
    found[k] = true;
    return v.createdAt && new Date(v.createdAt).getTime() >= since;
  }).map(function (v) {
    const sh = a.map[normShop_(v.store)];
    v.shopId = sh ? sh.id : ''; v.shopName = sh ? sh.name : v.store;
    delete v.urgeLog; delete v.qaLog; // السجلات الطويلة في التفاصيل بس
    return v;
  });
  list.sort(function (x, y) { return y.createdAt.localeCompare(x.createdAt); });
  // المحلات اللي ملهاش أي فاتورة باسمها في الشيت (يعني مش مربوطة)
  const unmatched = a.shops.filter(function (s) { return !found[s.key]; }).map(function (s) { return s.name; });
  return { ok: true, list: list.slice(0, 600), unmatched: unmatched, days: days };
}
function purFind_(a, id) {
  const ss = purSS_();
  const t = purRows_(ss, 'الفواتير');
  const r = t.rows.find(function (x) { return String(x[t.m['id']]) === String(id); });
  if (!r) return null;
  const v = purObj_(t, r);
  if (!a.all && !a.map[normShop_(v.store)]) return null;
  return { ss: ss, inv: v };
}
function purchase_(d) {
  const a = purAccess_(d.idToken);
  if (a.error) return { ok: false, error: a.error };
  let f;
  try { f = purFind_(a, d.id); } catch (e) { return { ok: false, error: 'nosheet' }; }
  if (!f) return { ok: false, error: 'notfound' };
  const l = purRows_(f.ss, 'أصناف الفواتير');
  const g = function (r, c) { return (c in l.m) ? r[l.m[c]] : ''; };
  const num = function (v) { return v === '' || v === null ? null : Number(v); };
  const lines = l.rows.filter(function (r) { return String(g(r, 'id الفاتورة')) === String(d.id); }).map(function (r) {
    return { n: g(r, 'م'), code: String(g(r, 'كود الصنف') || ''), barcode: String(g(r, 'الباركود')), name: String(g(r, 'اسم الصنف')), isNew: g(r, 'صنف جديد') === 'جديد',
      unit: String(g(r, 'الوحدة')), qty: Number(g(r, 'الكمية')) || 0, cartonSize: g(r, 'قطع في الكرتونة'), pieces: Number(g(r, 'عدد القطع')) || 0,
      piecePrice: Number(g(r, 'سعر القطعة')) || 0, total: Number(g(r, 'الإجمالي')) || 0,
      oldPrice: num(g(r, 'سعر الشراء القديم')), oldSale: num(g(r, 'سعر البيع القديم')), newSale: num(g(r, 'سعر البيع الجديد')), saleAction: String(g(r, 'تعديل السعر') || '') };
  });
  const sh = a.map[normShop_(f.inv.store)];
  f.inv.shopName = sh ? sh.name : f.inv.store;
  return { ok: true, invoice: f.inv, lines: lines };
}
// صورة من صور الفاتورة بس (صور الفرع / سكرين السيستم / المدمجة)
function purImage_(d) {
  const a = purAccess_(d.idToken);
  if (a.error) return { ok: false, error: a.error };
  let f;
  try { f = purFind_(a, d.id); } catch (e) { return { ok: false, error: 'nosheet' }; }
  if (!f) return { ok: false, error: 'notfound' };
  const ids = f.inv.photos.concat(f.inv.screens, f.inv.merged ? [f.inv.merged] : []);
  if (ids.indexOf(String(d.file)) < 0) return { ok: false, error: 'notfound' };
  try {
    const b = DriveApp.getFileById(d.file).getBlob();
    return { ok: true, data: 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  } catch (e) { return { ok: false, error: 'image' }; }
}
// شغّلها مرة من المحرر بعد ما شيت «فواتير المشتريات» يتشارك مع الحساب ده (مشاهدة بس، فمش هيقدر يكتب فيه): بتاخد إذن الشيتات وتتأكد إنها شايفاه
function purCheck() {
  PropertiesService.getScriptProperties().deleteProperty('PUR_SHEET');
  const ss = purSS_();
  const t = purRows_(ss, 'الفواتير');
  Logger.log('✅ شايف شيت المشتريات: ' + ss.getName() + ' · ' + t.rows.length + ' فاتورة');
}
// أسامي المحلات اللي في المشتريات (لإعدادات تطبيق الورديات)
function purStores_(d) {
  const uid = uidOf_(d.idToken);
  if (!uid) return { ok: false, error: 'login' };
  const ur = req_('get', FS + '/users/' + uid);
  const u = ur.code === 200 ? fields_(ur.json) : {};
  if (['admin', 'support'].indexOf(u.role) < 0) return { ok: false, error: 'role' };
  let ss;
  try { ss = purSS_(); } catch (e) { return { ok: false, error: 'nosheet' }; }
  const t = purRows_(ss, 'الفواتير');
  const seen = {};
  t.rows.forEach(function (r) { const n = String(r[t.m['المحل']] || '').trim(); if (n) seen[n] = (seen[n] || 0) + 1; });
  return { ok: true, stores: Object.keys(seen).sort().map(function (n) { return { name: n, count: seen[n] }; }) };
}

// نفس التعديل على كل نسخ التحويل (كل فرع ليه نسخة)
function patchGroup_(mate, patch) {
  let docs = [mate];
  if (mate.group) {
    const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'walletIn' }], where: { fieldFilter: { field: { fieldPath: 'group' }, op: 'EQUAL', value: { stringValue: mate.group } } } } });
    const g = (r.json || []).filter(function (x) { return x.document; }).map(function (x) { return { name: x.document.name }; });
    if (g.length) docs = g;
  }
  const mask = Object.keys(patch).map(function (f) { return 'updateMask.fieldPaths=' + f; }).join('&');
  docs.forEach(function (d) { req_('patch', 'https://firestore.googleapis.com/v1/' + d.name + '?' + mask, { fields: toFields_(patch) }); });
}
// مفتاح سري للزرار اللي في الإشعار: محدش يقدر يعلّم تحويل «شخصي» غير من الإشعار نفسه.
function actToken_(group) {
  const props = PropertiesService.getScriptProperties();
  let sec = props.getProperty('ACT_SECRET');
  if (!sec) { sec = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('ACT_SECRET', sec); }
  return Utilities.computeHmacSha256Signature(String(group), sec).map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 32);
}
function personalFromNote_(group, token) {
  if (!group || !token || token !== actToken_(group)) return { ok: false, error: 'bad token' };
  const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'walletIn' }], where: { fieldFilter: { field: { fieldPath: 'group' }, op: 'EQUAL', value: { stringValue: String(group) } } } } });
  const docs = (r.json || []).filter(function (x) { return x.document; }).map(function (x) { const f = fields_(x.document); f.name = x.document.name; return f; });
  if (!docs.length) return { ok: false, error: 'not found' };
  const taken = docs.filter(function (x) { return x.status === 'claimed'; })[0];
  if (taken) return { ok: false, claimed: true, by: taken.claimedByName || 'الكاشير', amount: taken.amount };
  if (docs.every(function (x) { return x.status === 'personal'; })) return { ok: true, already: true, amount: docs[0].amount };
  const now = Date.now();
  docs.forEach(function (x) {
    if (['new', 'big', 'expired'].indexOf(x.status) < 0) return;
    req_('patch', 'https://firestore.googleapis.com/v1/' + x.name + '?updateMask.fieldPaths=status&updateMask.fieldPaths=decidedByName&updateMask.fieldPaths=decidedAtMs',
      { fields: toFields_({ status: 'personal', decidedByName: 'صاحب المحل (من الإشعار)', decidedAtMs: now }) });
  });
  return { ok: true, amount: docs[0].amount };
}
function toFields_(o) {
  const out = {};
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else out[k] = { stringValue: String(v) };
  });
  return out;
}

function getImg_(body) {
  if (!/^shifts\/[^/]+\/photos\/[^/]+$/.test(body.path || '') || !body.idToken) return { ok: false, error: 'bad request' };
  const r = UrlFetchApp.fetch(FS + '/' + body.path, { headers: { Authorization: 'Bearer ' + body.idToken }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'denied' };
  const p = fields_(JSON.parse(r.getContentText()));
  if (p.data) return { ok: true, data: p.data };
  if (!p.driveId) return { ok: false, error: 'no file' };
  try {
    const file = DriveApp.getFileById(p.driveId);
    if (file.isTrashed()) return { ok: false, error: 'deleted' };
    return { ok: true, data: 'data:' + (file.getMimeType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes()) };
  } catch (err) { return { ok: false, error: 'deleted' }; }
}

// ───────── أدوات ─────────
function headers_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT };
}
function req_(method, url, payload) {
  const opt = { method: method, headers: headers_(), muteHttpExceptions: true };
  if (payload !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  const r = UrlFetchApp.fetch(url, opt);
  const text = r.getContentText();
  let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
  return { code: r.getResponseCode(), json: j, text: text };
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fields_(d) {
  const out = {};
  const f = (d && d.fields) || {};
  Object.keys(f).forEach(function (k) { out[k] = val_(f[k]); });
  return out;
}
function val_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(val_);
  if ('mapValue' in v) return fields_(v.mapValue);
  return null;
}
