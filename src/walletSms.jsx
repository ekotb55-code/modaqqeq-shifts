import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { WalletMark } from './ui.jsx';
import { DEFAULT_FEE_TIERS, WALLETS, fmt, num, toDate, todayKey, walletModeOf, walletSmsTotals } from './lib';

// Messages of the shop's own wallets (like Vodafone Cash «تبع المحل»), recorded by themselves from the shop phone.
// Every message is in (customer sent money) or out (the wallet sent money). With the fee tiers we know
// how much of it was the sale / cash given and how much was the service fee.

export const feeTiersOf = (shop, w) => (shop?.walletFees?.[w] && shop.walletFees[w].length ? shop.walletFees[w] : DEFAULT_FEE_TIERS);

const dayKeys = (from, to) => {
  const out = [];
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  const end = new Date(to); end.setHours(12, 0, 0, 0);
  while (d <= end && out.length < 10) { out.push(todayKey(d)); d.setDate(d.getDate() + 1); }
  return out.length ? out : [todayKey(new Date(to))];
};

// The shift's messages, live. Returns { [wallet]: totals } for the shop's own wallets, and the fees to give computeShift.
export function useShiftWalletSms(shift, shop) {
  const [list, setList] = useState([]);
  const fromMs = toDate(shift?.openedAt || shift?.openedAtLocal)?.getTime() || 0;
  const endT = toDate(shift?.submittedAt || shift?.submittedAtLocal);
  const toMs = endT ? endT.getTime() + 60 * 1000 : null;
  const shopWallets = WALLETS.filter((w) => (shop?.wallets || []).includes(w.key) && walletModeOf(shop, w.key) === 'shop').map((w) => w.key);
  const days = fromMs ? dayKeys(fromMs, toMs || Date.now()).join(',') : '';
  useEffect(() => {
    if (!shift?.shopId || !fromMs || !shopWallets.length) { setList([]); return undefined; }
    return onSnapshot(query(collection(db, 'walletIn'), where('shopId', '==', shift.shopId), where('day', 'in', days.split(','))),
      (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.warn('walletSms', e.code));
  }, [shift?.shopId, fromMs, days, shopWallets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = {};
  const fees = {};
  shopWallets.forEach((w) => {
    const mine = list.filter((x) => x.wallet === w && x.dir && (x.atMs || 0) >= fromMs && (!toMs || (x.atMs || 0) <= toMs))
      .map((x) => ({ ...x, ignored: x.status === 'ignored' }));
    const t = walletSmsTotals(mine, feeTiersOf(shop, w));
    t.wallet = w;
    t.label = WALLETS.find((x) => x.key === w)?.label || w;
    out[w] = t;
    if (t.fees) fees[w] = t.fees;
  });
  return { byWallet: out, fees, any: Object.values(out).some((t) => t.rows.length) };
}

const timeOf = (x) => x.smsTime || new Date(x.atMs || Date.now()).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });

function Rows({ t, canIgnore }) {
  const [all, setAll] = useState(false);
  const rows = t.rows.slice().reverse();
  const shown = all ? rows : rows.slice(0, 8);
  const toggle = (x) => updateDoc(doc(db, 'walletIn', x.id), { status: x.ignored ? 'auto' : 'ignored' }).catch(() => {});
  return (
    <div className="stack" style={{ gap: 0 }}>
      {shown.map((x) => (
        <div key={x.id} className="list-row" style={{ gap: 10, opacity: x.ignored ? 0.45 : 1 }}>
          <span className={'badge ' + (x.dir === 'out' ? 'bad' : 'ok')} style={{ minWidth: 54, justifyContent: 'center' }}>{x.dir === 'out' ? 'طالع' : 'داخل'}</span>
          <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{fmt(x.amount)} ج <span className="tiny muted" style={{ fontWeight: 500 }}>· {x.dir === 'out' ? `العميل دفع ${fmt(x.base + x.fee)} كاش` : `بيع/كاش ${fmt(x.base)}`}{x.fee ? ` + خدمة ${fmt(x.fee)}` : ''}</span></strong>
            <span className="tiny muted">{timeOf(x)}{x.fromName ? ` · ${x.fromName}` : ''}{x.fromPhone ? ` · ${x.fromPhone}` : ''}{x.balance !== null && x.balance !== undefined ? ` · الرصيد بعدها ${fmt(x.balance)}` : ''}</span>
          </span>
          {canIgnore && <button type="button" className="btn sm soft" style={{ height: 36 }} onClick={() => toggle(x)} title={x.ignored ? 'رجّعها للحساب' : 'مش عملية بيع/كاش (مثلًا إيداع من صاحب المحل)'}>{x.ignored ? 'رجّعها' : 'استبعد'}</button>}
        </div>
      ))}
      {rows.length > 8 && <button type="button" className="link" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setAll(!all)}>{all ? 'اعرض أقل' : `اعرض الكل (${rows.length})`}</button>}
    </div>
  );
}

