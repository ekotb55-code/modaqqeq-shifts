import { toDate, todayKey } from './lib';

// حساب يوم الحضور لكل شخص: الميعاد، التأخير، المشي بدري، والساعات الزيادة اللي محتاجة قرار المدير.
// المواعيد: attSched/{shopId}.people[uid] = { start: 'HH:MM', end: 'HH:MM', dayOff: 0-6 | null }
// تغيير ميعاد ليوم واحد + قرارات المدير: attDays/{shopId}_{day} = { sched: {uid: {start,end,off}}, extra: {uid: {d, byName}} }
// d = 'ot' (أوفر تايم) | 'swap' (تبديل: الزيادة بتغطي التأخير أو المشي بدري) | 'reject' (مش محسوبة)

export const GRACE_MIN = 5; // سماح 5 دقايق قبل ما نحسب تأخير أو زيادة
export const FORGOT_MIN = 15; // بعد 15 دقيقة من الميعاد ومسجلش = «نسي يسجّل؟»
export const EXTRA_LABEL = { ot: 'أوفر تايم', swap: 'تبديل', reject: 'مرفوض' };

const MIN = 60000;
export const dayAt = (day, hhmm) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = String(hhmm || '').split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0).getTime();
};
export const nextDay = (day) => { const [y, m, d] = day.split('-').map(Number); return todayKey(new Date(y, m - 1, d + 1)); };
export const weekday = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

// الوقت المعتمد للتسجيل: لو صاحب الشغل عدّله أو وافق على «جيت الساعة كام» ناخد التعديل.
export const effMs = (r) => (r.fixState === 'ok' && r.fixAtMs ? r.fixAtMs : toDate(r.at)?.getTime() || r.atLocalMs || 0);
export const isVoid = (r) => r.fixState === 'void';

// ميعاد الشخص في اليوم ده (تغيير اليوم الواحد بيغلب الميعاد العادي). null = مالوش ميعاد أو إجازة.
export function schedFor(uid, day, sched, dayDoc) {
  const o = dayDoc?.sched?.[uid];
  const s = o || sched?.people?.[uid];
  if (!o && s?.flex) return null; // مرن: مالوش ميعاد، بس ليه عدد ساعات (flexHours)
  if (!s || s.off) return o?.off ? { off: true } : null;
  if (!o && s.dayOff != null && s.dayOff !== '' && Number(s.dayOff) === weekday(day)) return { off: true };
  if (!s.start || !s.end) return null;
  const start = dayAt(day, s.start);
  let end = dayAt(day, s.end);
  if (end <= start) end += 24 * 3600e3; // وردية بتعدّي نص الليل
  return { start, end, startHM: s.start, endHM: s.end, oneDay: !!o };
}

