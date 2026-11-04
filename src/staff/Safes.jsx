import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar } from '../ui.jsx';
import { MAIN_REG, WALLETS, lastOf, openOf, registersOf, shopForRegister, computeShift, dateStr, diffText, fmt, liveBalances, machineKey, num, timeStr, todayKey, toDate } from '../lib';
import Statements from './Statements.jsx';

function useEntries(shiftId) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!shiftId) { setList([]); return undefined; }
    return onSnapshot(query(collection(db, 'shifts', shiftId, 'entries'), orderBy('createdAt', 'asc')), (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.deleted)), () => {});
  }, [shiftId]);
  return list;
}

export default function Safes({ shops }) {
  const [shopId, setShopId] = useState(null);
  const shop = shops.find((s) => s.id === shopId) || shops[0];
  if (!shop) return <div className="wrap"><div className="card empty">لسه مفيش محلات</div></div>;
  return (
    <div className="wrap">
      <div className="spread">
        <h1 className="title">الخزن</h1>
        <div className="chips">{shops.map((s) => <button key={s.id} type="button" className={'chip' + (s.id === shop.id ? ' on' : '')} onClick={() => setShopId(s.id)}>{s.name}</button>)}</div>
      </div>
      <ShopSafes key={shop.id} shop={shop} />
    </div>
  );
}

function RegBalances({ shop: fullShop, reg, title }) {
  const shop = shopForRegister(fullShop, reg);
  const [openShift, setOpenShift] = useState(null);
  const openId = openOf(fullShop, reg)?.id || null;
  useEffect(() => {
    if (!openId) { setOpenShift(null); return undefined; }
    return onSnapshot(doc(db, 'shifts', openId), (s) => setOpenShift(s.exists() ? { id: s.id, ...s.data() } : null), () => {});
  }, [openId]);
  const openEntries = useEntries(openId);
  const lh = lastOf(fullShop, reg);

  const balances = useMemo(() => {
    if (openShift) return { from: `لايف · وردية ${openShift.cashierName} المفتوحة`, b: liveBalances(openShift, openEntries, shop) };
    if (!lh) return { from: 'لسه مفيش ورديات', b: {} };
    const b = { side: num(lh.side), drawer: num(lh.drawerTotal) };
    WALLETS.forEach((w) => { b[w.key] = num(lh.wallets?.[w.key]); });
    (lh.machines || []).forEach((m) => { b[machineKey(m)] = num(m.value); });
    return { from: `آخر تسليم · ${lh.cashierName} ${timeStr(lh.at)}`, b };
  }, [openShift, openEntries, shop, lh]);

  const wallets = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key));
  const tiles = [
    ...(reg !== MAIN_REG && !openShift ? [{ key: 'drawer', label: 'الدرج', cls: 'c-orange' }] : []),
    ...(shop.noSide ? [] : [{ key: 'side', label: 'الدرج الجانبي', cls: 'c-lime' }]),
    ...wallets.map((w) => ({ key: w.key, label: w.label, cls: w.key === 'insta' ? 'c-violet' : 'c-pink' })),
    ...(shop.machines || []).map((m) => ({ key: machineKey(m), label: `${m.machine} · ${m.account}`, cls: 'c-yellow' })),
  ];
  if (!tiles.length) return null;
  return (
    <section className="card">
      <div className="spread"><h2 className="h2">{title}</h2><span className="tiny muted">{balances.from}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.key} className={'counter ' + t.cls}>
            <span className="small muted">{t.label}</span>
            <span className="v">{balances.b[t.key] === undefined || balances.b[t.key] === null ? '—' : fmt(balances.b[t.key])}<span className="small muted" style={{ fontWeight: 500 }}> ج</span></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShopSafes({ shop }) {
  const [pub, setPub] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [sel, setSel] = useState(null);
  const month = todayKey().slice(0, 7);

  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shop.id), (s) => setPub(s.data() || {}), () => {}), [shop.id]);
  useEffect(() => onSnapshot(query(collection(db, 'shifts'), where('shopId', '==', shop.id), where('month', '==', month)),
    (q) => setShifts(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}), [shop.id, month]);
  const cashiers = (pub?.cashiers || []).filter((c) => !c.disabled).map((c) => ({ ...c, photo: pub?.photos?.[c.uid] || c.photo }));
  const lastShiftOf = (uid) => shifts.filter((s) => s.cashierUid === uid).sort((a, b) => toDate(b.openedAt || b.openedAtLocal) - toDate(a.openedAt || a.openedAtLocal))[0];
  const selShift = shifts.find((s) => s.id === sel) || null;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <RegBalances shop={shop} reg={MAIN_REG} title={registersOf(shop).length ? 'أرصدة الخزن · الكاشير الأساسي' : 'أرصدة الخزن دلوقتي'} />
      {registersOf(shop).map((r) => <RegBalances key={r.id} shop={shop} reg={r.id} title={`أرصدة ${r.name}`} />)}

      <section className="card">
        <h2 className="h2">خزن الكاشيرية <span className="tiny muted" style={{ fontWeight: 500 }}>· دوس على الكاشير تشوف كشف خزنته</span></h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
          {cashiers.map((c) => {
            const last = lastShiftOf(c.uid);
            const isOpen = last?.status === 'open';
            const status = !last ? 'لسه ما اشتغلش الشهر ده' : isOpen ? 'شغّال دلوقتي' : last.status === 'closed' ? diffText(last.diff ?? 0) : 'مستني مراجعة';
            const cls = !last ? '' : isOpen ? 'info' : last.status === 'closed' ? (num(last.diff) < 0 ? 'bad' : num(last.diff) > 0 ? 'ok' : 'info') : 'warn';
            return (
              <button key={c.uid} type="button" className={'q-item' + (last && sel === last.id ? ' on' : '')} onClick={() => last && setSel(last.id)} disabled={!last} style={{ opacity: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={c.name} photo={c.photo} color={c.color} size={46} />
                  <span className="stack" style={{ gap: 2 }}>
                    <strong>خزنة {c.name}</strong>{last?.registerName && last.register !== 'main' && <span className="tiny muted">{last.registerName}</span>}
                    <span className={'badge ' + cls}>{status}</span>
                  </span>
                </span>
                {last && <span className="tiny muted">{dateStr(last.openedAt || last.openedAtLocal)} · {timeStr(last.openedAt || last.openedAtLocal)}{last.submittedAt ? ` ← ${timeStr(last.submittedAt)}` : ''}</span>}
              </button>
            );
          })}
          {cashiers.length === 0 && <span className="muted small">مفيش كاشيرية</span>}
        </div>
      </section>

      {selShift && <CashierStatement key={selShift.id} shift={selShift} shop={shop} />}
    </div>
  );
}

function CashierStatement({ shift, shop }) {
  const entries = useEntries(shift.id);
  const [sales, setSales] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'reviews', shift.id), (s) => setSales(s.exists() ? s.data().sales ?? null : null), () => {}), [shift.id]);
  const rshop = shopForRegister(shop, shift.register);
  const c = computeShift(shift, entries, rshop, sales);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h2 className="h2">كشف وردية {shift.cashierName} · {dateStr(shift.openedAt || shift.openedAtLocal)}</h2>
      <Statements c={c} shift={shift} shop={rshop} />
    </div>
  );
}
