import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from './firebase';

export const getLinkedShop = () => { try { return localStorage.getItem('mdq_shop'); } catch { return null; } };
export const setLinkedShop = (id) => { try { if (id) localStorage.setItem('mdq_shop', id); else localStorage.removeItem('mdq_shop'); } catch { /* storage blocked */ } };

export const FACES =[200, 100, 50, 20, 10, 5, 1];
export const BILL_BG = ['#CDF27A', '#B4D2FF', '#FFC1D8', '#A8EEC8', '#FFC9A8', '#D3C0FF', '#FFE68A'];
export const AVATAR_BG = ['#A07CFF', '#B6F000', '#FF7A1A', '#4CC3FF', '#FFC800', '#FF7EB0'];

export const DEFAULT_SHOP = {
  machines: [],
  machineList: [],
  suppliers: [],
  staff: [],
  shopExpenses: ['مياه وأكياس', 'كهربا', 'نظافة', 'صيانة', 'مواصلات', 'شاي وأكل'],
  incomeReasons: ['سداد آجل من عميل', 'فكة من صاحب المحل', 'إيداع من صاحب المحل', 'مرتجع من مورد', 'بيع كراتين وخردة', 'سداد سلفة'],
  advanceDays: [],
  posUrl: '',
  walletName: '',
};

export const RATE_FROM = { cashier: 'بتتخصم من الكاشير', posting: 'بتتحسب عند الترحيل' };
export const SETTLE = { owner: 'بتترحل لصاحب المحل تلقائي', daily: 'بتتقفل يوميًا' };

// Machines are configured per shop: name, sub-accounts (or one account), commission rate and how it's settled.
export function newMachine() {
  return { id: Math.random().toString(36).slice(2, 9), name: '', active: true, hasSubs: false, accounts: [], ratePct: 0, rateFrom: 'posting', settle: 'owner' };
}
export function machineListOf(shop) {
  if (Array.isArray(shop?.machineList) && shop.machineList.length) return shop.machineList;
  // older shops stored a flat list — group it by machine name
  const map = {};
  (shop?.machines || []).forEach((m) => {
    const k = m.machine || 'مكنة';
    map[k] ||= { ...newMachine(), name: k, accounts: [] };
    if (m.account && m.account !== k) map[k].accounts.push(m.account);
  });
  return Object.values(map).map((m) => ({ ...m, hasSubs: m.accounts.length > 0 }));
}
export function flattenMachines(list) {
  return list.filter((m) => m.active && m.name.trim()).flatMap((m) => {
    const base = { machine: m.name.trim(), machineId: m.id, ratePct: num(m.ratePct), rateFrom: m.rateFrom, settle: m.settle };
    const accs = m.hasSubs ? m.accounts.map((a) => a.trim()).filter(Boolean) : [];
    return accs.length ? accs.map((a) => ({ ...base, account: a })) : [{ ...base, account: 'الرصيد' }];
  });
}

export const WEEKDAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

export const ENTRY_TYPES = {
  expense: { label: 'مصروف', color: '#FF7A1A', sign: -1 },
  income: { label: 'إيراد', color: '#B6F000', sign: 1 },
  transfer: { label: 'تحويل محفظة', color: '#A07CFF', sign: 1 },
  topup: { label: 'شحن رصيد مكنة', color: '#FFC800', sign: -1 },
  move: { label: 'نقل بين الدرجين', color: '#4CC3FF', sign: 0 },
  withdraw: { label: 'سحب لصاحب المحل', color: '#FF7EB0', sign: -1 },
};

export const SRC_LABEL = { drawer: 'درج الكاشير', side: 'الدرج الجانبي', insta: 'انستاباي', vf: 'فودافون كاش' };

export const ROLE_LABEL = { admin: 'إدارة مدقق', reviewer: 'مراجع', accountant: 'محاسب', manager: 'مدير فرع', owner: 'أونر', cashier: 'كاشير' };

export const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
export const fmt = (n) => Math.round(num(n) * 100) / 100 === 0 ? '0' : (Math.round(num(n) * 100) / 100).toLocaleString('en-US');

