// شروط تقفيل الوردية لكل محل (shop.closeRules):
// orders: نعرض أوردرات التوصيل المفتوحة في برنامج البيع وقت التقفيل (عن طريق سكريبت الجرد المركزي، نفس اسم الفرع)
// nightOn/nightClose/nightFrom/grace: الوردية الليلية مايتقفلش قبل nightClose بأكتر من grace دقيقة إلا بإذن
import { shiftJardOf } from './shiftJard.js';

export const CLOSE_RULES_DEF = { orders: false, nightOn: false, nightClose: '01:00', nightFrom: '18:00', grace: 10, store: '', test: false };
export function closeRulesOf(shop) {
  const c = { ...CLOSE_RULES_DEF, ...(shop?.closeRules || {}) };
  const j = shiftJardOf(shop);
  if (!String(c.store || '').trim()) c.store = j.store || '';
  return c;
}

const toMin = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : null;
};

// الوردية دي ليلية؟ وفاضل كام دقيقة على معاد القفل؟ (المعاد ممكن يبقى بعد نص الليل)
// ليلية = اتفتحت من (nightFrom - ساعة) لحد معاد القفل — بنحكم بمعاد الفتح مش القفل، علشان وردية النص
// اللي بتقفل 6 المغرب ماتتحسبش ليلية.
export function nightState(cfg, now = new Date(), openedAt = null) {
  const close = toMin(cfg.nightClose), from = toMin(cfg.nightFrom);
  if (!cfg.nightOn || close === null || from === null) return { isNight: false, early: false, minsLeft: 0 };
  const D = 1440;
  const tod = (d) => d.getHours() * 60 + d.getMinutes();
  const span = (close - from + D) % D || D;     // من بداية الليلي لحد معاد القفل
  const op = openedAt ? new Date(openedAt) : null;
  const openT = op && !isNaN(op) ? tod(op) : tod(now);
  const isNight = (openT - (from - 60) + D) % D < span + 60;
  const since = (tod(now) - from + D) % D;
  const minsLeft = isNight && since < span ? span - since : 0;
  return { isNight, minsLeft, early: isNight && minsLeft > Number(cfg.grace || 0) };
}

// الأوردرات المفتوحة (توصيل للمنزل) من برنامج البيع
const JARD_URL = 'https://script.google.com/macros/s/AKfycbxUjxuVtROKO7MrxHtmBfzOxsjgwgfvWMVodCHxUdxuFszmgTyWMQFavjt82iJ8U0s/exec';
const JARD_TEST_URL = 'https://script.google.com/macros/s/AKfycbyZM7c-AcAPJPpbfYnPnnvlC7cuL91zmufhQ1URKiJkbgq3ep7okWzwwosPPIbEPjnP/exec';
const JARD_KEY = 'b4d1771abd401101';
export async function shopOrders(cfg, timeoutMs = 60000) {
  const store = String(cfg.store || '').trim();
  if (!store) throw new Error('اسم الفرع مش متسجل في إعدادات المحل');
  const q = new URLSearchParams({ jstore: store, key: JARD_KEY, action: 'shiftOrders', data: '{}' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try { res = await fetch(`${cfg.test ? JARD_TEST_URL : JARD_URL}?${q}`, { signal: ctl.signal }); } catch { throw new Error('مفيش نت أو البرنامج مش بيرد'); } finally { clearTimeout(t); }
  let j;
  try { j = await res.json(); } catch { throw new Error('رد غريب من السكريبت'); }
  if (!j || j.ok !== true) throw new Error(j?.error === 'action غير معروف' ? 'السكريبت لسه ماتحدّثش' : (j?.error || 'حصلت مشكلة'));
  return j;
}
