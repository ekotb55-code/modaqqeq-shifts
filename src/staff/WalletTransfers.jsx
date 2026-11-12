import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { WalletMark, useToast } from '../ui.jsx';
import { fmt, todayKey, walletModeOf } from '../lib';
import { logAct } from '../activity.js';
import { pushEvent } from '../cloud.js';
import { windowOf } from '../cashier/WalletIn.jsx';

// Bank transfers to the owner's wallet (InstaPay…), for the owner and the accountant. Newest on top:
//  · «وصلت دلوقتي»: shown to the cashiers now → can be marked «شخصي»;
//  · «مستنية قرارك»: bigger than the shop's limit → send it to the cashiers, or «شخصي»;
//  · «أكّدها الكاشير» (with the sale invoice number) → «✓ تبع المحل» (done) or «✗ مش بتاع المحل» (refused:
//    it no longer counts for the cashier, so the drawer must have that money);
//  · «اللي خلص»: every decision can be taken back («رجّعه»), and right after a tap there's «تراجع» on the toast.

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
    const claimed = copies.find((c) => ['claimed', 'rejected', 'approved'].includes(c.status));
    const main = claimed || copies[0];
    return { ...main, copies, shopNames: copies.map((c) => shops.find((s) => s.id === c.shopId)?.name).filter(Boolean) };
  });
  const now = Date.now();
  const newest = (k) => (a, b) => (b[k] || b.atMs || 0) - (a[k] || a.atMs || 0);
  const isLive = (x) => x.status === 'new' && (x.releasedAtMs || x.atMs || 0) > now - windowOf(x);
  const live = items.filter(isLive).sort(newest('releasedAtMs'));
  const big = items.filter((x) => x.status === 'big').sort(newest('atMs'));
  const claimed = items.filter((x) => x.status === 'claimed').sort(newest('claimedAtMs'));
  const done = items.filter((x) => ['approved', 'rejected', 'personal', 'expired'].includes(x.status) || (x.status === 'new' && !isLive(x))).sort(newest('decidedAtMs'));

  const stamp = () => ({ decidedBy: profile.id, decidedByName: profile.name, decidedAtMs: Date.now() });
  const commit = async (b, msg, undo) => {
    try { await b.commit(); toast(msg, 'ok', undo ? { undo } : {}); return true; }
    catch (e) { console.error(e); toast('مش قادرين نحفظ', 'err'); return false; }
  };
  const label = (x) => `تحويل ${fmt(x.amount)} ج من ${x.fromName || 'عميل'}`;
  // every copy (branch) of the transfer gets the same status
  const setAll = async (x, patch, what, undoPatch) => {
    const b = writeBatch(db);
    x.copies.forEach((c) => b.update(doc(db, 'walletIn', c.id), { ...patch, ...stamp() }));
    const ok = await commit(b, what, undoPatch ? () => setAll(x, undoPatch, 'رجع زي ما كان') : null);
    if (ok) logAct('sms_decide', `${what} · ${label(x)}`, { shopId: x.shopId });
  };
  const release = (x) => setAll(x, { status: 'new', releasedAtMs: Date.now() }, 'اتبعت للكاشيرية', { status: x.status });
  const personal = (x) => setAll(x, { status: 'personal' }, 'اتعلّم شخصي', { status: x.status });
  // only the copy the cashier confirmed (the other branches' copies stay as they are)
  const setOne = async (x, status, what, undoStatus) => {
    const b = writeBatch(db);
    b.update(doc(db, 'walletIn', x.id), { status, ...stamp() });
    const ok = await commit(b, what, undoStatus ? () => setOne(x, undoStatus, 'رجع زي ما كان') : null);
    if (ok) logAct('sms_decide', `${what} · ${label(x)}`, { shopId: x.shopId });
  };
  const approve = (x) => setOne(x, 'approved', 'اتعلّم تبع المحل', 'claimed');

  const entryRef = (x) => (x.claimedShiftId && x.claimedEntryId ? doc(db, 'shifts', x.claimedShiftId, 'entries', x.claimedEntryId) : null);
  const unrefuse = async (x) => {
    const b = writeBatch(db);
    b.update(doc(db, 'walletIn', x.id), { status: 'claimed', ...stamp() });
    const er = entryRef(x);
    if (er) b.update(er, { smsRejected: false, smsRejectedBy: profile.name, smsRejectedAt: Date.now() });
    if (await commit(b, 'رجع زي ما كان · المبلغ رجع في حساب الكاشير')) logAct('sms_unrefuse', `رجّع ${label(x)} اللي كان رفضه`, { shopId: x.shopId, shiftId: x.claimedShiftId });
  };
  const refuse = async (x) => {
    const b = writeBatch(db);
    b.update(doc(db, 'walletIn', x.id), { status: 'rejected', ...stamp() });
    const er = entryRef(x);
    if (er) b.update(er, { smsRejected: true, smsRejectedBy: profile.name, smsRejectedAt: Date.now() });
    if (!(await commit(b, 'اترفض · المبلغ بقى على الكاشير', () => unrefuse(x)))) return;
    logAct('sms_refuse', `رفض ${label(x)} اللي ${x.claimedByName} أكّده (فاتورة ${x.claimInvoice || '—'})`, { shopId: x.shopId, shiftId: x.claimedShiftId });
    pushEvent({ type: 'sms_refused', shopId: x.shopId, shiftId: x.claimedShiftId, to: 'staff', title: `❌ ${profile.name} رفض تحويل ${fmt(x.amount)} ج`, body: `اللي ${x.claimedByName} أكّده · المبلغ ده بقى على الكاشير` });
  };

  if (!owned.length) return <div className="wrap"><div className="card empty">مفيش محافظ «بتروح لصاحب المحل» في المحلات دي</div></div>;
  const when = (ms) => (ms ? new Date(ms).toLocaleString('ar-EG', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const branches = (x) => (x.shopNames.length && shops.length > 1 ? ` · ${x.shopNames.join('، ')}` : '');
  const Row = ({ x, sub, children }) => (
    <div className={'wt-row' + (now - (x.releasedAtMs || x.atMs || 0) < 120000 ? ' wt-new' : '')}>
      <WalletMark k={x.wallet} size={32} />
      <span className="wt-main">
        <span className="wt-top">{fmt(x.amount)} ج · {x.fromName || 'عميل'}</span>
        <span className="wt-sub">{sub}</span>
      </span>
      <span className="wt-btns">{children}</span>
    </div>
  );
  const Sec = ({ title, hint, list, children }) => (list.length ? (
    <section className="card" style={{ gap: 0, paddingBlock: 14 }}>
      <h2 className="h2" style={{ fontSize: 17, marginBottom: 4 }}>{title} <span className="tiny muted" style={{ fontWeight: 500 }}>· {list.length}{hint ? ` · ${hint}` : ''}</span></h2>
      {children}
    </section>
  ) : null);
  const doneText = (x) => (x.status === 'approved' ? `✓ تبع المحل${x.decidedByName ? ` · ${x.decidedByName}` : ''} · أكّده ${x.claimedByName || ''}`
    : x.status === 'rejected' ? `❌ اترفض${x.decidedByName ? ` · ${x.decidedByName}` : ''} · كان أكّده ${x.claimedByName || ''}`
      : x.status === 'personal' ? `شخصي${x.decidedByName ? ` · ${x.decidedByName}` : ''}` : 'عدّى وقته ومحدش أكّده');
  const nothing = !live.length && !big.length && !claimed.length;
  return (
    <div className="wrap stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="title" style={{ fontSize: 28 }}>التحويلات</h1>
        <span className="small muted">تحويلات انستاباي اللي وصلت لصاحب المحل، ومين أكّدها من الكاشيرية</span>
      </div>
      {nothing && <section className="card empty">مفيش تحويلات مستنية حاجة دلوقتي ✓</section>}
      <Sec title="⏳ وصلت دلوقتي" hint="ظاهرة للكاشيرية" list={live}>
        {live.map((x) => (
          <Row key={x.id} x={x} sub={`${when(x.releasedAtMs || x.atMs)}${branches(x)}${x.fromPhone ? ` · ${x.fromPhone}` : ''}`}>
            {x.allowPersonal !== false && <button type="button" className="wt-btn" onClick={() => personal(x)}>شخصي</button>}
          </Row>
        ))}
      </Sec>
      <Sec title="⚠️ مستنية قرارك" hint="أكبر من الحد · مش ظاهرة للكاشير" list={big}>
        {big.map((x) => (
          <Row key={x.id} x={x} sub={`${when(x.atMs)}${branches(x)}`}>
            <button type="button" className="wt-btn ok" onClick={() => release(x)}>ابعته للكاشير</button>
            {x.allowPersonal !== false && <button type="button" className="wt-btn" onClick={() => personal(x)}>شخصي</button>}
          </Row>
        ))}
      </Sec>
      <Sec title="✋ أكّدها الكاشير" hint="طابقها بالفاتورة على البرنامج" list={claimed}>
        {claimed.map((x) => (
          <Row key={x.id} x={x} sub={<>{x.claimedByName} · فاتورة <b dir="ltr">{x.claimInvoice || '—'}</b> · {when(x.claimedAtMs)}{branches(x)}</>}>
            <button type="button" className="wt-btn ok" onClick={() => approve(x)} aria-label="تبع المحل">✓ تبع المحل</button>
            <button type="button" className="wt-btn no" onClick={() => refuse(x)} aria-label="مش بتاع المحل">✗ مش بتاعه</button>
          </Row>
        ))}
      </Sec>
      <section className="card" style={{ gap: 6, paddingBlock: 14 }}>
        <details>
          <summary className="h2" style={{ cursor: 'pointer', fontSize: 17 }}>اللي خلص <span className="tiny muted" style={{ fontWeight: 500 }}>· {done.length} · تبع المحل / مرفوض / شخصي / عدّى وقته</span></summary>
          {done.map((x) => (
            <Row key={x.id} x={x} sub={`${doneText(x)} · ${when(x.decidedAtMs || x.atMs)}`}>
              {x.status === 'approved' && <button type="button" className="wt-btn" onClick={() => setOne(x, 'claimed', 'رجع لـ«أكّدها الكاشير»')}>رجّعه</button>}
              {x.status === 'rejected' && <button type="button" className="wt-btn" onClick={() => unrefuse(x)}>رجّعه</button>}
              {x.status === 'personal' && <button type="button" className="wt-btn" onClick={() => release(x)}>ابعته للكاشير</button>}
              {(x.status === 'expired' || x.status === 'new') && <button type="button" className="wt-btn" onClick={() => release(x)}>اظهره تاني</button>}
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
