// Reading bank SMS ("you received a transfer…").
// SAME LOGIC lives in apps-script/Code.gs (parseSms_, applyFormat_) — change both together.

export function normSms(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Built-in formats (Alex Bank, National Bank of Egypt, Vodafone Cash and similar).
// dir: 'in' money came into the account, 'out' money left it. balance: the account balance the message says, if any.
const IN_RE = /استقبلت|استلمت|[اإأ]ستلام|[اإأ]يداع|received|credited/i;
const OUT_RE = /تم تحويل|تم سحب|تم دفع|تم شراء|حولت|سحبت|دفعت|sent|transferred to|debited|withdraw/i;
export function smsDir(t) {
  if (IN_RE.test(t)) return 'in';
  if (OUT_RE.test(t)) return 'out';
  return null;
}
export function smsBalance(t) {
  const m = t.match(/رصيد[^\d]{0,40}?([\d,]*\d(?:\.\d+)?)/) || t.match(/balance(?: is)?\s*:?\s*(?:EGP|LE)?\s*([\d,]+(?:\.\d+)?)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
export function parseBuiltIn(text) {
  const t = normSms(text);
  const dir = smsDir(t);
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
  return { dir, amount, charge: ch ? Number(ch[1].replace(/,/g, '')) : 0, balance: smsBalance(t), fromName: /^\+?\d+$/.test(name) ? '' : name.slice(0, 80), fromPhone: ph ? ph[1] : '', smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', ref: rf ? rf[1] : '', text: t.slice(0, 400) };
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
  const bal = num(f.balance, /^([\d,]+(?:\.\d+)?)/);
  return { dir: f.dir === 'out' ? 'out' : 'in', amount, balance: bal ? Number(bal.replace(/,/g, '')) : smsBalance(t), fromName: words(f.name), fromPhone: num(f.phone, /^(\+?\d{8,13})/), ref: num(f.ref, /^([A-Za-z0-9]{3,})/), smsDate: dt ? dt[1] : '', smsTime: tm ? tm[1] : '', text: t.slice(0, 400) };
}

export function parseSms(text, formats = []) {
  for (const f of formats) { const r = applyFormat(f, text); if (r) return r; }
  return parseBuiltIn(text);
}

// Teach: the sample message + the values as they appear in it → a format.
// The anchor is the one word just before each value (the bank's fixed label, like «بمبلغ» or «برقم»).
export function buildFormat(sample, { key, amount, name, phone, ref, balance, dir }) {
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
  const out = { key: normSms(key), dir: dir === 'out' ? 'out' : 'in', amount: find(amount), name: find(name), phone: find(phone), ref: find(ref), balance: find(balance) };
  const missing = ['amount', 'name', 'phone', 'ref', 'balance'].filter((k) => out[k]?.missing);
  return { format: out, missing };
}
export const firstWords = (text, n = 3) => normSms(text).split(' ').slice(0, n).join(' ');
