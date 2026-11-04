import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
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
};

export const RATE_FROM = { cashier: 'بتتخصم من درج الكاشير (بند مصاريف)', posting: 'بتتحسب عند الترحيل' };
export const SETTLE = { carry: 'مستمرة · بتترحل تلقائي', liquidate: 'بتتسيّل' };
export const settleOf = (m) => (m?.settle === 'liquidate' || m?.settle === 'daily' ? 'liquidate' : 'carry');

// Machines are configured per shop: name, sub-accounts (or one account), commission rate and how it's settled.
export function newMachine() {
  return { id: Math.random().toString(36).slice(2, 9), name: '', active: true, hasSubs: false, accounts: [], ratePct: 0, rateFrom: 'posting', settle: 'carry', liqFeePct: 0, inCash: true };
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
    const base = { machine: m.name.trim(), machineId: m.id, ratePct: num(m.ratePct), rateFrom: m.rateFrom, settle: settleOf(m), liqFeePct: settleOf(m) === 'liquidate' ? num(m.liqFeePct) : 0, inCash: m.inCash !== false };
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
  expense: { label: 'مصروف', color: '#FF7A1A', sign: -1 },
  income: { label: 'إيراد', color: '#B6F000', sign: 1 },
  transfer: { label: 'تحويل محفظة', color: '#A07CFF', sign: 1 },
  topup: { label: 'شحن رصيد مكنة', color: '#FFC800', sign: -1 },
  move: { label: 'نقل بين الدرجين', color: '#4CC3FF', sign: 0 },
  liquidate: { label: 'تسييل / تحويل', color: '#4CC3FF', sign: 0 },
  withdraw: { label: 'سحب لصاحب المحل', color: '#FF7EB0', sign: -1 },
  xfer_out: { label: 'فلوس لكاشير تاني', color: '#4CC3FF', sign: -1 },
  xfer_in: { label: 'فلوس من كاشير تاني', color: '#B6F000', sign: 1 },
};

export const SRC_LABEL = { drawer: 'درج الكاشير', side: 'الدرج الجانبي', insta: 'انستاباي', vf: 'فودافون كاش', 'out:owner': 'صاحب المحل' };

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
// Cashiers sign in with a username (Arabic or English, or their phone number) and a PIN.
// Arabic spelling variants are unified so "شوقى" and "شوقي" are the same login.
export const USERNAME_RE = /^[a-z0-9ء-ي._-]{2,30}$/;
export const normUsername = (u) => String(u || '').trim().toLowerCase()
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[ً-ٰٟـ]/g, '')
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
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(await compressImage(f, maxSide, quality, type)); } catch { resolve(null); }
    };
    input.click();
  });
}

// ───────────────────────── الخزن (safes) ─────────────────────────
// Every shop has these safes: the cashier drawer, the side drawer, the wallets it uses,
// and each active machine account. Every operation moves money from one safe to another
// (or in/out of the shop), so each safe has its own statement for the shift.