// مرن = عدد ساعات في اليوم من غير ميعاد ثابت (null لو بميعاد)
export const flexHours = (uid, sched) => { const p = sched?.people?.[uid]; return p?.flex ? Number(p.hours) || 0 : null; };
// فترات الشغل: كل حضور وبعده أول انصراف. open = لسه منصرفش (بنحسبها لحد دلوقتي في الرسم بس)
export function pairsOf(sorted, now = Date.now()) {
  const out = []; let cur = null;
  sorted.forEach((r) => {
    if (r.kind === 'in') { if (cur == null) cur = r.ms; }
    else if (cur != null && r.ms > cur) { out.push([cur, r.ms, false]); cur = null; }
  });
  if (cur != null) out.push([cur, Math.min(now, cur + 18 * 3600e3), true]);
  return out;
}
// أيام الشهر: كل الأيام بتتحسب (30 أو 31) زي ما صاحب الشغل عاوز
export const monthDays = (day) => { const [y, m] = day.split('-').map(Number); const n = new Date(y, m, 0).getDate(); return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`); };
// ساعات المرن في الشهر من تسجيلاته (records = كل تسجيلاته في الشهر + أول يوم في الشهر اللي بعده)
export function flexMonth(records, day, hours, now = Date.now()) {
  const days = monthDays(day);
  const rs = records.filter((r) => !isVoid(r)).map((r) => ({ ...r, ms: effMs(r) })).sort((a, b) => a.ms - b.ms);
  const pairs = pairsOf(rs, now).filter(([x]) => days.includes(todayKey(new Date(x))));
  const worked = pairs.reduce((a, [x, y, open]) => a + (open ? 0 : (y - x) / 3600e3), 0);
  const target = hours * days.length;
  const elapsed = days.filter((d) => d <= todayKey()).length;
  return { worked, target, dueSoFar: hours * elapsed, days: days.length };
}

// records = تسجيلات اليوم + انصراف اليوم اللي بعده (للوردية اللي بتعدّي نص الليل)، لشخص واحد.
export function computeDay({ uid, day, records, sched, dayDoc, now = Date.now() }) {
  const s = schedFor(uid, day, sched, dayDoc);
  const rs = records.filter((r) => !isVoid(r)).map((r) => ({ ...r, ms: effMs(r) })).sort((a, b) => a.ms - b.ms);
  const today = rs.filter((r) => r.day === day);
  const ins = today.filter((r) => r.kind === 'in');
  const firstIn = ins[0]?.ms || null;
  // آخر انصراف بعد أول حضور: من نفس اليوم، أو من اليوم اللي بعده قبل أول حضور فيه
  const nextFirstIn = rs.find((r) => r.day !== day && r.kind === 'in')?.ms || Infinity;
  const outs = rs.filter((r) => r.kind === 'out' && firstIn && r.ms > firstIn && (r.day === day || r.ms < nextFirstIn));
  const lastOut = outs.length ? outs[outs.length - 1].ms : null;
  const lastKind = today.length ? today[today.length - 1].kind : null;
  const pairs = pairsOf(rs.filter((r) => r.day === day || (r.kind === 'out' && r.ms < nextFirstIn)), now);
  const flexH = flexHours(uid, sched);
  const out = { pairs, workedMin: pairs.reduce((a, [x, y, open]) => a + (open ? 0 : Math.round((y - x) / MIN)), 0), flex: flexH, sched: s, firstIn, lastOut, late: 0, earlyIn: 0, earlyLeave: 0, stayLate: 0, extra: 0, short: 0, decision: null, pending: false, absent: false, noOut: false, forgotIn: false };
  if (flexH && !s) return out; // المرن مبيتحسبش عليه تأخير ولا غياب، بيتحسب بمجموع ساعاته في الشهر
  if (!firstIn) {
    if (s && !s.off) {
      out.forgotIn = now > s.start + FORGOT_MIN * MIN && now < s.end;
      out.absent = now >= s.end;
    }
    return out;
  }
  // آخر حاجة عملها حضور ومفيش انصراف بعده = نسي ينصرف (بعد آخر ميعاده بساعتين)
  const openIn = !lastOut || (lastKind === 'in' && today[today.length - 1].ms > lastOut);
  out.noOut = openIn && (s && !s.off ? now > s.end + 2 * 3600e3 : day < todayKey());
  if (!s || s.off) {
    // جه في يوم مالوش فيه ميعاد (إجازته): كل الوقت زيادة ومحتاج قرار
    if (s?.off && lastOut) { out.extra = Math.round((lastOut - firstIn) / MIN); }
  } else {
    const g = GRACE_MIN * MIN;
    const diff = (a, b) => (a - b > g ? Math.round((a - b) / MIN) : 0);
    out.late = diff(firstIn, s.start);
    out.earlyIn = diff(s.start, firstIn);
    if (lastOut) { out.earlyLeave = diff(s.end, lastOut); out.stayLate = diff(lastOut, s.end); }
    out.extra = out.earlyIn + out.stayLate;
    out.short = out.late + out.earlyLeave;
  }
  const d = dayDoc?.extra?.[uid];
  out.decision = d || null;
  out.pending = out.extra > 0 && !d;
  if (d?.d === 'swap') { const cover = Math.min(out.extra, out.short); out.short -= cover; out.covered = cover; }
  out.otMin = d?.d === 'ot' ? out.extra : 0;
  return out;
}

export const minStr = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} س ${r} د` : `${h} س`) : `${r} د`; };

// ---------- بورد القواعد (لكل فرع، صاحب المحل بيغيّرها من تاب «الموظفين» ← «القواعد») ----------
// lateTiers: لو اتأخر من «min» دقيقة أو أكتر → يتخصم «v» من «unit» (h = ساعات، day = أيام). بناخد أكبر صف ينطبق.
// absentDays: الغياب من غير إذن المدير = كام يوم خصم. otMode: double = كل ساعة بساعتين، firstNormal = أول ساعة عادي والباقي بساعتين.
export const DEFAULT_RULES = {
  lateTiers: [
    { min: 15, v: 1, unit: 'h' },
    { min: 30, v: 0.5, unit: 'day' },
    { min: 120, v: 1, unit: 'day' },
  ],
  absentDays: 2,
  otMode: 'double',
};
export const rulesOf = (r) => ({ ...DEFAULT_RULES, ...(r || {}), lateTiers: (r?.lateTiers?.length ? r.lateTiers : DEFAULT_RULES.lateTiers).slice().sort((a, b) => a.min - b.min) });
// خصم التأخير: { v, unit } أو null
export function lateDeduct(lateMin, rules) {
  const t = rulesOf(rules).lateTiers.filter((x) => lateMin >= Number(x.min)).pop();
  return t ? { v: Number(t.v), unit: t.unit } : null;
}
export const deductStr = (d) => (!d ? '' : d.unit === 'day' ? (d.v === 0.5 ? 'نص يوم' : d.v === 1 ? 'يوم' : d.v === 2 ? 'يومين' : `${d.v} أيام`) : (d.v === 1 ? 'ساعة' : d.v === 2 ? 'ساعتين' : `${d.v} ساعات`));
// الأوفر تايم بعد موافقة المدير: كام ساعة تتحسب
export function otHours(minutes, rules) {
  const h = minutes / 60;
  return rulesOf(rules).otMode === 'firstNormal' ? Math.min(h, 1) + Math.max(0, h - 1) * 2 : h * 2;
}
