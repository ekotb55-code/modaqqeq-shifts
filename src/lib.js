import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import { firebaseConfig } from './firebase';


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
  wallets: ['insta', 'vf'],
  vaults: [],
};

export const RATE_FROM = { cashier: 'بتتخصم من درج الكاشير (بند مصاريف)', posting: 'بتتحسب عند الترحيل' };
// Who pays the machine's %: the shop (100 sale → 98 on the machine) or the customer (invoice 102 → 100 on the machine).
export const RATE_ON = { shop: 'المحل (بتتخصم من المبلغ)', customer: 'العميل (بتتزود على الفاتورة)' };
export const SETTLE = { carry: 'مستمرة · بتترحل تلقائي', liquidate: 'بتتسيّل' };
// بتستقبل رصيد من مندوب؟ (شحن رصيد · شحن آجل · سداد للمندوب). القديم: ممكن وماجيك بس.
export const repTopupOf = (m) => (m?.repTopup ?? /ممكن|ماجيك|ماجك/.test(m?.name || m?.machine || ''));
export const settleOf = (m) => (m?.settle === 'liquidate' || m?.settle === 'daily' ? 'liquidate' : 'carry');

// Machines are configured per shop: name, sub-accounts (or one account), commission rate and how it's settled.
// startZero: the machine always starts a shift at 0 (the cashier doesn't receive a balance, only hands over what came in during the shift).
export function newMachine() {
  return { id: Math.random().toString(36).slice(2, 9), name: '', active: true, hasSubs: false, accounts: [], ratePct: 0, svcPct: 0, rateOn: 'shop', rateFrom: 'posting', settle: 'carry', liqFeePct: 0, inCash: true, startZero: false };
}
// Ready-made choices shown when adding a machine in the setup screen.
export const MACHINE_PRESETS = [
  // Fawry: bills from the main account (customer pays +2% cash), card payments land on «كاش أوت» (customer pays the 2% on the card).
  { name: 'فوري', hasSubs: true, accounts: ['الحساب الرئيسي', 'كاش أوت'], svcPct: 2, ratePct: 2, rateOn: 'customer' },
  { name: 'جيديا', ratePct: 0, settle: 'liquidate', liqFeePct: 2, startZero: true },
  { name: 'ماجيك باي', svcPct: 8 },
  { name: 'ممكن', svcPct: 8 },
];
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
    const base = { machine: m.name.trim(), machineId: m.id, ratePct: num(m.ratePct), svcPct: num(m.svcPct), rateOn: m.rateOn === 'customer' ? 'customer' : 'shop', rateFrom: m.rateFrom, settle: settleOf(m), repTopup: repTopupOf(m), liqFeePct: settleOf(m) === 'liquidate' ? num(m.liqFeePct) : 0, inCash: m.inCash !== false, startZero: !!m.startZero };
    const accs = m.hasSubs ? m.accounts.map((a) => a.trim()).filter(Boolean) : [];
    return accs.length ? accs.map((a) => ({ ...base, account: a })) : [{ ...base, account: 'الرصيد' }];
  });
}

export const BUILTIN_EXPENSE_TYPES = [
  { id: 'supplier', label: 'مورد', icon: 'truck' },
  { id: 'advance', label: 'سلفة موظف', icon: 'person' },
  { id: 'shop', label: 'مصروف محل', icon: 'shop' },
  { id: 'wage', label: 'يومية / مرتب', icon: 'cash' },
  { id: 'delivery', label: 'قبض دليفري', icon: 'truck' },
  { id: 'refund', label: 'مرتجع لعميل', icon: 'undo' },
  { id: 'other', label: 'حاجة تانية', icon: 'dots' },
];
export const newExpenseType = (label = '', q = '', extra = {}) => ({ id: Math.random().toString(36).slice(2, 9), label, q, subs: [], needNote: false, needPhoto: false, ...extra });

