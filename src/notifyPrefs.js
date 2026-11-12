// Which notifications each person gets. The same table is in the Apps Script (Code.gs → DEFAULTS).
export const NOTE_TYPES = [
  { key: 'handover', label: 'الكاشير سلّم الوردية (أو خلّص تعديلها)', alarmy: true },
  { key: 'request', label: 'طلبات الكاشير على العجز وإقراره بيه' },
  { key: 'msg', label: 'رسايل الكاشيرية في الشات' },
  { key: 'close', label: 'تقرير الوردية لما المحاسب يقفلها (المبيعات والعجز والمصروفات)' },
  { key: 'wallet', label: 'تحويلات انستاباي: كاشير أكّد تحويل، أو وصل تحويل أكبر من الحد' },
];
export const DEFAULTS = {
  accountant: { handover: true, request: true, msg: true, close: false },
  reviewer: { handover: true, request: true, msg: true, close: false },
  owner: { close: true, wallet: true },
  manager: { close: true, wallet: true },
  admin: {},
  support: {},
};
export const wants = (profile, key) => {
  const p = profile?.notifyPrefs || {};
  if (key in p) return !!p[key];
  return !!(DEFAULTS[profile?.role] || {})[key];
};