function Totals({ t, open }) {
  const expectNow = open !== null && open !== undefined ? Math.round((num(open) + t.inTotal - t.outTotal) * 100) / 100 : null;
  const box = (label, v, sub, bg) => (
    <div className="stack" style={{ flex: '1 1 140px', background: bg, borderRadius: 18, padding: '10px 14px', gap: 2 }}>
      <span className="tiny" style={{ fontWeight: 700 }}>{label}</span>
      <strong style={{ fontSize: 20 }}>{v}</strong>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {box('الرصيد دلوقتي', t.lastBalance === null ? '—' : `${fmt(t.lastBalance)} ج`, t.lastBalance === null ? 'الرسالة مفيهاش رصيد' : 'من آخر رسالة', '#F3E8FF')}
      {box(`داخل · ${t.inCount}`, `${fmt(t.inTotal)} ج`, `بيع/كاش ${fmt(t.inBase)} · الدرج طلع منه`, '#EAFBC2')}
      {box(`طالع · ${t.outCount}`, `${fmt(t.outTotal)} ج`, `العميل دفع كاش ${fmt(t.outBase + t.outFees)}`, '#FFE9DC')}
      {box('مقابل الخدمة', `${fmt(t.fees)} ج`, 'مكسب المحل · فضل في الدرج', '#E4F4FF')}
      {expectNow !== null && box('المحفظة المفروض فيها', `${fmt(expectNow)} ج`, 'استلام + داخل − طالع', '#FFF6C9')}
    </div>
  );
}

// Cashier dashboard: what moved on the shop wallets in this shift, and the balance now.
export function WalletSmsCard({ shift, shop }) {
  const { byWallet } = useShiftWalletSms(shift, shop);
  const list = Object.values(byWallet).filter((t) => t.rows.length);
  if (!list.length) return null;
  return list.map((t) => (
    <section key={t.wallet} className="card" style={{ gap: 12 }}>
      <h2 className="h2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><WalletMark k={t.wallet} size={34} />{t.label} · من رسايل المحفظة</h2>
      <span className="tiny muted" style={{ lineHeight: 1.7 }}>كل رسالة بتتسجل لوحدها. «داخل» يعني العميل حوّل للمحفظة والكاشير باع أو ادّاله كاش، و«طالع» يعني المحفظة حوّلت والعميل دفع كاش.</span>
      <Totals t={t} open={shift.receive?.wallets?.[t.wallet]} />
      <Rows t={t} />
    </section>
  ));
}

// Accountant: same, plus the typed closing balance and «استبعد» for messages that aren't customer operations.
export function WalletSmsReview({ shift, shop, data, canEdit }) {
  const list = Object.values(data.byWallet).filter((t) => t.rows.length);
  if (!list.length) return null;
  return list.map((t) => {
    const typed = shift.handover?.walletsTyped?.[t.wallet];
    const gap = typed !== undefined && typed !== null && t.lastBalance !== null ? Math.round((num(typed) - t.lastBalance) * 100) / 100 : null;
    return (
      <section key={t.wallet} className="card" style={{ gap: 12 }}>
        <h2 className="h2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><WalletMark k={t.wallet} size={34} />{t.label} · رسايل المحفظة في الوردية</h2>
        <Totals t={t} open={shift.receive?.wallets?.[t.wallet]} />
        {gap !== null && (
          <span className={'badge ' + (Math.abs(gap) < 0.01 ? 'ok' : 'warn')} style={{ alignSelf: 'flex-start' }}>
            {Math.abs(gap) < 0.01 ? `✓ الكاشير كتب ${fmt(typed)} زي آخر رصيد في الرسايل` : `الكاشير كتب ${fmt(typed)} وآخر رصيد في الرسايل ${fmt(t.lastBalance)} · فرق ${fmt(gap)}`}
          </span>
        )}
        <span className="tiny muted" style={{ lineHeight: 1.7 }}>مقابل الخدمة ({fmt(t.fees)} ج) اتحسب للدرج في كشف الخزنة. لو رسالة مش عملية عميل (زي إيداع من صاحب المحل) دوس «استبعد».</span>
        <Rows t={t} canIgnore={canEdit} />
      </section>
    );
  });
}