// Extra registers in the same shop (sub cashier / delivery). The main register is the shop itself.
export const MAIN_REG = 'main';
export const REG_KIND = { sub: 'كاشير فرعي', delivery: 'دليفري' };
export function newRegister(kind = 'sub') {
  return { id: Math.random().toString(36).slice(2, 9), kind, name: kind === 'delivery' ? 'درج الدليفري' : 'كاشير فرعي', active: true, hasSide: kind !== 'delivery', ops: kind !== 'delivery', wallets: [], machineIds: [] };
}
export const registersOf = (shop) => (shop?.registers || []).filter((r) => r.active !== false && String(r.name || '').trim());
export const regOf = (shop, id) => (!id || id === MAIN_REG ? null : (shop?.registers || []).find((r) => r.id === id) || null);
export const regName = (shop, id) => (regOf(shop, id)?.name || 'الكاشير الأساسي');
// The shop as one register sees it: only its own wallets, machines and side drawer.
export function shopForRegister(shop, regId) {
  if (!shop) return shop;
  const r = regOf(shop, regId);
  if (!r) {
    // Machines that belong to a sub register are not on the main drawer.
    const taken = new Set(registersOf(shop).flatMap((x) => x.machineIds || []));
    return taken.size ? { ...shop, machines: (shop.machines || []).filter((m) => !taken.has(m.machineId)) } : shop;
  }
  const ids = r.machineIds || [];
  return { ...shop, register: r, wallets: r.wallets || [], machines: (shop.machines || []).filter((m) => ids.includes(m.machineId)), noSide: !r.hasSide, noOps: !r.ops };
}
// Which register's open shift / last handover lives where on the shop doc.
export const openOf = (shop, regId) => (!regId || regId === MAIN_REG ? shop?.openShift : shop?.openShifts?.[regId]) || null;
export const lastOf = (shop, regId) => (!regId || regId === MAIN_REG ? shop?.lastHandover : shop?.lastHandovers?.[regId]) || null;
export const openKey = (regId) => (!regId || regId === MAIN_REG ? 'openShift' : `openShifts.${regId}`);
export const lastKey = (regId) => (!regId || regId === MAIN_REG ? 'lastHandover' : `lastHandovers.${regId}`);
export function allOpen(shop) {
  const list = [];
  if (shop?.openShift) list.push({ reg: MAIN_REG, ...shop.openShift });
  Object.entries(shop?.openShifts || {}).forEach(([reg, o]) => { if (o) list.push({ reg, ...o }); });
  return list;
}

export const WEEKDAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

export const ENTRY_TYPES = {
  expense: { label: 'مصروف', color: 'var(--orange)', sign: -1 },
  income: { label: 'إيراد', color: 'var(--lime)', sign: 1 },
  transfer: { label: 'تحويل محفظة', color: 'var(--violet)', sign: 1 },
  topup: { label: 'شحن رصيد مكنة', color: 'var(--yellow)', sign: -1 },
  repPay: { label: 'سداد لمندوب مكنة', color: 'var(--orange)', sign: -1 },
  move: { label: 'نقل بين الدرجين', color: 'var(--sky)', sign: 0 },
  liquidate: { label: 'تسييل / تحويل', color: 'var(--sky)', sign: 0 },
  withdraw: { label: 'سحب لصاحب المحل', color: 'var(--pink)', sign: -1 },
  xfer_out: { label: 'فلوس لكاشير تاني', color: 'var(--sky)', sign: -1 },
  xfer_in: { label: 'فلوس من كاشير تاني', color: 'var(--lime)', sign: 1 },
};

// +1 money came into a drawer, -1 went out, 0 moved / didn't touch the drawers (e.g. «شحن آجل»).
export const entrySign = (e) => (e?.type === 'topup' && e.credit ? 0 : ENTRY_TYPES[e?.type]?.sign || 0);

export const SRC_LABEL = { drawer: 'درج الكاشير', side: 'الدرج الجانبي', insta: 'انستاباي', insta2: 'انستاباي شخصي', vf: 'فودافون كاش', nbe: 'الأهلي فون كاش', 'out:owner': 'صاحب المحل' };

export const ROLE_LABEL = { admin: 'إدارة مدقق', support: 'دعم مدقق', reviewer: 'محاسب', accountant: 'محاسب', manager: 'مدير فرع', owner: 'أونر', cashier: 'كاشير' };

