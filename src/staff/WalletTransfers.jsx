import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { WalletMark, useToast } from '../ui.jsx';
import { SRC_LABEL, fmt, todayKey, walletModeOf } from '../lib';
import { logAct } from '../activity.js';
import { pushEvent } from '../cloud.js';
import { CLAIM_WINDOW } from '../cashier/WalletIn.jsx';

// Bank transfers to the owner's wallet (InstaPay…), for the owner and the accountant:
//  · bigger than the shop's limit → they decide: send it to the cashiers, or «شخصي»;
//  · shown to the cashiers now → can still be marked «شخصي»;
//  · confirmed by a cashier (with the sale invoice number) → «مش بتاع المحل» refuses it: it no longer counts
//    for the cashier, so the drawer must have that money.

const lastDays = (n) => Array.from({ length: n }, (_, i) => todayKey(new Date(Date.now() - i * 86400000)));

export default function WalletTransfers({ shops, profile }) {
  const toast = useToast();
  const owned = shops.filter((s) => (s.wallets || []).some((w) => walletModeOf(s, w) === 'owner'));
  const [map, setMap] = useState({});
  const [days, setDays] = useState(3);
  const key = owned.map((s) => s.id).join(',') + '|' + days;
  useEffect(() => {
    const subs = owned.map((s) => onSnapshot(query(collection(db, 'walletIn'), where('shopId', '==', s.id), where('day', 'in', lastDays(days))),
      (q) => setMap((m) => ({ ...m, [s.id]: q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status !== 'auto' && x.dir !== 'out') })),
      (e) => console.warn('walletIn', e.code)));
    return () => subs.forEach((u) => u());
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same transfer can be in several branches (one link for many branches): show it once.
  const all = Object.values(map).flat();
  const byGroup = new Map();
  all.forEach((x) => { const g = x.group || x.id; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(x); });
  const items = [...byGroup.values()].map((copies) => {
    const claimed = copies.find((c) => c.status === 'claimed' || c.status === 'rejected');
    const main = claimed || copies[0];
    return { ...main, copies, shopNames: copies.map((c) => shops.find((s) => s.id === c.shopId)?.name).filter(Boolean) };
  }).sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  const now = Date.now();
  const big = items.filter((x) => x.status === 'big');
  const live = items.filter((x) => x.status === 'new' && (x.releasedAtMs || x.atMs || 0) > now - CLAIM_WINDOW);
  const claimed = items.filter((x) => x.status === 'claimed');
  const done = items.filter((x) => ['rejected', 'personal', 'expired'].includes(x.status) || (x.status === 'new' && (x.releasedAtMs || x.atMs || 0) <= now - CLAIM_WINDOW));

  const setAll = async (x, patch, what) => {
    const b = writeBatch(db);
    x.copies.forEach((c) => b.update(doc(db, 'walletIn', c.id), { ...patch, decidedBy: profile.id, decidedByName: profile.name, decidedAtMs: Date.now() }));
    try { await b.commit(); logAct('sms_decide', `${what} · تحويل ${fmt(x.amount)} ج من ${x.fromName || 'عميل'}`, { shopId: x.shopId }); toast('اتعمل ✓'); }
    catch (e) { console.error(e); toast('مش قادرين نحفظ', 'err'); }
  };
  const release = (x) => setAll(x, { status: 'new', releasedAtMs: Date.now() }, 'بعته للكاشيرية');
  const personal = (x) => setAll(x, { status: 'personal' }, 'علّم عليه شخصي');
  const refuse = async (x) => {
    if (!window.confirm(`ترفض تحويل ${fmt(x.amount)} ج اللي ${x.claimedByName || 'الكاشير'} أكّده؟\nهيتشال من حسابه، والدرج المفروض يبقى فيه المبلغ ده.`)) return;
    const b = writeBatch(db);
    b.update(doc(db, 'walletIn', x.id), { status: 'rejected', decidedBy: profile.id, decidedByName: profile.name, decidedAtMs: Date.now() });
    if (x.claimedShiftId && x.claimedEntryId) b.update(doc(db, 'shifts', x.claimedShiftId, 'entries', x.claimedEntryId), { smsRejected: true, smsRejectedBy: profile.name, smsRejectedAt: Date.now() });
    try {
      await b.commit();
      logAct('sms_refuse', `رفض تحويل ${fmt(x.amount)} ج اللي ${x.claimedByName} أكّده (فاتورة ${x.claimInvoice || '—'})`, { shopId: x.shopId, shiftId: x.claimedShiftId });
      pushEvent({ type: 'sms_refused', shopId: x.shopId, shiftId: x.claimedShiftId, to: 'staff', title: `❌ ${profile.name} رفض تحويل ${fmt(x.amount)} ج`, body: `اللي ${x.claimedByName} أكّده · المبلغ ده بقى على الكاشير` });
      toast('اترفض · المبلغ بقى على الكاشير');
    } catch (e) { console.error(e); toast('مش قادرين نحفظ', 'err'); }
  };

  if (!owned.length) return <div className="wrap"><div className="card empty">مفيش محافظ «بتروح لصاحب المحل» في المحلات دي</div></div>;
  const when = (ms) => new Date(ms).toLocaleString('ar-EG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const Row = ({ x, children, note }) => (
    <div className="list-row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <WalletMark k={x.wallet} size={36} />
      <span className="stack" style={{ gap: 1, flex: '1 1 220px', minWidth: 0 }}>
        <strong style={{ fontSize: 15 }}>{fmt(x.amount)} ج · {x.fromName || 'عميل'}{x.fromPhone ? <span className="tiny muted" style={{ fontWeight: 500 }}> · {x.fromPhone}</span> : null}</strong>
        <span className="tiny muted">{SRC_LABEL[x.wallet] || ''} · {when(x.atMs)}{x.shopNames.length ? ` · ${x.shopNames.join('، ')}` : ''}</span>
        {note}
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</span>
    </div>
  );
  const Sec = ({ title, hint, list, empty, children }) => (
    <section className="card" style={{ gap: 6 }}>
      <h2 className="h2">{title} <span className="tiny muted" style={{ fontWeight: 500 }}>· {list.length}{hint ? ` · ${hint}` : ''}</span></h2>
      {list.length ? children : <span className="tiny muted">{empty}</span>}
    </section>
  );
  return (
    <div className="wrap stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="title" style={{ fontSize: 28 }}>التحويلات</h1>
        <span className="small muted">تحويلات انستاباي اللي وصلت لصاحب المحل، ومين أكّدها من الكاشيرية</span>
      </div>
      <Sec title="⚠️ مستنية قرارك" hint="أكبر من الحد · مش ظاهرة للكاشير" list={big} empty="مفيش">
        {big.map((x) => (
          <Row key={x.id} x={x}>
            <button type="button" className="btn sm" onClick={() => release(x)}>ابعته للكاشير</button>
            <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => personal(x)}>شخصي</button>
          </Row>
        ))}
      </Sec>
      <Sec title="✋ اتأكّدت من الكاشيرية" hint="طابقها بالفاتورة على البرنامج" list={claimed} empty="مفيش">
        {claimed.map((x) => (
          <Row key={x.id} x={x} note={<span className="small" style={{ fontWeight: 700 }}>أكّده {x.claimedByName} · فاتورة رقم <b dir="ltr">{x.claimInvoice || '—'}</b> · {when(x.claimedAtMs)}</span>}>
            <button type="button" className="btn sm soft" style={{ height: 44, color: '#C62828' }} onClick={() => refuse(x)}>مش بتاع المحل</button>
          </Row>
        ))}
      </Sec>
      <Sec title="⏳ ظاهرة للكاشير دلوقتي" hint="بتختفي بعد ساعة" list={live} empty="مفيش">
        {live.map((x) => (
          <Row key={x.id} x={x}>
            <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => personal(x)}>شخصي</button>
          </Row>
        ))}
      </Sec>
      <section className="card" style={{ gap: 6 }}>
        <details>
          <summary className="h2" style={{ cursor: 'pointer' }}>اللي خلص <span className="tiny muted" style={{ fontWeight: 500 }}>· {done.length} · مرفوض / شخصي / عدّى وقته</span></summary>
          {done.map((x) => (
            <Row key={x.id} x={x} note={<span className="tiny" style={{ fontWeight: 700 }}>{x.status === 'rejected' ? `❌ اترفض${x.decidedByName ? ` من ${x.decidedByName}` : ''} · كان أكّده ${x.claimedByName || ''}` : x.status === 'personal' ? `شخصي${x.decidedByName ? ` · ${x.decidedByName}` : ''}` : 'عدّى الساعة ومحدش أكّده'}</span>}>
              {x.status === 'personal' && <button type="button" className="btn sm soft" style={{ height: 40 }} onClick={() => release(x)}>ابعته للكاشير</button>}
              {(x.status === 'expired' || x.status === 'new') && <button type="button" className="btn sm soft" style={{ height: 40 }} onClick={() => release(x)}>اظهره للكاشير ساعة كمان</button>}
            </Row>
          ))}
        </details>
        <div className="chips" style={{ marginTop: 6 }}>
          {[3, 7].map((n) => <button key={n} type="button" className={'chip sm' + (days === n ? ' on' : '')} onClick={() => setDays(n)}>آخر {n} أيام</button>)}
        </div>
      </section>
    </div>
  );
}
