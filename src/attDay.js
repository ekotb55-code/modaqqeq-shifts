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
  if (!s || s.off) return o?.off ? { off: true } : null;
  if (!o && s.dayOff != null && s.dayOff !== '' && Number(s.dayOff) === weekday(day)) return { off: true };
  if (!s.start || !s.end) return null;
  const start = dayAt(day, s.start);
  let end = dayAt(day, s.end);
  if (end <= start) end += 24 * 3600e3; // وردية بتعدّي نص الليل
  return { start, end, startHM: s.start, endHM: s.end, oneDay: !!o };
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
  const out = { sched: s, firstIn, lastOut, late: 0, earlyIn: 0, earlyLeave: 0, stayLate: 0, extra: 0, short: 0, decision: null, pending: false, absent: false, noOut: false, forgotIn: false };
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