export const isAdminRole = (r) => r === 'admin' || r === 'support';

export const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
export const fmt = (n) => Math.round(num(n) * 100) / 100 === 0 ? '0' : (Math.round(num(n) * 100) / 100).toLocaleString('en-US');

export const billsTotal = (bills) => FACES.reduce((a, f) => a + f * num(bills?.[f]), 0);
export const emptyBills = () => Object.fromEntries(FACES.map((f) => [f, 0]));

// Search that ignores أ/إ/آ/ا, ة/ه, ى/ي and spaces differences.
export const arNorm = (t) => String(t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ').trim();
export const matches = (text, q) => !q.trim() || arNorm(text).includes(arNorm(q));

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
// Cashiers sign in with a username (Arabic or English, or their phone number) and a PIN.
// Arabic spelling variants are unified so "شوقى" and "شوقي" are the same login.
export const USERNAME_RE = /^[a-z0-9ء-ي._-]{2,30}$/;
export const normUsername = (u) => String(u || '').trim().toLowerCase()
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\s+/g, '');
export const cashierEmail = (u) => {
  const n = normUsername(u);
  if (/^[a-z0-9._-]+$/.test(n)) return `${n}@cashier.modaqqeq.app`;
  const hex = Array.from(new TextEncoder().encode(n)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ar-${hex}@cashier.modaqqeq.app`;
};

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

// An email that already has a login but no account in the app: if the typed password is its password,
// we get its id and can link it again.
export async function uidByLogin(email, password) {
  const tmp = initializeApp(firebaseConfig, 'link-' + Date.now());
  try {
    const a = getAuth(tmp);
    const cred = await signInWithEmailAndPassword(a, email, password);
    const uid = cred.user.uid;
    await signOut(a);
    return uid;
  } finally {
    await deleteApp(tmp);
  }
}

// Change another account's password from the admin's screen (free plan has no server):
// sign in as that account in a separate app using the old password, then set the new one.
export async function changeAccountPassword(email, oldPassword, newPassword) {
  const tmp = initializeApp(firebaseConfig, 'pin-' + Date.now());
  try {
    const a = getAuth(tmp);
    const cred = await signInWithEmailAndPassword(a, email, oldPassword);
    await updatePassword(cred.user, newPassword);
    await signOut(a);
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
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    // Kept in the page while the camera/gallery is open; some phones drop detached inputs.
    document.body.appendChild(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      try { done(await compressImage(f, maxSide, quality, type)); } catch { done(null); }
    };
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

// ───────────────────────── الخزن (safes) ─────────────────────────
// Every shop has these safes: the cashier drawer, the side drawer, the wallets it uses,
// and each active machine account. Every operation moves money from one safe to another
// (or in/out of the shop), so each safe has its own statement for the shift.

export const WALLETS = [
  { key: 'insta', label: 'انستاباي' },
  { key: 'insta2', label: 'انستاباي شخصي' },
  { key: 'vf', label: 'فودافون كاش' },
  { key: 'nbe', label: 'الأهلي فون كاش' },
];
// A wallet either belongs to the owner (every transfer is recorded with a photo, no balance is
// received or handed over) or sits in the shop (opening and closing balance only, the accountant sees the difference).
export const WALLET_MODE = { owner: 'بتروح لصاحب المحل', shop: 'تبع المحل' };

// ── Service fee the customer pays on wallet operations (shop wallets like Vodafone Cash) ──
// A list of {upTo, fee}: up to 500 → 5, up to 800 → 10, … Above the last row the last fee is used.
export const DEFAULT_FEE_TIERS = [{ upTo: 500, fee: 5 }, { upTo: 800, fee: 10 }, { upTo: 1000, fee: 15 }, { upTo: 1500, fee: 20 }, { upTo: 1800, fee: 30 }];
const tiersOf = (t) => (t || []).map((x) => ({ upTo: num(x.upTo), fee: num(x.fee) })).filter((x) => x.upTo > 0).sort((a, b) => a.upTo - b.upTo);
export function tierFee(base, tiers) {
  const l = tiersOf(tiers);
  if (!l.length) return 0;
  return (l.find((x) => base <= x.upTo) || l[l.length - 1]).fee;
}
// One wallet message → the sale/cash amount (base) and the fee.
// in: the customer sent base + fee (105 = 100 + 5), the drawer gave/sold 100.
// out: we sent base (500), the customer paid base + fee cash (505).
export function splitWalletSms(sms, tiers) {
  const a = num(sms.amount);
  const l = tiersOf(tiers);
  if (!l.length || sms.ignored) return { base: a, fee: 0 };
  if (sms.dir === 'out') return { base: a, fee: tierFee(a, l) };
  let lo = 0;
  for (const x of l) {
    const b = r2(a - x.fee);
    if (b > lo && b <= x.upTo) return { base: b, fee: x.fee };
    lo = x.upTo;
  }
  const fee = tierFee(a, l);
  return { base: r2(a - fee), fee };
}
// Messages of one wallet → totals.
export function walletSmsTotals(list, tiers) {
  const t = { inCount: 0, inTotal: 0, inBase: 0, inFees: 0, outCount: 0, outTotal: 0, outBase: 0, outFees: 0, charges: 0, fees: 0, lastBalance: null, lastAtMs: 0, rows: [] };
  list.slice().sort((a, b) => (a.atMs || 0) - (b.atMs || 0)).forEach((sms) => {
    const sp = splitWalletSms(sms, tiers);
    t.rows.push({ ...sms, ...sp });
    if (sms.balance !== null && sms.balance !== undefined && (sms.atMs || 0) >= t.lastAtMs) { t.lastBalance = num(sms.balance); t.lastAtMs = sms.atMs || 0; }
    if (sms.ignored || sms.status === 'ignored') return;
    if (sms.dir === 'out') { t.outCount++; t.outTotal = r2(t.outTotal + num(sms.amount)); t.outBase = r2(t.outBase + sp.base); t.outFees = r2(t.outFees + sp.fee); t.charges = r2(t.charges + num(sms.charge)); }
    else { t.inCount++; t.inTotal = r2(t.inTotal + num(sms.amount)); t.inBase = r2(t.inBase + sp.base); t.inFees = r2(t.inFees + sp.fee); }
    t.fees = r2(t.fees + sp.fee);
  });
  return t;
}
export const walletModeOf = (shop, k) => (shop?.walletModes?.[k] === 'shop' ? 'shop' : 'owner');
export const walletModesOf = (shop) => Object.fromEntries(WALLETS.map((w) => [w.key, walletModeOf(shop, w.key)]));
export const machineKey = (m) => `m:${m.machine}|${m.account}`;
export const OWNER = 'out:owner';

// خزن رئيسية: named safes of a shop (e.g. "الخزنة الرئيسية"). Money from the drawers, wallets and machines
// can be moved into them (liquidation / transfer), and each one has its own statement for the shift.
export const VAULT_PREFIX = 'vault:';
export const vaultKey = (id) => VAULT_PREFIX + id;
export const isVaultKey = (k) => String(k).startsWith(VAULT_PREFIX);
export const newVault = (name = '') => ({ id: Math.random().toString(36).slice(2, 9), name, active: true });
export const vaultsOf = (shop) => (shop?.vaults || []).filter((v) => v.active !== false && String(v.name || '').trim());

// Machine totals for machines that have more than one account.
// One photo per machine: Fawry's main + cash-out accounts share a single screen photo.
export function machineGroupsOf(machines) {
  const groups = [];
  (machines || []).forEach((m, i) => {
    const g = groups.find((x) => x.name === m.machine);
    if (g) g.items.push(i); else groups.push({ name: m.machine, items: [i] });
  });
  return groups;
}
// Cards per row: up to 5 in one row; more than that split into even rows.
export const colsFor = (n) => (n <= 5 ? Math.max(1, n) : Math.ceil(n / Math.ceil(n / 5)));
export function machinePhotoLabel(machines, i) {
  const m = machines[i];
  const n = machines.filter((x) => x.machine === m.machine).length;
  return n > 1 ? m.machine : `${m.machine} · ${m.account}`;
}

export function machineTotals(shop, balances) {
  const map = {};
  (shop?.machines || []).forEach((m) => { (map[m.machine] ||= []).push(m); });
  return Object.entries(map).filter(([, l]) => l.length > 1).map(([name, l]) => ({
    key: 't:' + name, label: `إجمالي ${name}`, accounts: l.length,
    value: l.some((m) => balances[machineKey(m)] === undefined || balances[machineKey(m)] === null) ? null : l.reduce((a, m) => a + num(balances[machineKey(m)]), 0),
    after: machineKey(l[l.length - 1]),
  }));
}

export function shopSafes(shop) {
  const wallets = shop?.wallets || ['insta', 'vf'];
  return [
    { key: 'drawer', label: 'درج الكاشير', kind: 'cash', color: '#FF7A1A' },
    ...(shop?.noSide ? [] : [{ key: 'side', label: 'الدرج الجانبي', kind: 'cash', color: '#B6F000' }]),
    ...WALLETS.filter((w) => wallets.includes(w.key)).map((w) => ({ ...w, kind: 'wallet', mode: walletModeOf(shop, w.key), color: w.key === 'vf' ? '#FF4D6D' : w.key === 'nbe' ? '#1F8A4C' : w.key === 'insta2' ? '#7C5CE0' : '#A07CFF' })),
    ...(shop?.machines || []).map((m) => ({ key: machineKey(m), label: `${m.machine} · ${m.account}`, kind: 'machine', color: '#FFC800', m })),
    ...vaultsOf(shop).map((v) => ({ key: vaultKey(v.id), label: v.name, kind: 'vault', color: '#2FBF9B' })),
  ];
}
export function safeLabel(key, shop) {
  if (key === OWNER) return 'صاحب المحل / المحفظة';
  if (key === 'out:expense') return 'مصروف';
  if (key === 'out:fees') return 'مصاريف تسييل';
  if (key === 'in:income') return 'إيراد';
  if (key === 'in:customer') return 'عميل';
  if (key === 'out:reg' || key === 'in:reg') return 'كاشير تاني';
  if (key === 'in:rep') return 'مندوب المكنة (آجل)';
  if (key === 'out:rep') return 'مندوب المكنة (سداد)';
  if (key === 'drawer') return 'درج الكاشير';
  if (key === 'side') return 'الدرج الجانبي';
  const w = WALLETS.find((x) => x.key === key);
  if (w) return w.label;
  if (String(key).startsWith('m:')) return String(key).slice(2).replace('|', ' · ');
  if (isVaultKey(key)) return (shop?.vaults || []).find((v) => vaultKey(v.id) === key)?.name || 'خزنة';
  const s = shopSafes(shop).find((x) => x.key === key);
  return s ? s.label : key;
}

// Turn one recorded operation into money movements between safes.
export function flows(e, shop) {
  const a = num(e.amount);
  const firstAcc = (name) => {
    const m = (shop?.machines || []).find((x) => x.machine === name);
    return m ? machineKey(m) : `m:${name}|الرصيد`;
  };
  switch (e.type) {
    case 'expense': return [{ from: e.src, to: 'out:expense', a }];
    case 'income': return [{ from: 'in:income', to: e.src, a }];
    case 'transfer': return [{ from: 'in:customer', to: e.wallet, a }];
    // «آجل»: the rep sent balance without taking money — the shop owes him, no cash moved.
    case 'topup': return [{ from: e.credit ? 'in:rep' : e.src, to: e.machineKey || firstAcc(e.machine), a }];
    case 'repPay': return [{ from: e.src, to: 'out:rep', a }];
    case 'move': {
      const to = e.to || 'side';
      return [{ from: e.src || (to === 'side' ? 'drawer' : 'side'), to, a }];
    }
    case 'withdraw': return [{ from: e.src, to: OWNER, a }];
    case 'liquidate': {
      const fee = num(e.fee);
      return fee > 0 ? [{ from: e.src, to: e.to, a: a - fee }, { from: e.src, to: 'out:fees', a: fee }] : [{ from: e.src, to: e.to, a }];
    }
    case 'xfer_out': return [{ from: e.src || 'drawer', to: 'out:reg', a }];
    case 'xfer_in': return [{ from: 'in:reg', to: e.src || 'drawer', a }];
    default: return [];
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// Full shift computation. `sales` is the POS sales number (accountant only); pass null if unknown.
export function computeShift(shift, allEntries, shop, sales = null) {
  // A bank transfer the owner refused («مش بتاع المحل») doesn't count: the drawer must have that money.
  const entries = (allEntries || []).filter((e) => !(e.type === 'transfer' && e.smsRejected));
  const rcv = shift?.receive || {};
  const hnd = shift?.handover || null;
  const rm = (list, k) => (list || []).find((x) => machineKey(x) === k);
  const keys = new Set(['drawer', 'side', ...WALLETS.map((w) => w.key)]);
  (rcv.machines || []).forEach((m) => keys.add(machineKey(m)));
  (hnd?.machines || []).forEach((m) => keys.add(machineKey(m)));
  shopSafes(shop).forEach((s) => keys.add(s.key));

  const safes = {};
  keys.forEach((k) => {
    let open = 0;
    if (k === 'drawer') open = num(rcv.drawerTotal);
    else if (k === 'side') open = num(rcv.side);
    else if (k.startsWith('m:')) open = num(rm(rcv.machines, k)?.value);
    else if (isVaultKey(k)) open = num(rcv.vaults?.[k.slice(VAULT_PREFIX.length)]);
    else {
      const wm = hnd?.walletModes?.[k] || rcv.walletModes?.[k];
      const fix = hnd?.walletsOpenFix?.[k];
      open = wm === 'owner' ? 0 : fix !== undefined && fix !== null ? num(fix) : num(rcv.wallets?.[k]);
    }
    safes[k] = { key: k, label: safeLabel(k, shop), open, lines: [], inn: 0, out: 0 };
  });
  const add = (k, label, amount, t) => {
    if (!safes[k]) return;
    safes[k].lines.push({ label, amount: r2(amount), t });
    if (amount >= 0) safes[k].inn += amount; else safes[k].out -= amount;
  };

  let income = 0, expenses = 0, transfers = 0, insta = 0, vf = 0, topups = 0, creditTopups = 0, repPays = 0, withdraws = 0, liquidations = 0, xferIn = 0, xferOut = 0, liqFees = 0;
  entries.forEach((e) => {
    const a = num(e.amount);
    if (e.type === 'expense') expenses += a;
    if (e.type === 'income') income += a;
    if (e.type === 'transfer') { transfers += a; if (e.wallet === 'insta' || e.wallet === 'insta2') insta += a; if (e.wallet === 'vf') vf += a; }
    if (e.type === 'topup') { if (e.credit) creditTopups += a; else topups += a; }
    if (e.type === 'repPay') repPays += a;
    if (e.type === 'withdraw' || (e.type === 'liquidate' && e.to === OWNER)) withdraws += a;
    if (e.type === 'liquidate') { liquidations += a; liqFees += num(e.fee); }
    if (e.type === 'xfer_in') xferIn += a;
    if (e.type === 'xfer_out') xferOut += a;
    flows(e, shop).forEach((f) => {
      const t = e.createdAt || e.createdAtLocal;
      add(f.from, `${opLabel(e)} → ${safeLabel(f.to, shop)}`, -f.a, t);
      add(f.to, `${opLabel(e)} ← ${safeLabel(f.from, shop)}`, f.a, t);
    });
  });

  // Machines: the reading tells us how much the balance moved by itself (card / service sales).
  const machines = [];
  let machineCash = 0, machineFees = 0;
  Object.values(safes).filter((s) => s.key.startsWith('m:')).forEach((s) => {
    const cfg = rm(rcv.machines, s.key) || rm(hnd?.machines, s.key) || (shop?.machines || []).find((x) => machineKey(x) === s.key) || {};
    const closeRead = hnd ? rm(hnd.machines, s.key) : null;
    const close = closeRead && closeRead.value !== null && closeRead.value !== undefined ? num(closeRead.value) : null;
    const sales = close === null ? null : r2(close - s.open - s.inn + s.out);
    const rate = num(cfg.ratePct);
    const live0 = (shop?.machines || []).find((x) => machineKey(x) === s.key);
    // Customer pays the % (Fawry cash-out): the POS invoice is 100, the cashier charges 102 on the card,
    // 100 lands on the machine → the drawer is short exactly 100. Nothing is an expense for the shop.
    // Shop pays it: the invoice was 100, 98 reached the machine → fee 2 = 2% of 100 = 98 × 2 / 98.
    const onCustomer = (cfg.rateOn ?? live0?.rateOn) === 'customer';
    const fee = sales === null || !rate || onCustomer ? 0 : r2((Math.abs(sales) * rate) / (100 - rate));
    const affects = cfg.inCash !== false;
    // Service fee (مقابل خدمة): machines like Momkn / Magic — the customer pays the bill + e.g. 8%.
    // 1000 gone from the balance means 1080 should be in the drawer.
    const live = (shop?.machines || []).find((x) => machineKey(x) === s.key);
    const svcPct = num(cfg.svcPct ?? live?.svcPct);
    const svc = sales !== null && sales < 0 && affects && svcPct ? r2((-sales * svcPct) / 100) : 0;
    machineCash += svc;
    // A card sale of 100 at 2% lands 98 on the machine: the POS counted 100, so the drawer
    // expects 100 less — 98 as the machine sale and 2 as the machine's fee.
    let effect = 0, feeEffect = 0;
    if (sales !== null && affects) {
      effect = -sales;
      feeEffect = sales > 0 ? -fee : fee;
      machineCash += effect + feeEffect;
      if (cfg.rateFrom === 'cashier') machineFees += feeEffect;
    }
    machines.push({ ...s, machine: cfg.machine || s.label.split(' · ')[0], account: cfg.account, close, sales, rate, fee, svcPct, svc, rateFrom: cfg.rateFrom, settle: settleOf(cfg), affects, effect: r2(effect), feeEffect: r2(feeEffect), total: r2(effect + feeEffect + svc) });
    s.expected = close;
  });

  Object.values(safes).filter((x) => isVaultKey(x.key)).forEach((x) => { x.expected = r2(x.open + x.inn - x.out); x.close = x.expected; });

  const side = safes.side;
  side.expected = r2(side.open + side.inn - side.out);
  // Shop wallets: the closing balance is typed at handover; what grew by itself was paid by customers.
  let walletCash = 0;
  const walletInfo = [];
  WALLETS.forEach((w) => {
    const x = safes[w.key];
    const mode = hnd?.walletModes?.[w.key] || rcv.walletModes?.[w.key] || 'legacy';
    x.mode = mode;
    x.expected = r2(x.open + x.inn - x.out);
    x.sales = null;
    if (mode === 'shop') {
      const typed = hnd?.walletsTyped?.[w.key];
      x.close = typed === undefined || typed === null ? null : num(typed);
      if (x.close !== null) {
        x.sales = r2(x.close - x.expected);
        walletCash -= x.sales;
        // Service fees on this wallet's operations (from its messages): the customer paid them on top,
        // so they are the shop's — the drawer keeps them (105 in the wallet = 100 sold + 5 fee).
        x.smsFees = num(shift.smsFees?.[w.key]);
        if (x.smsFees) { walletCash += x.smsFees; x.sales = r2(x.sales - x.smsFees); }
      }
    } else x.close = x.expected;
    walletInfo.push(x);
  });

  const drawer = safes.drawer;
  const hasSales = sales !== null && sales !== undefined && sales !== '';
  const salesN = hasSales ? num(sales) : 0;
  // POS sales paid by wallet are already in a wallet, not in the drawer.
  drawer.expectedBase = r2(drawer.open + drawer.inn - drawer.out);
  drawer.expected = hasSales ? r2(drawer.expectedBase + salesN - transfers + machineCash + walletCash) : null;
  drawer.close = hnd ? num(hnd.drawerTotal) : null;
  side.close = hnd ? num(hnd.side) : null;

  const drawerDiff = hasSales && hnd ? r2(drawer.close - drawer.expected) : null;
  const sideDiff = hnd ? r2(side.close - side.expected) : null;
  const diff = drawerDiff === null ? null : r2(drawerDiff + (sideDiff || 0));

  const recvCash = num(rcv.drawerTotal) + num(rcv.side);
  const handCash = hnd ? num(hnd.drawerTotal) + num(hnd.side) : 0;
  const outCash = r2(expenses + topups + repPays + withdraws);
  return {
    safes, machines, machineGroups: groupMachines(machines), drawer, side, sales: salesN, hasSales, machineCash: r2(machineCash), machineFees: r2(machineFees), liqFees: r2(liqFees), walletCash: r2(walletCash), walletInfo,
    drawerDiff, sideDiff, diff,
    income, expenses, transfers, insta, vf, topups, creditTopups, repPays, withdraws, liquidations, xferIn, xferOut, recvCash, handCash, outCash,
    expected: drawer.expected === null ? null : r2(drawer.expected + side.expected),
  };
}

// Machines with several accounts (Fawry main + cash-out) shown as one total.
export function groupMachines(list) {
  const map = new Map();
  list.forEach((m) => {
    const k = m.machine || m.label;
    if (!map.has(k)) map.set(k, { machine: k, accounts: [], open: 0, close: 0, hasClose: true, sales: 0, hasSales: true, fee: 0, effect: 0, feeEffect: 0, svc: 0, svcPct: m.svcPct, rate: m.rate, rateFrom: m.rateFrom, settle: m.settle, affects: m.affects });
    const g = map.get(k);
    g.accounts.push(m);
    g.open = r2(g.open + num(m.open));
    if (m.close === null) g.hasClose = false; else g.close = r2(g.close + m.close);
    if (m.sales === null) g.hasSales = false; else g.sales = r2(g.sales + m.sales);
    g.fee = r2(g.fee + num(m.fee)); g.effect = r2(g.effect + num(m.effect)); g.feeEffect = r2(g.feeEffect + num(m.feeEffect)); g.svc = r2(g.svc + num(m.svc));
  });
  return [...map.values()].map((g) => ({ ...g, close: g.hasClose ? g.close : null, sales: g.hasSales ? g.sales : null }));
}

function opLabel(e) {
  if (e.type === 'expense') return [e.kindLabel || 'مصروف', e.sub, e.note].filter(Boolean).join(' · ');
  if (e.type === 'income') return ['إيراد', e.reason].filter(Boolean).join(' · ');
  if (e.type === 'transfer') return 'تحويل من عميل';
  if (e.type === 'topup') return e.credit ? 'شحن آجل' : 'شحن رصيد';
  if (e.type === 'repPay') return 'سداد مندوب';
  if (e.type === 'move') return 'نقل';
  if (e.type === 'withdraw') return 'سحب';
  if (e.type === 'liquidate') return ['تسييل / تحويل', num(e.fee) ? `مصاريف ${fmt(e.fee)}` : '', e.note].filter(Boolean).join(' · ');
  if (e.type === 'xfer_out') return `فلوس لـ ${e.toName || 'كاشير تاني'}`;
  if (e.type === 'xfer_in') return `فلوس من ${e.fromName || 'كاشير تاني'}`;
  return e.type;
}

// Back-compat helpers used by older screens.
export function summarize(shift, entries, shop) {
  const c = computeShift(shift, entries, shop, shift?.review?.sales ?? null);
  return { ...c, expected: c.expected ?? 0 };
}
export function sideExpected(shift, entries, shop) {
  return computeShift(shift, entries, shop).side.expected;
}
// What each safe has right now during an open shift (no sales known, so the drawer is left out).
export function liveBalances(shift, entries, shop) {
  const c = computeShift(shift, entries, shop);
  const out = {};
  Object.values(c.safes).forEach((s) => { out[s.key] = s.key === 'drawer' ? null : s.key.startsWith('m:') ? r2(s.open + s.inn - s.out) : s.expected; });
  return out;
}

export const diffText = (d) => (d === null ? '—' : d < 0 ? `عجز ${fmt(-d)} ج` : d > 0 ? `زيادة ${fmt(d)} ج` : 'مضبوط');
