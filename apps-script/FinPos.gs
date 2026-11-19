/**
 * «الموقف المالي» لكل فرع — من برنامج البيع نفسه (بدر)، من غير ما نحسب أي حاجة.
 *
 * كل يوم الساعة 4 الفجر (أو لما الأونر يدوس «هات دلوقتي» في Owners):
 *  ١. نقرا تاب «ربط برامج البيع» من شيت «دليل الموظفين» (قراية بس، والباسوردات مش بتتحفظ في أي حتة).
 *  ٢. لكل فرع ندخل برنامج البيع باليوزر والباسورد ونفتح صفحة «الموقف المالى» وناخد أرقامها زي ما هي.
 *  ٣. نحفظ لقطة اليوم في finPos (يوم لكل فرع، آخر سحب في اليوم هو اللي بيفضل).
 *  ٤. إشعار لأونرز الفرع بس.
 *
 * الفرع بيتربط بالمحل: «اسم الفرع في التطبيق المجمع (دليل الموظفين)» في إعداد المحل، ولو فاضي باسم المحل نفسه.
 *
 * أول مرة: شغّل finPosTest من فوق (بيجرب أول فرع ويكتب اللي حصل في السجل)،
 * وبعدين finPosSetup مرة واحدة علشان يتظبط ميعاد 4 الفجر، و finPosAll لو عايز تسحب كل الفروع دلوقتي.
 */

const FP_TAB = 'ربط برامج البيع';
const FP_SHEET_NAME = 'دليل الموظفين';
const FP_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const FP_FIELDS = ['treasury', 'customers', 'inventory', 'suppliers', 'totalFor', 'totalAgainst', 'net'];

// ───────── التشغيل ─────────
// الميعاد اليومي (من غير ما نلمس باقي المواعيد)
function finPosSetup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'finPosAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('finPosAll').timeBased().everyDays(1).atHour(4).create();
  Logger.log('✅ الموقف المالي هيتسحب كل يوم الساعة 4 الفجر');
}
// كل الفروع + إشعار للأونرز
function finPosAll() {
  const res = finPosRun_(null, true);
  res.forEach(function (r) { Logger.log((r.ok ? '✅ ' : '❌ ') + r.branch + (r.ok ? ' · الصافي ' + r.net : ' · ' + r.error) + (r.shopId ? '' : ' · (مش مربوط بمحل)')); });
}
// تجربة على فرع واحد: بيكتب كل خطوة في السجل. غيّر الاسم لو عايز فرع تاني.
function finPosTest() {
  const name = 'فرع مايو';
  const list = fpBranches_();
  Logger.log('شايف ' + list.length + ' فرع في «' + FP_TAB + '»');
  const b = list.filter(function (x) { return normShop_(x.branch) === normShop_(name); })[0] || list[0];
  if (!b) throw new Error('التاب فاضي');
  Logger.log('بنجرب: ' + b.branch + ' · ' + b.url + ' · ' + b.user);
  const r = fpFetch_(b, true);
  Logger.log(JSON.stringify(r, null, 1));
}