export const WALLETS = [
  { key: 'insta', label: 'انستاباي' },
  { key: 'vf', label: 'فودافون كاش' },
];
// A wallet either belongs to the owner (every transfer is recorded with a photo, no balance is
// received or handed over) or sits in the shop (opening and closing balance only, the accountant sees the difference).
export const WALLET_MODE = { owner: 'بتروح لصاحب المحل', shop: 'تبع المحل' };
export const walletModeOf = (shop, k) => (shop?.walletModes?.[k] === 'shop' ? 'shop' : 'owner');
export const walletModesOf = (shop) => Object.fromEntries(WALLETS.map((w) => [w.key, walletModeOf(shop, w.key)]));
export const machineKey = (m) => `m:${m.machine}|${m.account}`;
export const OWNER = 'out:owner';

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
    ...WALLETS.filter((w) => wallets.includes(w.key)).map((w) => ({ ...w, kind: 'wallet', mode: walletModeOf(shop, w.key), color: w.key === 'insta' ? '#A07CFF' : '#FF4D6D' })),
    ...(shop?.machines || []).map((m) => ({ key: machineKey(m), label: `${m.machine} · ${m.account}`, kind: 'machine', color: '#FFC800', m })),
  ];
}
export function safeLabel(key, shop) {
  if (key === OWNER) return 'صاحب المحل / المحفظة';
  if (key === 'out:expense') return 'مصروف';
  if (key === 'out:fees') return 'مصاريف تسييل';
  if (key === 'in:income') return 'إيراد';
  if (key === 'in:customer') return 'عميل';
  if (key === 'out:reg' || key === 'in:reg') return 'كاشير تاني';
  if (key === 'drawer') return 'درج الكاشير';
  if (key === 'side') return 'الدرج الجانبي';
  const w = WALLETS.find((x) => x.key === key);
  if (w) return w.label;
  if (String(key).startsWith('m:')) return String(key).slice(2).replace('|', ' · ');
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
    case 'topup': return [{ from: e.src, to: e.machineKey || firstAcc(e.machine), a }];
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
export function computeShift(shift, entries, shop, sales = null) {
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

  let income = 0, expenses = 0, transfers = 0, insta = 0, vf = 0, topups = 0, withdraws = 0, liquidations = 0, xferIn = 0, xferOut = 0, liqFees = 0;
  entries.forEach((e) => {
    const a = num(e.amount);
    if (e.type === 'expense') expenses += a;
    if (e.type === 'income') income += a;
    if (e.type === 'transfer') { transfers += a; if (e.wallet === 'insta') insta += a; if (e.wallet === 'vf') vf += a; }
    if (e.type === 'topup') topups += a;
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
    const fee = sales === null || !rate ? 0 : r2((Math.abs(sales) * rate) / (100 - rate));
    const affects = cfg.inCash !== false;
    // A card sale of 100 at 2% lands 98 on the machine: the POS counted 100, so the drawer
    // expects 100 less — 98 as the machine sale and 2 as the machine's fee.
    let effect = 0, feeEffect = 0;
    if (sales !== null && affects) {
      effect = -sales;
      feeEffect = sales > 0 ? -fee : fee;
      machineCash += effect + feeEffect;
      if (cfg.rateFrom === 'cashier') machineFees += feeEffect;
    }
    machines.push({ ...s, machine: cfg.machine || s.label.split(' · ')[0], account: cfg.account, close, sales, rate, fee, rateFrom: cfg.rateFrom, settle: settleOf(cfg), affects, effect: r2(effect), feeEffect: r2(feeEffect), total: r2(effect + feeEffect) });
    s.expected = close;
  });

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
      if (x.close !== null) { x.sales = r2(x.close - x.expected); walletCash -= x.sales; }
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
  const outCash = r2(expenses + topups + withdraws);
  return {
    safes, machines, machineGroups: groupMachines(machines), drawer, side, sales: salesN, hasSales, machineCash: r2(machineCash), machineFees: r2(machineFees), liqFees: r2(liqFees), walletCash: r2(walletCash), walletInfo,
    drawerDiff, sideDiff, diff,
    income, expenses, transfers, insta, vf, topups, withdraws, liquidations, xferIn, xferOut, recvCash, handCash, outCash,
    expected: drawer.expected === null ? null : r2(drawer.expected + side.expected),
  };
}

// Machines with several accounts (Fawry main + cash-out) shown as one total.
export function groupMachines(list) {
  const map = new Map();
  list.forEach((m) => {
    const k = m.machine || m.label;
    if (!map.has(k)) map.set(k, { machine: k, accounts: [], open: 0, close: 0, hasClose: true, sales: 0, hasSales: true, fee: 0, effect: 0, feeEffect: 0, rate: m.rate, rateFrom: m.rateFrom, settle: m.settle, affects: m.affects });
    const g = map.get(k);
    g.accounts.push(m);
    g.open = r2(g.open + num(m.open));
    if (m.close === null) g.hasClose = false; else g.close = r2(g.close + m.close);
    if (m.sales === null) g.hasSales = false; else g.sales = r2(g.sales + m.sales);
    g.fee = r2(g.fee + num(m.fee)); g.effect = r2(g.effect + num(m.effect)); g.feeEffect = r2(g.feeEffect + num(m.feeEffect));
  });
  return [...map.values()].map((g) => ({ ...g, close: g.hasClose ? g.close : null, sales: g.hasSales ? g.sales : null }));
}

function opLabel(e) {
  if (e.type === 'expense') return [e.kindLabel || 'مصروف', e.sub, e.note].filter(Boolean).join(' · ');
  if (e.type === 'income') return ['إيراد', e.reason].filter(Boolean).join(' · ');
  if (e.type === 'transfer') return 'تحويل من عميل';
  if (e.type === 'topup') return 'شحن رصيد';
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
