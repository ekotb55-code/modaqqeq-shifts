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
const STAFF_ROLES = ['accountant', 'reviewer'];

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
  const messages = [];
  const owners = []; // token doc name for each message (to delete dead ones)
  docs.forEach(function (d) {
    const ev = fields_(d);
    let uids = [];
    if (ev.to === 'cashier' && ev.toUid) uids = [ev.toUid];
    else if (ev.to === 'staff' && ev.shopId) {
      if (!staffCache[ev.shopId]) staffCache[ev.shopId] = staffOf_(ev.shopId);
      uids = staffCache[ev.shopId];
    }
    uids = uids.filter(function (u) { return u && u !== ev.byUid; });
    console.log('event ' + ev.type + ' → ' + ev.to + ' · ' + uids.length + ' people');
    const go = ev.type === 'close' ? 'view' : ev.type === 'reopen' || (ev.type === 'msg' && ev.to === 'cashier') ? 'attn' : '';
    tokensOf_(uids).forEach(function (t) {
      messages.push({
        message: {
          token: t.token,
          data: { title: String(ev.title || 'مدقق'), body: String(ev.body || ''), tag: (ev.shiftId || '') + ':' + (ev.type || '') + ':' + (ev.atMs || ''), shiftId: String(ev.shiftId || ''), shopId: String(ev.shopId || ''), go: go, alarm: ['handover', 'reopen_done', 'dispute'].indexOf(ev.type) >= 0 ? '1' : '0' },
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

function staffOf_(shopId) {
  const r = req_('post', FS + ':runQuery', { structuredQuery: {
    from: [{ collectionId: 'users' }],
    where: { fieldFilter: { field: { fieldPath: 'shopIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: shopId } } },
  } });
  return (r.json || []).filter(function (x) { return x.document; }).map(function (x) {
    const u = fields_(x.document); u.id = x.document.name.split('/').pop(); return u;
  }).filter(function (u) { return STAFF_ROLES.indexOf(u.role) >= 0 && !u.disabled; }).map(function (u) { return u.id; });
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
}

// ───────── عرض صورة من Drive جوّه التطبيق ─────────
// التطبيق بيبعت مفتاح دخول الشخص؛ بنقرا بيانات الصورة بصلاحياته هو،
// فلو قواعد Firebase مش سامحاله يشوف الوردية دي، مش هياخد الصورة.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'img') return json_(getImg_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}
function doGet() { return json_({ ok: true, app: 'modaqqeq-shifts' }); }

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
