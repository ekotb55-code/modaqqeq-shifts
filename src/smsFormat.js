// Reading bank SMS ("you received a transfer…").
// SAME LOGIC lives in apps-script/Code.gs (parseSms_, applyFormat_) — change both together.

export function normSms(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Built-in formats (Alex Bank, National Bank of Egypt and similar).
export function parseBuiltIn(text) {
  const t = normSms(text);
  if (!/استقبلت|استلمت|[اإأ]ستلام|received/i.test(t)) return null;
  const am = t.match(/مبلغ\s*:?\s*([\d,]+(?:\.\d+)?)/) || t.match(/([\d,]+(?:\.\d+)?)\s*(?:جم|جنيه|ج\.م|EGP|LE)/i);
  if (!am) return null;
  const amount = Number(am[1].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  const nm = t.match(/(?:^|\s)من\s+(.+?)\s*(?:\s(?:يوم|في|بتاريخ|رقم|برقم)(?:\s|$)|[،,])/);
  const ph = t.match(/برقم\s*(\+?\d{10,13})/);
  const dt = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const tm = t.match(/(\d{1,2}:\d{2})/);
  const rf = t.match(/(?:رقم المعاملة|رقم العملية|الرقم المرجعي|المرجع|Ref(?:erence)?(?: No)?\.?)\s*:?\s*([A-Za-z0-9]{4,})/i);
  return { amount, fromName: nm ? nm[1].trim().slice(0, 80) : '', fromPhone: ph ? ph[1] : '', smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', ref: rf ? rf[1] : '', text: t.slice(0, 400) };
}

// A format taught from the app: { key, amount:{before}, name:{before,after}, phone:{before}, ref:{before} }
export function applyFormat(f, text) {
  const t = normSms(text);
  if (!f || !f.key || t.indexOf(normSms(f.key)) < 0) return null;
  const rest = (fd) => {
    if (!fd || !fd.before) return null;
    const m = t.match(new RegExp('(?:^|\\s)' + esc(fd.before) + '\\s*:?\\s*'));
    return m ? t.slice(m.index + m[0].length) : null;
  };
  const num = (fd, re) => { const r = rest(fd); const m = r !== null ? r.match(re) : null; return m ? m[1] : ''; };
  const words = (fd) => {
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
  return { amount, fromName: words(f.name), fromPhone: num(f.phone, /^(\+?\d{8,13})/), ref: num(f.ref, /^([A-Za-z0-9]{3,})/), smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', text: t.slice(0, 400) };
}

export function parseSms(text, formats = []) {
  for (const f of formats) { const r = applyFormat(f, text); if (r) return r; }
  return parseBuiltIn(text);
}

// Teach: the sample message + the values as they appear in it → a format.
// The anchor is the one word just before each value (the bank's fixed label, like «بمبلغ» or «برقم»).
export function buildFormat(sample, { key, amount, name, phone, ref }) {
  const t = normSms(sample);
  const find = (v) => {
    const s = normSms(v);
    if (!s) return null;
    const i = t.indexOf(s);
    if (i < 0) return { missing: true };
    const pre = t.slice(0, i).trim().split(' ');
    const before = (pre[pre.length - 1] || '').replace(/[:]+$/, '');
    const post = t.slice(i + s.length).trim();
    const after = post ? (/^[،,.]/.test(post) ? post[0] : post.split(' ')[0]) : '';
    return { before, after };
  };
  const out = { key: normSms(key), amount: find(amount), name: find(name), phone: find(phone), ref: find(ref) };
  const missing = ['amount', 'name', 'phone', 'ref'].filter((k) => out[k]?.missing);
  return { format: out, missing };
}
export const firstWords = (text, n = 3) => normSms(text).split(' ').slice(0, n).join(' ');
