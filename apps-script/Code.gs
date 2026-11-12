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
 * لازم الحساب اللي بيشغّل السكريبت يكون صاحب مشروع Firebase (ekotb55@gmail.com).
 */

const PROJECT = 'modaqqeq-shifts';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const KEEP_DAYS = 60; // الصور بتتمسح بعد كده
// مين يوصله إيه — كل واحد يقدر يغيّر اختياره من الجرس جوّه التطبيق (نفس الجدول في src/notifyPrefs.js)
const PREF_OF = { handover: 'handover', reopen_done: 'handover', dispute: 'request', ack: 'request', msg: 'msg', close_report: 'close' };
const DEFAULTS = {
  accountant: { handover: true, request: true, msg: true, close: false },
  reviewer: { handover: true, request: true, msg: true, close: false },
  owner: { close: true },
  manager: { close: true },
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
          data: { title: String(ev.title || 'مدقق'), body: String(ev.body || ''), tag: (ev.shiftId || '') + ':' + (ev.type || '') + ':' + (ev.atMs || ''), shiftId: String(ev.shiftId || ''), shopId: String(ev.shopId || ''), type: String(ev.type || ''), go: go, alarm: ['handover', 'reopen_done', 'dispute'].indexOf(ev.type) >= 0 ? '1' : '0' },
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
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'img') return json_(getImg_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}
function doGet(e) {
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
  const name = nm ? nm[1].trim() : '';
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

function sms_(key, text) {
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
  const id = k.shopId + '_' + (p.ref || Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, p.text).map(function (b) { return ((b + 256) % 256).toString(16); }).join('').slice(0, 16));
  const now = new Date();
  const doc = { shopId: k.shopId, wallet: wallet, dir: p.dir, amount: p.amount, charge: p.charge || 0, balance: p.balance, fromName: p.fromName, fromPhone: p.fromPhone, ref: p.ref, smsDate: p.smsDate, smsTime: p.smsTime, text: p.text,
    atMs: now.getTime(), day: Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd'), status: shopMode ? 'auto' : 'new' };
  const r = req_('post', FS + '/walletIn?documentId=' + encodeURIComponent(id), { fields: toFields_(doc) });
  if (r.code === 409) return { ok: true, dup: true }; // نفس الرسالة وصلت مرتين
  if (r.code !== 200) return { ok: false, error: 'save ' + r.code };
  if (!shopMode) {
    req_('post', FS + '/outbox', { fields: toFields_({ type: 'sms', shopId: k.shopId, shiftId: '', to: 'shopCashiers', toUid: '', byUid: '', atMs: now.getTime(),
      title: '💰 وصل تحويل ' + p.amount + ' ج', body: (p.fromName ? 'من ' + p.fromName + ' · ' : '') + 'لو ده عميلك أكّده في التطبيق' }) });
  }
  return { ok: true };
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