// ───────── السحب ─────────
// onlyShops: ids المحلات المطلوبة بس (أو null للكل)
function finPosRun_(onlyShops, notify) {
  const t0 = Date.now();
  const branches = fpBranches_();
  const shopOf = fpShopMap_();
  const day = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  const out = [];
  branches.forEach(function (b) {
    const shop = shopOf[normShop_(b.branch)] || null;
    if (onlyShops && !(shop && onlyShops.indexOf(shop.id) >= 0)) return;
    if (Date.now() - t0 > 300000) { out.push({ branch: b.branch, shopId: shop ? shop.id : '', ok: false, error: 'time' }); return; }
    let r;
    try { r = fpFetch_(b, false); } catch (e) { r = { ok: false, error: 'net', detail: String(e).slice(0, 200) }; }
    r.branch = b.branch; r.shopId = shop ? shop.id : ''; r.shopName = shop ? shop.name : ''; r.day = day; r.atMs = Date.now();
    fpSave_(r);
    out.push(r);
    if (notify && r.ok && r.shopId) {
      req_('post', FS + '/outbox', { fields: toFields_({ to: 'owners', shopId: r.shopId, type: 'finpos', atMs: r.atMs,
        title: '💼 الموقف المالي · ' + (r.shopName || r.branch),
        body: 'الصافي ' + fpMoney_(r.net) + ' ج · الخزن ' + fpMoney_(r.treasury) + ' ج · المخزون ' + fpMoney_(r.inventory) + ' ج' }) });
    }
  });
  return out;
}
function fpMoney_(n) { return n === null || n === undefined ? '—' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fpSave_(r) {
  const id = (r.shopId || ('b_' + md5_(r.branch))) + '_' + r.day;
  const doc = { shopId: r.shopId, shopName: r.shopName || '', branch: r.branch, day: r.day, atMs: r.atMs, ok: !!r.ok, error: r.error || '' };
  FP_FIELDS.forEach(function (k) { doc[k] = (r[k] === undefined ? null : r[k]); });
  doc.rows = r.rows ? JSON.stringify(r.rows).slice(0, 20000) : '';
  // لو السحب فشل ومعانا لقطة سليمة النهارده: منمسحهاش
  if (!r.ok) {
    const old = req_('get', FS + '/finPos/' + encodeURIComponent(id));
    if (old.code === 200 && fields_(old.json).ok) return;
  }
  req_('patch', FS + '/finPos/' + encodeURIComponent(id), { fields: toFields_(doc) });
}

// ───────── الشيت ─────────
function fpSS_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FP_SHEET');
  if (id) { try { const s = SpreadsheetApp.openById(id); if (s.getSheetByName(FP_TAB)) return s; } catch (e) { /* اتشال: ندوّر تاني */ } }
  const it = DriveApp.searchFiles("title = '" + FP_SHEET_NAME + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    try { const s = SpreadsheetApp.openById(f.getId()); if (s.getSheetByName(FP_TAB)) { props.setProperty('FP_SHEET', f.getId()); return s; } } catch (e) { /* مش متاح */ }
  }
  throw new Error('مش لاقي شيت «' + FP_SHEET_NAME + '» فيه تاب «' + FP_TAB + '» · اتأكد إنه متشارك مع الحساب ده');
}
function fpBranches_() {
  const sh = fpSS_().getSheetByName(FP_TAB);
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const h = v[0].map(function (x) { return String(x).trim(); });
  const col = function (re) { for (let i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
  const cB = col(/الفرع/), cU = col(/رابط|لينك|link|url/i), cN = col(/المستخدم|يوزر|user/i), cP = col(/كلم|سر|باسورد|المرور|pass/i);
  if (cB < 0 || cU < 0 || cN < 0 || cP < 0) throw new Error('عواميد التاب مش واضحة: ' + h.join(' | '));
  return v.slice(1).map(function (r) {
    return { branch: String(r[cB]).trim(), url: String(r[cU]).trim(), user: String(r[cN]).trim(), pass: String(r[cP]) };
  }).filter(function (b) { return b.branch && /^https?:\/\//i.test(b.url) && b.user; });
}
// اسم الفرع ← المحل (من إعداد «جرد الوردية» أو اسم المحل)
function fpShopMap_() {
  const map = {}, byName = {};
  let page = '';
  for (let n = 0; n < 10; n++) {
    const r = req_('get', FS + '/shops?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    ((r.json && r.json.documents) || []).forEach(function (d) {
      const s = fields_(d); const id = d.name.split('/').pop();
      if (s.disabled) return;
      const o = { id: id, name: s.name || '' };
      const st = s.shiftJard && s.shiftJard.store ? normShop_(s.shiftJard.store) : '';
      if (st) map[st] = o;
      if (s.name) byName[normShop_(s.name)] = o;
    });
    page = r.json && r.json.nextPageToken;
    if (!page) break;
  }
  Object.keys(byName).forEach(function (k) { if (!map[k]) map[k] = byName[k]; });
  return map;
}

// ───────── الدخول على برنامج البيع ─────────
function fpBase_(url) {
  let u = String(url).trim().replace(/[?#].*$/, '');
  u = u.replace(/[^/]*\.php$/i, '');
  if (!/\/$/.test(u)) u += '/';
  return u;
}
function fpAbs_(base, rel) {
  rel = fpDecode_(String(rel || '').trim());
  if (/^https?:\/\//i.test(rel)) return rel;
  const origin = base.match(/^https?:\/\/[^/]+/i)[0];
  if (rel.indexOf('//') === 0) return base.split(':')[0] + ':' + rel;
  if (rel.indexOf('/') === 0) return origin + rel;
  const dir = base.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const segs = dir.slice(origin.length).split('/').filter(function (x) { return x; });
  const rs = rel.split('/');
  while (rs.length > 1 && (rs[0] === '.' || rs[0] === '..')) { if (rs.shift() === '..') segs.pop(); }
  return origin + '/' + segs.concat(rs).join('/').replace(/^\/+/, '');
}
function fpSession_() {
  const jar = {};
  const take = function (r) {
    const h = r.getAllHeaders();
    let sc = h['Set-Cookie'] || h['set-cookie'];
    if (!sc) return;
    if (!Array.isArray(sc)) sc = [sc];
    sc.forEach(function (c) {
      const p = String(c).split(';')[0]; const i = p.indexOf('=');
      if (i <= 0) return;
      const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
      if (!v || v === 'deleted') delete jar[k]; else jar[k] = v;
    });
  };
  const go = function (url, method, payload) {
    method = method || 'get';
    for (let i = 0; i < 8; i++) {
      const headers = { 'User-Agent': FP_UA, 'Accept-Language': 'ar,en;q=0.8', Accept: 'text/html,application/xhtml+xml,*/*' };
      const ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
      if (ck) headers.Cookie = ck;
      const o = { method: method, muteHttpExceptions: true, followRedirects: false, headers: headers };
      if (method === 'post') { o.payload = payload || ''; o.contentType = 'application/x-www-form-urlencoded; charset=UTF-8'; headers.Referer = url; }
      const r = UrlFetchApp.fetch(url, o);
      take(r);
      const code = r.getResponseCode();
      if (code >= 300 && code < 400) {
        const h = r.getAllHeaders(); const loc = h.Location || h.location;
        if (!loc) return { code: code, text: '', url: url };
        url = fpAbs_(url, Array.isArray(loc) ? loc[0] : loc); method = 'get'; payload = undefined;
        continue;
      }
      return { code: code, text: r.getContentText('UTF-8'), url: url };
    }
    throw new Error('redirects');
  };
  return { go: go, jar: jar };
}
function fpAttrs_(tag) {
  const a = {}; const re = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m; const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  while ((m = re.exec(body))) a[m[1].toLowerCase()] = fpDecode_(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
  return a;
}
function fpDecode_(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); }).replace(/&#x([0-9a-f]+);/gi, function (_, d) { return String.fromCharCode(parseInt(d, 16)); });
}
function fpEnc_(o) { return o.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&'); }
// فورم الدخول: الفورم اللي فيها خانة باسورد
function fpLoginForm_(html, pageUrl) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  let f = forms.filter(function (x) { return /type\s*=\s*["']?password/i.test(x); })[0];
  let action = pageUrl;
  if (f) { const fa = fpAttrs_(f.match(/<form\b[^>]*>/i)[0]); if (fa.action) action = fpAbs_(pageUrl, fa.action); }
  else if (/type\s*=\s*["']?password/i.test(html)) f = html; // خانات من غير <form>
  else return null;
  const fields = [], texts = []; let userName = '', passName = '';
  (f.match(/<input\b[^>]*>/gi) || []).forEach(function (t) {
    const a = fpAttrs_(t); const type = (a.type || 'text').toLowerCase();
    if (!a.name) return;
    if (type === 'password') { if (!passName) passName = a.name; return; }
    if (type === 'checkbox' || type === 'radio') { if ('checked' in a) fields.push([a.name, a.value || 'on']); return; }
    if (type === 'submit') { fields.push([a.name, a.value || '']); return; }
    if (['image', 'button', 'reset', 'file'].indexOf(type) >= 0) return;
    if (type === 'hidden') { fields.push([a.name, a.value || '']); return; }
    if (!userName && /user|name|login|mail|account|حساب|مستخدم/i.test(a.name + ' ' + (a.id || '') + ' ' + (a.placeholder || ''))) { userName = a.name; return; }
    texts.push([a.name, a.value || '']);
  });
  if (!userName && texts.length) userName = texts.shift()[0];
  texts.forEach(function (p) { fields.push(p); });
  (f.match(/<button\b[^>]*>/gi) || []).forEach(function (t) { const a = fpAttrs_(t); if (a.name && (a.type || 'submit') === 'submit') fields.push([a.name, a.value || '']); });
  (f.match(/<select\b[^>]*>[\s\S]*?<\/select>/gi) || []).forEach(function (s) {
    const a = fpAttrs_(s.match(/<select\b[^>]*>/i)[0]); if (!a.name) return;
    const opts = s.match(/<option\b[^>]*>/gi) || []; const sel = opts.filter(function (o) { return /\bselected\b/i.test(o); })[0] || opts[0];
    if (sel) fields.push([a.name, fpAttrs_(sel).value || '']);
  });
  return { action: action, userName: userName, passName: passName, fields: fields };
}
function fpNeedsLogin_(res) {
  return /login\.php/i.test(res.url) || /type\s*=\s*["']?password/i.test(res.text);
}
// دخول + صفحة الموقف المالي ← الأرقام
function fpFetch_(b, log) {
  const L = function (s) { if (log) Logger.log(s); };
  const base = fpBase_(b.url);
  const reportUrl = base + 'tools/reports/financial-position';
  const s = fpSession_();
  let lp = s.go(base + 'login.php?lan=ar');
  L('صفحة الدخول: ' + lp.code + ' · ' + lp.url + ' · ' + lp.text.length + ' حرف');
  let form = fpLoginForm_(lp.text, lp.url);
  if (!form) {
    // يمكن الرابط نفسه هو صفحة الدخول
    lp = s.go(b.url); form = fpLoginForm_(lp.text, lp.url);
    L('صفحة الدخول (الرابط نفسه): ' + lp.code + ' · ' + lp.url);
  }
  if (!form || !form.passName) {
    L('مش لاقي فورم الدخول. أول الصفحة:\n' + fpText_(lp.text).slice(0, 1500));
    return { ok: false, error: 'noform' };
  }
  L('الفورم ← ' + form.action + ' · اليوزر: ' + form.userName + ' · الباسورد: ' + form.passName + ' · باقي الخانات: ' + form.fields.map(function (p) { return p[0]; }).join(', '));
  const payload = fpEnc_([[form.userName, b.user], [form.passName, b.pass]].concat(form.fields));
  const after = s.go(form.action, 'post', payload);
  L('بعد الدخول: ' + after.code + ' · ' + after.url + ' · كوكيز: ' + Object.keys(s.jar).join(', '));
  const rep = s.go(reportUrl);
  L('صفحة الموقف المالي: ' + rep.code + ' · ' + rep.url + ' · ' + rep.text.length + ' حرف');
  if (fpNeedsLogin_(rep)) {
    L('لسه بيطلب دخول. رد صفحة الدخول:\n' + fpText_(after.text).slice(0, 800));
    return { ok: false, error: 'poslogin' };
  }
  const r = fpParse_(rep.text);
  if (!r.ok) L('مقدرناش نقرا الأرقام. نص الصفحة:\n' + fpText_(rep.text).slice(0, 2000));
  return r;
}

// ───────── قراية صفحة «الموقف المالى» ─────────
function fpText_(html) {
  return fpDecode_(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function fpNum_(s) {
  s = String(s || '').replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }).replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  const m = s.match(/(-?)(\d+(?:\.\d+)?)(-?)/);
  if (!m) return null;
  const v = Number(m[2]);
  return (m[1] || m[3]) ? -v : v;
}
function fpParse_(html) {
  const body = (String(html).match(/<table\b[\s\S]*<\/table>/i) || [''])[0];
  const rows = (body.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map(function (tr) {
    return (tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(function (td) { return fpText_(td); });
  }).filter(function (r) { return r.some(function (c) { return c; }); });
  const out = { ok: false, rows: rows };
  let totals = 0;
  const nextNum = function (r, i) { for (let k = i + 1; k < r.length; k++) { const n = fpNum_(r[k]); if (n !== null) return n; } return null; };
  rows.forEach(function (r) {
    r.forEach(function (c, i) {
      const n = normShop_(c);
      if (!n) return;
      if (n.indexOf('الصافي') >= 0) { const v = fpNum_(c); out.net = v !== null ? v : nextNum(r, i); return; }
      if (/[\d٠-٩]/.test(c)) return;
      if (n.indexOf('الخزن') >= 0 && out.treasury === undefined) out.treasury = nextNum(r, i);
      else if (n.indexOf('ارصدهالعملاء') >= 0 && out.customers === undefined) out.customers = nextNum(r, i);
      else if (n.indexOf('المخزون') >= 0 && out.inventory === undefined) out.inventory = nextNum(r, i);
      else if (n.indexOf('ارصدهالموردين') >= 0 && out.suppliers === undefined) out.suppliers = nextNum(r, i);
      else if (n === 'الاجمالي') { const v = nextNum(r, i); if (totals === 0) out.totalFor = v; else if (totals === 1) out.totalAgainst = v; totals++; }
    });
  });
  out.ok = out.net !== undefined && out.net !== null;
  if (!out.ok) out.error = 'parse';
  return out;
}

// ───────── Owners ─────────
// مين يشوف: الأونر (محلاته) والإدارة والدعم
function fpAccess_(idToken) {
  const uid = uidOf_(idToken);
  if (!uid) return { error: 'login' };
  const ur = req_('get', FS + '/users/' + uid);
  const u = ur.code === 200 ? fields_(ur.json) : {};
  if (!u.role || u.disabled || ['owner', 'admin', 'support'].indexOf(u.role) < 0) return { error: 'role' };
  const all = !(u.shopIds || []).length && ['admin', 'support'].indexOf(u.role) >= 0;
  return { uid: uid, all: all, ids: u.shopIds || [] };
}
function finPosList_(d) {
  const a = fpAccess_(d.idToken);
  if (a.error) return { ok: false, error: a.error };
  const days = Math.min(Math.max(Number(d.days) || 30, 1), 400);
  const since = Date.now() - days * 86400000;
  let docs = [];
  if (a.all) {
    const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'finPos' }], where: { fieldFilter: { field: { fieldPath: 'atMs' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(since) } } }, limit: 5000 } });
    docs = (r.json || []).filter(function (x) { return x.document; }).map(function (x) { return fields_(x.document); });
  } else {
    for (let i = 0; i < a.ids.length; i += 30) {
      const part = a.ids.slice(i, i + 30);
      const r = req_('post', FS + ':runQuery', { structuredQuery: { from: [{ collectionId: 'finPos' }], where: { fieldFilter: { field: { fieldPath: 'shopId' }, op: 'IN', value: { arrayValue: { values: part.map(function (x) { return { stringValue: x }; }) } } } }, limit: 5000 } });
      docs = docs.concat((r.json || []).filter(function (x) { return x.document; }).map(function (x) { return fields_(x.document); }));
    }
  }
  const list = docs.filter(function (x) { return (x.atMs || 0) >= since; }).map(function (x) { delete x.rows; return x; })
    .sort(function (x, y) { return (y.atMs || 0) - (x.atMs || 0); });
  return { ok: true, list: list, days: days };
}
// «هات دلوقتي» لمحل واحد (من غير إشعار)
function finPosNow_(d) {
  const a = fpAccess_(d.idToken);
  if (a.error) return { ok: false, error: a.error };
  const id = String(d.shopId || '');
  if (!id || (!a.all && a.ids.indexOf(id) < 0)) return { ok: false, error: 'role' };
  let res;
  try { res = finPosRun_([id], false); } catch (e) { return { ok: false, error: 'nosheet', detail: String(e).slice(0, 200) }; }
  if (!res.length) return { ok: false, error: 'nobranch' };
  const r = res[res.length - 1]; delete r.rows;
  return { ok: !!r.ok, error: r.error || '', item: r };
}