export const billsTotal = (bills) => FACES.reduce((a, f) => a + f * num(bills?.[f]), 0);
export const emptyBills = () => Object.fromEntries(FACES.map((f) => [f, 0]));

export const todayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const toDate = (t) => (t?.toDate ? t.toDate() : t instanceof Date ? t : t ? new Date(t) : null);
export const timeStr = (t) => {
  const d = toDate(t);
  return d ? d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : '—';
};
export const dateStr = (t) => {
  const d = toDate(t);
  return d ? d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }) : '—';
};
export const durationStr = (a, b) => {
  const s = toDate(a), e = toDate(b) || new Date();
  if (!s) return '—';
  const mins = Math.max(0, Math.round((e - s) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} س ${m} د` : `${m} د`;
};
export const minutesBetween = (a, b) => {
  const s = toDate(a), e = toDate(b);
  return s && e ? Math.max(0, Math.round((e - s) / 60000)) : null;
};

export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
export const initial = (n) => String(n || '?').trim().charAt(0);

// Cashiers sign in with name + 4-digit PIN. Behind the scenes each has an email/password account.
export const cashierPassword = (pin) => `mdq-${pin}-shift`;
export const slug = () => Math.random().toString(36).slice(2, 10);

// Create an auth account without signing the current admin out.
export async function createAccount(email, password) {
  const tmp = initializeApp(firebaseConfig, 'creator-' + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(tmp), email, password);
    const uid = cred.user.uid;
    await signOut(getAuth(tmp));
    return uid;
  } finally {
    await deleteApp(tmp);
  }
}

// Shrink a photo so it can be stored directly in the database (works on the free plan).
export function compressImage(file, maxSide = 1000, quality = 0.7, type = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function pickImage(maxSide, quality, type) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(await compressImage(f, maxSide, quality, type)); } catch { resolve(null); }
    };
    input.click();
  });
}

// Core reconciliation:
// expected cash at handover = received cash + sales + income − cash going out − wallet payments
// difference = counted cash − expected (negative = shortage / عجز, positive = overage / زيادة)
export function summarize(shift, entries) {
  const sumBy = (f) => entries.filter(f).reduce((a, e) => a + num(e.amount), 0);
  const expenses = sumBy((e) => e.type === 'expense');
  const income = sumBy((e) => e.type === 'income');
  const transfers = sumBy((e) => e.type === 'transfer');
  const insta = sumBy((e) => e.type === 'transfer' && e.wallet === 'insta');
  const vf = sumBy((e) => e.type === 'transfer' && e.wallet === 'vf');
  const topups = sumBy((e) => e.type === 'topup');
  const withdraws = sumBy((e) => e.type === 'withdraw');
  const recvCash = num(shift?.receive?.drawerTotal) + num(shift?.receive?.side);
  const handCash = num(shift?.handover?.drawerTotal) + num(shift?.handover?.side);
  const outCash = expenses + topups + withdraws;
  const sales = shift?.review?.sales;
  const hasSales = sales !== undefined && sales !== null && sales !== '';
  const expected = recvCash + num(sales) + income - outCash - transfers;
  const diff = hasSales ? Math.round((handCash - expected) * 100) / 100 : null;
  return { expenses, income, transfers, insta, vf, topups, withdraws, recvCash, handCash, outCash, expected, diff, hasSales };
}

// Side drawer must balance on its own: received + what came in − what went out.
export function sideExpected(shift, entries) {
  let v = num(shift?.receive?.side);
  entries.forEach((e) => {
    const a = num(e.amount);
    if (e.type === 'move') { if ((e.to || 'side') === 'side') v += a; else v -= a; return; }
    if (e.src !== 'side') return;
    if (e.type === 'income') v += a;
    if (['expense', 'topup', 'withdraw'].includes(e.type)) v -= a;
  });
  return Math.round(v * 100) / 100;
}

export const diffText = (d) => (d === null ? '—' : d < 0 ? `عجز ${fmt(-d)} ج` : d > 0 ? `زيادة ${fmt(d)} ج` : 'مضبوط');
