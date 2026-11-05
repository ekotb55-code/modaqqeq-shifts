import { useTour } from '../Tour.jsx';
import { STAFF_DETAIL, STAFF_REVIEWING } from '../tours.js';
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, CopyBtn, Icon, Modal, PhotoView, ZoomImage, useToast } from '../ui.jsx';
import { BILL_BG, FACES, SRC_LABEL, WALLETS, shopForRegister, computeShift, diffText, durationStr, fmt, minutesBetween, num, safeLabel, timeStr, toDate, dateStr } from '../lib';
import Statements from './Statements.jsx';
import ShiftChat from '../ShiftChat.jsx';
import { DeletedList, entryTitle } from '../cashier/Dash.jsx';

const STATUS = {
  open: { label: 'شغالة', cls: 'info' },
  submitted: { label: 'جديدة', cls: 'warn' },
  reviewing: { label: 'بتتراجع', cls: 'dark' },
  reopened: { label: 'مفتوحة للكاشير يعدّل', cls: 'info' },
  closed: { label: 'اتقفلت', cls: 'ok' },
};

export function useShopShifts(shops, statuses) {
  const [list, setList] = useState([]);
  const key = shops.map((s) => s.id).join(',') + '|' + statuses.join(',');
  useEffect(() => {
    const map = {};
    const subs = shops.map((s) => onSnapshot(
      query(collection(db, 'shifts'), where('shopId', '==', s.id), where('status', 'in', statuses)),
      (q) => { map[s.id] = q.docs.map((d) => ({ id: d.id, ...d.data() })); setList(Object.values(map).flat()); },
      (e) => console.warn('shifts', e.code),
    ));
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list;
}

export default function Review({ profile, shops }) {
  const pending = useShopShifts(shops, ['open', 'submitted', 'reviewing', 'reopened']);
  const [selId, setSelId] = useState(null);
  const shopName = (id) => shops.find((s) => s.id === id)?.name || '';
  const sorted = useMemo(() => {
    const rank = { reviewing: 0, submitted: 1, open: 2 };
    return [...pending].sort((a, b) => rank[a.status] - rank[b.status] || (toDate(a.submittedAt || a.openedAt) - toDate(b.submittedAt || b.openedAt)));
  }, [pending]);
  const sel = sorted.find((s) => s.id === selId) || null;

  return (
    <div className="wrap">
      <div className="row">
        <aside className="side" style={{ flex: '1 1 300px', maxWidth: 420 }} data-tour="queue">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>الورديات <span className="muted" style={{ fontWeight: 500 }}>· {sorted.length}</span></h2>
          {shops.length === 0 && <div className="card empty">لسه مفيش محلات مربوطة بحسابك</div>}
          {shops.length > 0 && sorted.length === 0 && <div className="card empty">مفيش ورديات مستنية مراجعة</div>}
          {sorted.map((s) => {
            const late = s.status === 'submitted' && minutesBetween(s.submittedAt, new Date()) > 60;
            const st = late ? { label: `متأخرة ${durationStr(s.submittedAt)}`, cls: 'bad' } : STATUS[s.status] || STATUS.submitted;
            return (
              <button key={s.id} type="button" className={'q-item' + (selId === s.id ? ' on' : '')} onClick={() => setSelId(s.id)}>
                <span className="spread"><strong>{shopName(s.shopId)}</strong><span className={'badge ' + st.cls}>{st.label}</span></span>
                <span className="small muted">{s.cashierName}{s.registerName && s.register !== 'main' ? ` · ${s.registerName}` : ''} · من {timeStr(s.openedAt || s.openedAtLocal)}{s.submittedAt ? ` لـ ${timeStr(s.submittedAt)}` : ''}</span>
                <span className="tiny muted">{dateStr(s.openedAt || s.openedAtLocal)}</span>
              </button>
            );
          })}
        </aside>
        <div className="grow">
          {sel ? <ShiftDetail key={sel.id} shift={sel} shop={shops.find((x) => x.id === sel.shopId)} profile={profile} canReview /> : <div className="card empty" style={{ minHeight: 300, justifyContent: 'center' }}>اختار وردية من القايمة علشان تراجعها</div>}
        </div>
      </div>
    </div>
  );
}

export function ShiftDetail({ shift, shop: fullShop, profile, canReview }) {
  const shop = shopForRegister(fullShop, shift.register);
  const toast = useToast();
  const [allEntries, setEntries] = useState([]);
  const [allPhotos, setPhotos] = useState([]);
  const entries = allEntries.filter((e) => !e.deleted);
  const deletedEntries = allEntries.filter((e) => e.deleted);
  const deletedIds = new Set(deletedEntries.map((e) => e.id));
  const photos = allPhotos.filter((p) => !p.entryId || !deletedIds.has(p.entryId));
  const [review, setReview] = useState(null);
  const [xfers, setXfers] = useState([]);
  const [sales, setSales] = useState('');
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const a = onSnapshot(query(collection(db, 'shifts', shift.id, 'entries'), orderBy('createdAt', 'asc')), (q) => setEntries(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    const b = onSnapshot(collection(db, 'shifts', shift.id, 'photos'), (q) => setPhotos(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    const c = onSnapshot(doc(db, 'reviews', shift.id), (s) => {
      const r = s.exists() ? s.data() : null;
      setReview(r);
      if (r && r.sales !== null && r.sales !== undefined) setSales((cur) => (cur === '' ? String(r.sales) : cur));
    }, () => {});
    const d = onSnapshot(query(collection(db, 'transfers'), where('shopId', '==', shift.shopId), where('fromShiftId', '==', shift.id)),
      (q) => setXfers(q.docs.map((x) => ({ id: x.id, ...x.data() }))), () => {});
    return () => { a(); b(); c(); d(); };
  }, [shift.id]);

  const sum = computeShift(shift, entries, shop, sales === '' ? null : num(sales));
  const rcv = shift.receive || {};
  const hnd = shift.handover || {};
  const status = shift.status;
  const reviewing = status === 'reviewing';
  useTour(reviewing ? 's-reviewing' : 's-detail', reviewing ? STAFF_REVIEWING : STAFF_DETAIL, { uid: profile?.id, prio: reviewing ? 3 : 2, enabled: !!canReview });
  const closed = status === 'closed';

  const start = async () => {
    setBusy(true);
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'reviews', shift.id), { shopId: shift.shopId, shiftId: shift.id, day: shift.day, month: shift.month, cashierName: shift.cashierName, accountantUid: profile.id, accountantName: profile.name, startedAt: serverTimestamp(), submittedAtLocal: shift.submittedAtLocal || null, sales: null }, { merge: true });
      b.update(doc(db, 'shifts', shift.id), { status: 'reviewing', reviewer: profile.name, reviewStartedAt: serverTimestamp() });
      await b.commit();
      toast('بدأت المراجعة · اكتب رقم المبيعات');
    } catch (e) { console.error(e); toast('مش قادرين نبدأ المراجعة', 'err'); }
    setBusy(false);
  };

  const saveSales = async () => {
    if (!reviewing || sales === '') return;
    try { await updateDoc(doc(db, 'reviews', shift.id), { sales: num(sales), diff: sum.diff, salesAt: serverTimestamp() }); } catch (e) { console.error(e); }
  };

  const unchecked = photos.filter((p) => p.check !== 'ok' && p.check !== 'bad').length;
  const cashierSafe = `خزنة ${shift.cashierName}`;
  // Owner wallets: all transfers of one wallet are posted as one statement (700 + 67 …).
  const transferEntries = entries.filter((e) => e.type === 'transfer');
  const opEntries = entries.filter((e) => e.type !== 'transfer');
  const transferMoves = WALLETS.map((w) => {
    const list = transferEntries.filter((e) => e.wallet === w.key);
    if (!list.length) return null;
    return { id: 'tr:' + w.key, title: `تحويلات ${w.label}`, from: cashierSafe, to: w.label, amount: list.reduce((a, e) => a + num(e.amount), 0), parts: list };
  }).filter(Boolean);
  const allMoves = systemMoves(shift, sum, cashierSafe);
  const moves = [...allMoves.filter((m) => m.id !== 'close'), ...transferMoves];
  const endMoves = allMoves.filter((m) => m.id === 'close');
  const autoPosted = review?.autoPosted || {};
  const toggleMove = (m) => setDoc(doc(db, 'reviews', shift.id), { shopId: shift.shopId, autoPosted: { [m.id]: !autoPosted[m.id] } }, { merge: true }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const leftEntries = opEntries.filter((e) => !e.posted).length;
  const leftMoves = [...moves, ...endMoves].filter((m) => !autoPosted[m.id]).length;
  const [typedDiff, setTypedDiff] = useState('');
  const expectAbs = sum.diff === null ? null : Math.round(Math.abs(sum.diff) * 100) / 100;
  const typedOk = expectAbs !== null && typedDiff.trim() !== '' && Math.round(num(typedDiff) * 100) / 100 === expectAbs;
  const blockers = [
    leftMoves + leftEntries > 0 && `فاضل ${leftMoves + leftEntries} حركة ما اتعلّمش عليها`,
    unchecked > 0 && `فاضل ${unchecked} صورة ما اتراجعتش`,
    sum.diff !== null && !typedOk && (typedDiff.trim() === '' ? `اكتب ${sum.diff < 0 ? 'العجز' : sum.diff > 0 ? 'الزيادة' : 'النتيجة'} بإيدك` : 'الرقم اللي كتبته مش زي النتيجة'),
  ].filter(Boolean);

  const close = async () => {
    if (blockers.length) { toast(blockers.join(' · '), 'err'); return; }
    if (sales === '') { toast('اكتب رقم المبيعات الأول', 'err'); return; }
    if (!window.confirm(`تقفيل الوردية بنتيجة: ${diffText(sum.diff)}؟`)) return;
    setBusy(true);
    try {
      const now = new Date();
      const b = writeBatch(db);
      const mins = minutesBetween(review?.startedAt, now);
      b.update(doc(db, 'reviews', shift.id), { sales: num(sales), diff: sum.diff, closedAt: serverTimestamp(), closeMinutes: mins, waitMinutes: minutesBetween(shift.submittedAt, review?.startedAt), totals: { expenses: sum.outCash, income: sum.income, insta: sum.insta, vf: sum.vf, cash: sum.handCash, drawerDiff: sum.drawerDiff, sideDiff: sum.sideDiff } });
      b.update(doc(db, 'shifts', shift.id), { status: 'closed', closedAt: serverTimestamp(), closedBy: profile.name, diff: sum.diff });
      if (sum.diff !== 0) {
        b.set(doc(db, 'ledger', shift.id), {
          shopId: shift.shopId, shiftId: shift.id, cashierUid: shift.cashierUid, cashierName: shift.cashierName, day: shift.day, month: shift.month,
          kind: sum.diff < 0 ? 'shortage' : 'overage', amount: Math.abs(sum.diff), confirmed: false, createdAt: serverTimestamp(), by: profile.name,
        });
      }
      await b.commit();
      toast('الوردية اتقفلت والتقرير اتبعت');
    } catch (e) { console.error(e); toast('مش قادرين نقفل الوردية', 'err'); }
    setBusy(false);
  };

  const forceSubmit = async () => {
    if (!window.confirm('هتقفل الوردية بالنيابة عن الكاشير من غير تسليم. متأكد؟')) return;
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'shifts', shift.id), { status: 'submitted', submittedAt: serverTimestamp(), forced: true, forcedBy: profile.name, handover: shift.handover || null });
      if (shop?.openShift?.id === shift.id) b.update(doc(db, 'shops', shift.shopId), { openShift: null });
      await b.commit();
      toast('الوردية اتقفلت ووصلت للمراجعة');
    } catch (e) { console.error(e); toast('حصلت مشكلة', 'err'); }
  };

  const [fix, setFix] = useState(null); // { kind: 'entry' | 'photo', target, value }
  const [addOpen, setAddOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const logFix = (what, from, to) => ({ corrections: [...(shift.corrections || []), { what, from, to, by: profile.name, at: new Date().toISOString() }] });
  const fixEntry = async (e, amount) => {
    try {
      await updateDoc(doc(db, 'shifts', shift.id, 'entries', e.id), { amount: num(amount), originalAmount: e.originalAmount ?? e.amount, correctedBy: profile.name, correctedAt: serverTimestamp() });
      await updateDoc(doc(db, 'shifts', shift.id), logFix(entryTitle(e), num(e.amount), num(amount)));
      toast('المبلغ اتعدّل والحساب اتحدّث'); setFix(null);
    } catch (err) { console.error(err); toast('مش قادرين نعدّل', 'err'); }
  };
  // A photo marked "not matching": put the right number where the cashier typed it.
  const fixPhoto = async (p, values) => {
    try {
      if (p.entryId) {
        const e = allEntries.find((x) => x.id === p.entryId);
        if (e) await fixEntry(e, values[0]);
        await updateDoc(doc(db, 'shifts', shift.id, 'photos', p.id), { amount: num(values[0]), corrected: true });
        setFix(null);
        return;
      }
      const stageKey = p.stage === 'receive' ? 'receive' : 'handover';
      const st = shift[stageKey] || {};
      const patch = {};
      if (p.kind === 'wallet') {
        const field = stageKey === 'receive' ? 'wallets' : 'walletsTyped';
        patch[`${stageKey}.${field}.${p.wallet}`] = num(values[0]);
        await updateDoc(doc(db, 'shifts', shift.id), { ...patch, ...logFix(`${p.label} · ${stageKey === 'receive' ? 'استلام' : 'تسليم'}`, num(st[field]?.[p.wallet]), num(values[0])) });
      } else {
        const list = (st.machines || []).map((m) => ({ ...m }));
        const idx = list.map((m, i) => (`${m.machine} · ${m.account}` === p.label || m.machine === p.label ? i : -1)).filter((i) => i >= 0);
        const before = idx.map((i) => num(list[i].value)).join(' + ');
        idx.forEach((i, k) => { if (values[k] !== undefined && values[k] !== '') list[i].value = num(values[k]); });
        await updateDoc(doc(db, 'shifts', shift.id), { [`${stageKey}.machines`]: list, ...logFix(`${p.label} · ${stageKey === 'receive' ? 'استلام' : 'تسليم'}`, before, idx.map((i) => num(list[i].value)).join(' + ')) });
      }
      await updateDoc(doc(db, 'shifts', shift.id, 'photos', p.id), { corrected: true });
      toast('الرقم اتعدّل والحساب اتحدّث'); setFix(null);
    } catch (err) { console.error(err); toast('مش قادرين نعدّل', 'err'); }
  };
  const photoFields = (p) => {
    if (p.entryId || p.kind === 'wallet') return [{ label: 'الرقم الصح', value: photoTyped(p) }];
    const list = (p.stage === 'receive' ? rcv.machines : hnd.machines) || [];
    return list.filter((m) => `${m.machine} · ${m.account}` === p.label || m.machine === p.label).map((m) => ({ label: m.account, value: m.value }));
  };

  const togglePosted = (e) => updateDoc(doc(db, 'shifts', shift.id, 'entries', e.id), { posted: !e.posted, postedBy: profile.name }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const photoOf = (id) => photos.find((p) => p.id === id);
  const checkPhoto = (p, check) => updateDoc(doc(db, 'shifts', shift.id, 'photos', p.id), { check, checkedBy: profile.name, checkedAt: serverTimestamp() }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const photoTyped = (p) => {
    if (p.kind === 'wallet') return (p.stage === 'receive' ? rcv.wallets?.[p.wallet] : hnd.walletsTyped?.[p.wallet]) ?? p.amount ?? null;
    if (p.kind !== 'machine') return p.amount ?? null;
    const list = (p.stage === 'receive' ? rcv.machines : hnd.machines) || [];
    const m = list.find((x) => `${x.machine} · ${x.account}` === p.label);
    if (m) return m.value;
    const g = list.filter((x) => x.machine === p.label);
    return g.length ? g.reduce((a, x) => a + num(x.value), 0) : null;
  };

  const log = [
    { t: shift.openedAt || shift.openedAtLocal, text: `${shift.cashierName} استلم الوردية${rcv.prevCashier ? ` من ${rcv.prevCashier}` : ''}${rcv.diffFromPrev ? ' · عدّل في أرقام الاستلام' : ''}` },
    ...allEntries.map((e) => ({ t: e.createdAt || e.createdAtLocal, text: `${entryTitle(e)} · ${fmt(e.amount)} ج` })),
    ...deletedEntries.map((e) => ({ t: e.deletedAt || e.deletedAtLocal, text: `🗑 ${e.deletedByName || shift.cashierName} مسح: ${entryTitle(e)} · ${fmt(e.amount)} ج${e.deleteReason ? ` · السبب: ${e.deleteReason}` : ''}` })),
    shift.submittedAt && { t: shift.submittedAt, text: shift.forced ? `${shift.forcedBy} قفل الوردية بالنيابة` : `${shift.cashierName} سلّم الوردية` },
    review?.startedAt && { t: review.startedAt, text: `${review.accountantName} بدأ المراجعة` },
    review?.closedAt && { t: review.closedAt, text: `${review.accountantName} قفل الوردية · ${diffText(review.diff)}` },
  ].filter(Boolean).sort((a, b) => toDate(a.t) - toDate(b.t));

  const resultStyle = sum.diff === null ? { background: 'var(--chip)' } : sum.diff < 0 ? { background: 'var(--red-soft)', color: '#9B1C1C' } : sum.diff > 0 ? { background: 'var(--lime-soft)', color: 'var(--lime-ink)' } : { background: 'var(--blue-soft)', color: '#144F86' };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card spread shift-head" style={{ gap: 16 }} data-tour="shift-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
          {shop?.logo ? <img src={shop.logo} alt="" className="shift-logo" /> : <Avatar name={shop?.name} size={84} color="#FFC99A" />}
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <h1 className="shift-shop">{shop?.name}</h1>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{shift.cashierName}{shift.registerName && shift.register !== 'main' ? <span className="badge info" style={{ marginInlineStart: 8, verticalAlign: 'middle' }}>{shift.registerName}</span> : null}</span>
            <span className="small muted">{dateStr(shift.openedAt || shift.openedAtLocal)} · {timeStr(shift.openedAt || shift.openedAtLocal)} ← {shift.submittedAt ? timeStr(shift.submittedAt) : 'لسه شغالة'} · {durationStr(shift.openedAt || shift.openedAtLocal, shift.submittedAt)}</span>
          </div>
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {shift.forced && <span className="badge bad">اتقفلت بالنيابة</span>}
          <span className={'badge ' + (STATUS[status] || STATUS.submitted).cls}>{(STATUS[status] || STATUS.submitted).label}</span>
          {shift.staffUnread && <span className="badge warn">💬 رسالة جديدة من الكاشير</span>}
          {reviewing && review?.startedAt && <span className="badge info">بدأت من {durationStr(review.startedAt)}</span>}
          {fullShop?.posUrl && (
            <a className="pos-link keep" data-tour="pos" href={fullShop.posUrl} target="_blank" rel="noopener noreferrer">
              <span className="ic"><Icon d="monitor" size={18} /></span>برنامج البيع بتاع الفرع<Icon d="up" size={14} />
            </a>
          )}
        </span>
      </section>

      {status === 'open' && canReview && (
        <section className="card spread" data-tour="force">
          <span className="muted">الوردية لسه شغالة. لو الكاشير مشي من غير ما يسلّم تقدر تقفلها بالنيابة عنه.</span>
          <button type="button" className="btn soft sm" onClick={forceSubmit}>قفل بالنيابة</button>
        </section>
      )}

      {status === 'reopened' && (
        <section className="card spread" style={{ background: '#E6F4FF' }}>
          <span style={{ lineHeight: 1.7 }}><b>الوردية مفتوحة للكاشير يعدّلها</b>{shift.reopenNote ? ` · ${shift.reopenNote}` : ''}. أول ما يخلّص هترجعلك «جديدة».</span>
          {canReview && <button type="button" className="btn soft sm" onClick={() => updateDoc(doc(db, 'shifts', shift.id), { status: 'submitted', reopenPending: false, cashierAttention: false }).catch(() => toast('مش قادرين نحفظ', 'err'))}>اقفلها تاني من غير تعديل</button>}
        </section>
      )}

      {status === 'submitted' && canReview && (
        <section className="card spread" style={{ background: 'var(--blue)', color: '#fff' }} data-tour="start">
          <span style={{ fontSize: 17, fontWeight: 600 }}>الوردية مستنياك. دوس ابدأ وبعدين اكتب رقم المبيعات من السيستم.</span>
          <button type="button" className="btn lime" onClick={start} disabled={busy}>ابدأ المراجعة</button>
        </section>
      )}

      {(reviewing || closed) && (
        <section className="card" style={{ gap: 14 }} data-tour="sales">
          <h2 className="h2">1. رقم المبيعات من السيستم</h2>
          <div className="row" style={{ gap: 14, alignItems: 'stretch' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>إجمالي مبيعات الوردية
              <input className="input" inputMode="decimal" style={{ height: 64, fontSize: 28, fontWeight: 700, background: '#fff', border: '2px solid var(--blue)' }}
                value={sales} onChange={(e) => setSales(e.target.value)} onBlur={saveSales} disabled={closed || !canReview} />
            </label>
            <div className="result" style={resultStyle}>
              <span className="small" style={{ fontWeight: 600 }}>النتيجة</span>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{diffText(sum.diff)}</span>
            </div>
          </div>
          {sum.diff !== null && sum.sideDiff ? <span className="tiny muted">النتيجة = خزنة الكاشير {fmt(sum.drawerDiff)} + الجانبي {fmt(sum.sideDiff)}</span> : null}
        </section>
      )}

      {rcv.diffFromPrev && <div className="alert warn small">الكاشير عدّل في أرقام الاستلام{shift.receiveEdits ? ` (${shift.receiveEdits} مرة بعد ما بدأ)` : ''} · اللي قبله سلّم درج {fmt(rcv.prevDrawerTotal)} وجانبي {fmt(rcv.prevSide)}، وهو استلم درج {fmt(rcv.drawerTotal)} وجانبي {fmt(rcv.side)}</div>}
      <Statements c={sum} shift={shift} shop={shop} />
      <BillsCompare rcv={rcv} hnd={shift.handover} />

      <section className="card" style={{ gap: 0 }} data-tour="moves">
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2 className="h2">2. المصروفات والحركات <span className="tiny muted" style={{ fontWeight: 500 }}>· علّم على كل حاجة دخلتها على السيستم</span></h2>
          {leftMoves + leftEntries > 0 ? <span className="badge warn">فاضل {leftMoves + leftEntries}</span> : <span className="badge ok">✓ كله اتعلّم</span>}
        </div>
        {moves.length > 0 && <div className="tiny muted" style={{ fontWeight: 700, padding: '6px 0' }}>حركات الخزن (المحاسب بيعملها)</div>}
        {moves.map((m) => <MoveRow key={m.id} m={m} on={!!autoPosted[m.id]} onToggle={() => toggleMove(m)} canReview={canReview} photoOf={photoOf} onView={setView} />)}
        {moves.length > 0 && opEntries.length > 0 && <div className="tiny muted" style={{ fontWeight: 700, padding: '10px 0 6px' }}>عمليات الكاشير</div>}
        {opEntries.length === 0 && moves.length === 0 && endMoves.length === 0 && <div className="empty">مفيش عمليات في الوردية دي</div>}
        {opEntries.map((e) => {
          const ph = e.photoId && photoOf(e.photoId);
          const name = e.sub || e.reason || e.machine || '';
          return (
            <div key={e.id} className="list-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
                <input type="checkbox" checked={!!e.posted} onChange={() => togglePosted(e)} disabled={!canReview} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />
                <span className="stack" style={{ gap: 1 }}>
                  <span style={{ fontWeight: 700 }}>{entryTitle(e)}{e.newItem && <span className="badge warn" style={{ marginInlineStart: 6 }}>جديد</span>}</span>
                  <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || safeLabel(e.src, shop)}{e.type === 'liquidate' ? ` ← ${safeLabel(e.to, shop)}` : ''}</span>
                </span>
              </label>
              {ph && <img className="thumb" style={{ width: 44, height: 44 }} src={ph.data} alt="صورة" onClick={() => setView(ph.data)} />}
              {name && <span className="small" style={{ display: 'flex', alignItems: 'center' }}>{name}<CopyBtn value={name} label="نسخ الاسم" /></span>}
              <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 16, minWidth: 90, justifyContent: 'flex-end', gap: 4 }}>
                {e.originalAmount !== undefined && <span className="tiny muted" style={{ textDecoration: 'line-through' }}>{fmt(e.originalAmount)}</span>}
                {fmt(e.amount)}<CopyBtn value={fmt(e.amount)} label="نسخ المبلغ" />
                {canReview && !closed && <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`عدّل مبلغ ${entryTitle(e)}`} title="عدّل المبلغ" onClick={() => setFix({ e, value: String(e.amount) })}><Icon d="gear" size={15} /></button>}
              </span>
              {fix?.e?.id === e.id && (
                <div className="row" style={{ gap: 8, flex: '1 1 100%', alignItems: 'center' }}>
                  <input className="input" inputMode="decimal" style={{ flex: '1 1 140px', height: 44 }} value={fix.value} onChange={(ev) => setFix({ ...fix, value: ev.target.value })} aria-label="المبلغ الصح" autoFocus />
                  <button type="button" className="btn sm" onClick={() => fixEntry(e, fix.value)}>حفظ التعديل</button>
                  <button type="button" className="link" onClick={() => setFix(null)}>إلغاء</button>
                </div>
              )}
            </div>
          );
        })}
        {canReview && !closed && (
          <div className="row" style={{ gap: 8, paddingTop: 12 }}>
            <button type="button" className="btn soft sm" onClick={() => setAddOpen(true)} data-tour="add-fix"><Icon d="plus" size={16} />إضافة مصروف أو إيراد (تصحيح)</button>
            {['submitted', 'reviewing'].includes(status) && <button type="button" className="btn soft sm" onClick={() => setReopenOpen(true)} data-tour="reopen"><Icon d="undo" size={16} />افتح الوردية للكاشير يعدّلها</button>}
          </div>
        )}
        {(shift.corrections || []).length > 0 && (
          <div className="stack" style={{ gap: 2, paddingTop: 10 }}>
            <span className="tiny muted" style={{ fontWeight: 700 }}>تعديلات المحاسب</span>
            {shift.corrections.map((c, i) => <span key={i} className="tiny">{c.by}: {c.what} · من {typeof c.from === 'number' ? fmt(c.from) : c.from} لـ {typeof c.to === 'number' ? fmt(c.to) : c.to}</span>)}
          </div>
        )}
        {endMoves.length > 0 && <div className="tiny muted" style={{ fontWeight: 700, padding: '10px 0 6px' }}>في الآخر خالص</div>}
        {endMoves.map((m) => <MoveRow key={m.id} m={m} on={!!autoPosted[m.id]} onToggle={() => toggleMove(m)} canReview={canReview} photoOf={photoOf} onView={setView} />)}
      </section>

      {xfers.filter((t) => t.status !== 'cancelled').length > 0 && (
        <section className="card" style={{ gap: 6 }}>
          <h2 className="h2">فلوس اتبعتت لكاشير تاني</h2>
          {xfers.filter((t) => t.status !== 'cancelled').map((t) => (
            <div key={t.id} className="list-row">
              <span className="stack" style={{ gap: 1, flex: '1 1 220px' }}>
                <strong>{t.kind === 'handover' ? 'تسليم آخر الوردية' : t.kind === 'float' ? 'فكة' : 'فلوس'} ← {t.toRegName}</strong>
                <span className="tiny muted">{timeStr(t.createdAt || t.createdAtLocal)}{t.note ? ` · ${t.note}` : ''}</span>
              </span>
              <strong>{fmt(t.amount)} ج</strong>
              {t.status === 'pending' ? <span className="badge warn">لسه ما اتأكدش</span>
                : <span className={'badge ' + (t.acceptedDiff ? 'bad' : 'ok')}>{t.toName} استلم {fmt(t.acceptedAmount)}{t.acceptedDiff ? ` · فرق ${fmt(t.acceptedDiff)}` : ' ✓'}</span>}
            </div>
          ))}
        </section>
      )}

      {deletedEntries.length > 0 && (
        <section className="card" style={{ gap: 0, background: '#FFF1F1' }}>
          <h2 className="h2" style={{ marginBottom: 4 }}>المحذوفات ({deletedEntries.length}) <span className="tiny muted" style={{ fontWeight: 500 }}>· الكاشير مسحها قبل التسليم ومش داخلة في الحساب</span></h2>
          <DeletedList items={deletedEntries} shop={shop} />
        </section>
      )}

      {photos.length > 0 && (
        <section className="card" data-tour="photos">
          <div className="spread">
            <h2 className="h2">الصور <span className="tiny muted" style={{ fontWeight: 500 }}>· اتأكد إن الرقم اللي في الصورة هو اللي الكاشير كتبه</span></h2>
            {unchecked > 0 ? <span className="badge warn">فاضل {unchecked} صورة</span> : <span className="badge ok">✓ كل الصور اتراجعت</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {photos.map((p) => {
              const ok = p.check === 'ok', bad = p.check === 'bad';
              const typed = photoTyped(p);
              return (
                <div key={p.id} style={{ background: 'var(--bg)', borderRadius: 20, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, border: `2px solid ${ok ? 'var(--lime)' : bad ? 'var(--red)' : 'transparent'}` }}>
                  <ZoomImage src={p.data} alt={p.label} height={340} />
                  <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setView(p.data)}>افتحها كبيرة</button>
                  <span className="small"><b>{{ transfer: 'تحويل', invoice: 'فاتورة', machine: p.stage === 'receive' ? 'مكنة · استلام' : 'مكنة · تسليم', wallet: p.stage === 'receive' ? 'محفظة · استلام' : 'محفظة · تسليم' }[p.kind]}</b> · {p.label}</span>
                  {typed !== null && <span className="small">الكاشير كتب: <b>{fmt(typed)}</b></span>}
                  {p.kind === 'transfer' && shop?.walletName && <span className="tiny muted">لازم يكون المستلم: {shop.walletName}</span>}
                  {canReview ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={'chip sm' + (ok ? ' on' : '')} style={{ flex: 1 }} onClick={() => checkPhoto(p, ok ? 'pending' : 'ok')}>{ok ? '✓ مطابقة' : 'مطابقة'}</button>
                      <button type="button" className="chip sm" style={{ flex: 1, background: bad ? 'var(--red)' : undefined, color: bad ? '#fff' : undefined }} onClick={() => checkPhoto(p, bad ? 'pending' : 'bad')}>مش مطابقة</button>
                    </span>
                  ) : <span className={'badge ' + (ok ? 'ok' : bad ? 'bad' : 'warn')}>{ok ? 'مطابقة' : bad ? 'مش مطابقة' : 'لسه'}</span>}
                  {bad && canReview && !closed && <PhotoFix fields={photoFields(p)} done={p.corrected} onSave={(vals) => fixPhoto(p, vals)} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card" style={{ gap: 10 }} data-tour="s-chat">
        <h2 className="h2">💬 شات الوردية <span className="tiny muted" style={{ fontWeight: 500 }}>· بينك وبين {shift.cashierName}</span></h2>
        <ShiftChat shift={shift} profile={profile} side="staff" />
      </section>
      {addOpen && <AddCorrection shift={shift} shop={shop} profile={profile} onClose={() => setAddOpen(false)} />}
      {reopenOpen && <ReopenModal shift={shift} profile={profile} onClose={() => setReopenOpen(false)} />}

      <div className="row" style={{ gap: 16 }}>
        <section className="card" style={{ flex: '1 1 320px', gap: 4 }}>
          <h2 className="h2" style={{ marginBottom: 6 }}>سجل النشاط</h2>
          {log.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '4px 0' }}>
              <span className="muted" style={{ width: 70, flexShrink: 0, fontWeight: 600 }}>{timeStr(l.t)}</span><span>{l.text}</span>
            </div>
          ))}
        </section>
        {reviewing && canReview && (
          <section className="card" style={{ flex: '1 1 320px' }} data-tour="close">
            <h2 className="h2">3. التقفيل</h2>
            <span style={{ lineHeight: 1.7 }}>
              {sum.diff === null ? 'اكتب رقم المبيعات علشان النتيجة تطلع.' : sum.diff < 0 ? `العجز ${fmt(-sum.diff)} ج هيتسجل على ${shift.cashierName} في سجل العجز، ويستنى تأكيد إنه اتخصم.` : sum.diff > 0 ? `الزيادة ${fmt(sum.diff)} ج هتتسجل باسم ${shift.cashierName} في سجل الزيادات.` : 'الوردية مضبوطة، مفيش عجز ولا زيادة.'}
            </span>
            {sum.diff !== null && (
              <label className="field">{sum.diff < 0 ? 'اكتب العجز بإيدك' : sum.diff > 0 ? 'اكتب الزيادة بإيدك' : 'اكتب النتيجة بإيدك (0 لو مضبوطة)'}
                <input className="input" inputMode="decimal" value={typedDiff} onChange={(e) => setTypedDiff(e.target.value)} placeholder="المبلغ" style={{ fontSize: 22, fontWeight: 800, textAlign: 'center', borderColor: typedDiff === '' ? undefined : typedOk ? 'var(--lime)' : 'var(--red)' }} />
                {typedDiff !== '' && <span className={'badge ' + (typedOk ? 'ok' : 'bad')}>{typedOk ? '✓ مطابق للنتيجة' : 'مش مطابق، راجع تاني'}</span>}
              </label>
            )}
            {blockers.map((b) => <span key={b} className="badge warn" style={{ whiteSpace: 'normal' }}>{b}</span>)}
            <button type="button" className="btn blue full" onClick={close} disabled={busy || sales === '' || blockers.length > 0}><Icon d="check" />تقفيل الوردية وإرسال التقرير</button>
            <span className="tiny muted">التقرير بيوصل للمدير والأونر في صفحة التقارير.</span>
          </section>
        )}
      </div>
      <PhotoView src={view} onClose={() => setView(null)} />
    </div>
  );
}

function MoveRow({ m, on, onToggle, canReview, photoOf, onView }) {
  return (
    <div className="list-row" style={{ background: on ? undefined : '#F2F7FF', flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
        <input type="checkbox" checked={on} onChange={onToggle} disabled={!canReview} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />
        <span className="stack" style={{ gap: 1 }}>
          <span style={{ fontWeight: 700 }}>{m.title}{m.parts ? <span className="tiny muted" style={{ fontWeight: 500 }}> · {m.parts.length} تحويل</span> : null}</span>
          <span className="tiny muted">{m.from} ← {m.to}</span>
          {m.parts && <span className="small" style={{ fontWeight: 700, direction: 'ltr', textAlign: 'right' }}>{m.parts.map((e) => fmt(e.amount)).join(' + ')}</span>}
        </span>
      </label>
      {m.parts && (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {m.parts.map((e) => { const ph = e.photoId && photoOf(e.photoId); return ph ? <img key={e.id} className="thumb" style={{ width: 38, height: 38 }} src={ph.data} alt={`صورة تحويل ${fmt(e.amount)}`} title={fmt(e.amount)} onClick={() => onView(ph.data)} /> : null; })}
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 16, minWidth: 90, justifyContent: 'flex-end' }}>{fmt(m.amount)}<CopyBtn value={fmt(m.amount)} label="نسخ المبلغ" /></span>
    </div>
  );
}

// Safe-to-safe moves the accountant has to make in the POS system for this shift.
function systemMoves(shift, sum, cashierSafe) {
  const rcv = shift.receive || {};
  const hnd = shift.handover || null;
  const list = [];
  if (num(rcv.drawerTotal) > 0) list.push({ id: 'open', title: 'استلام أول المدة', from: 'خزنة التسليم', to: cashierSafe, amount: num(rcv.drawerTotal) });
  (sum.walletInfo || []).filter((w) => w.mode === 'shop' && w.sales).forEach((w) => {
    list.push({ id: 'w:' + w.key, title: `فرق ${w.label}`, from: w.sales < 0 ? w.label : cashierSafe, to: w.sales < 0 ? cashierSafe : w.label, amount: Math.abs(w.sales) });
  });
  (sum.machineGroups || []).filter((g) => g.affects && g.sales).forEach((g) => {
    list.push({ id: 'm:' + g.machine, title: `فرق ${g.machine} الإجمالي`, from: g.sales < 0 ? g.machine : cashierSafe, to: g.sales < 0 ? cashierSafe : g.machine, amount: Math.abs(g.sales) });
    if (g.fee) list.push({ id: 'f:' + g.machine, title: `مصاريف ${g.machine} (${fmt(g.rate)}%)`, from: cashierSafe, to: 'مصروف', amount: g.fee });
  });
  if (hnd && hnd.keepDrawer === 'stay' && num(hnd.drawerTotal) > 0) list.push({ id: 'close', title: 'تسليم آخر المدة للي بعده', from: cashierSafe, to: 'خزنة التسليم', amount: num(hnd.drawerTotal) });
  return list;
}

function BillsCompare({ rcv, hnd }) {
  const tot = (b) => FACES.reduce((a, f) => a + f * num(b?.[f]), 0);
  if (!rcv?.bills && !hnd?.bills) return null;
  return (
    <section className="card" style={{ gap: 10 }} data-tour="bills-compare">
      <h2 className="h2">الفئات · استلم وسلّم</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 420 }}>
          <thead><tr><th>الفئة</th>{FACES.map((f, i) => <th key={f} style={{ background: BILL_BG[i] }}>{f}</th>)}<th>الإجمالي</th></tr></thead>
          <tbody>
            <tr><td><b>استلم</b></td>{FACES.map((f) => <td key={f}>{num(rcv?.bills?.[f])}</td>)}<td><b>{fmt(tot(rcv?.bills))}</b></td></tr>
            <tr><td><b>سلّم</b></td>{FACES.map((f) => <td key={f}>{hnd?.bills ? num(hnd.bills[f]) : '—'}</td>)}<td><b>{hnd?.bills ? fmt(tot(hnd.bills)) : '—'}</b></td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PhotoFix({ fields, done, onSave }) {
  const [vals, setVals] = useState(() => fields.map((f) => (f.value === null || f.value === undefined ? '' : String(f.value))));
  return (
    <div className="stack" style={{ gap: 6, background: '#FFF1F1', borderRadius: 14, padding: 10 }}>
      <span className="tiny" style={{ fontWeight: 700, color: '#9B1C1C' }}>{done ? '✓ اتعدّل · تقدر تعدّل تاني' : 'اكتب الرقم اللي في الصورة'}</span>
      {fields.map((f, i) => (
        <label key={i} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ minWidth: 70 }}>{f.label}</span>
          <input className="input" style={{ height: 40, flex: 1 }} inputMode="decimal" value={vals[i]} onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))} />
        </label>
      ))}
      <button type="button" className="btn sm" onClick={() => onSave(vals)}>عدّل الرقم</button>
    </div>
  );
}

function AddCorrection({ shift, shop, profile, onClose }) {
  const toast = useToast();
  const [type, setType] = useState('expense');
  const [src, setSrc] = useState('drawer');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (num(amount) <= 0) { toast('اكتب المبلغ', 'err'); return; }
    if (!note.trim()) { toast('اكتب السبب', 'err'); return; }
    setBusy(true);
    try {
      await addDoc(collection(db, 'shifts', shift.id, 'entries'), {
        type, src, amount: num(amount), ...(type === 'expense' ? { kind: 'correction', kindLabel: 'تصحيح من المحاسب', note: note.trim() } : { reason: 'تصحيح من المحاسب', note: note.trim() }),
        byAccountant: true, by: profile.id, byName: profile.name, posted: false,
        createdAt: serverTimestamp(), createdAtLocal: new Date().toISOString(),
      });
      await updateDoc(doc(db, 'shifts', shift.id), { corrections: [...(shift.corrections || []), { what: `${type === 'expense' ? 'مصروف' : 'إيراد'} جديد · ${note.trim()}`, from: 0, to: num(amount), by: profile.name, at: new Date().toISOString() }] });
      toast('العملية اتضافت والحساب اتحدّث'); onClose();
    } catch (e) { console.error(e); toast('مش قادرين نضيف', 'err'); setBusy(false); }
  };
  return (
    <Modal title="إضافة عملية تصحيح" icon="plus" color="var(--blue)" onClose={onClose} width={460}>
      <div className="chips">
        <button type="button" className={'chip' + (type === 'expense' ? ' on' : '')} onClick={() => setType('expense')}>مصروف</button>
        <button type="button" className={'chip' + (type === 'income' ? ' on' : '')} onClick={() => setType('income')}>إيراد</button>
      </div>
      <div className="chips">
        <button type="button" className={'chip' + (src === 'drawer' ? ' on' : '')} onClick={() => setSrc('drawer')}>درج الكاشير</button>
        {!shop?.noSide && <button type="button" className={'chip' + (src === 'side' ? ' on' : '')} onClick={() => setSrc('side')}>الدرج الجانبي</button>}
      </div>
      <label className="field">المبلغ<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <label className="field">السبب<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: مصروف الكاشير نسي يسجله" /></label>
      <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'أضف'}</button>
    </Modal>
  );
}

function ReopenModal({ shift, profile, onClose }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const go = async () => {
    try {
      await updateDoc(doc(db, 'shifts', shift.id), { status: 'reopened', reopenPending: true, cashierAttention: true, reopenNote: note.trim(), reopenedBy: profile.name, reopenedAt: serverTimestamp(), reopenCount: (shift.reopenCount || 0) + 1 });
      toast(`الوردية اتفتحت لـ ${shift.cashierName} يعدّلها`); onClose();
    } catch (e) { console.error(e); toast('مش قادرين نفتحها', 'err'); }
  };
  return (
    <Modal title="افتح الوردية للكاشير" icon="undo" color="var(--blue)" onClose={onClose} width={460}>
      <span className="small" style={{ lineHeight: 1.7 }}>{shift.cashierName} هيلاقي رسالة أول ما يدخل إن الوردية دي مفتوحة يعدّلها: يضيف أو يمسح عمليات. لما يخلّص هترجعلك «جديدة».</span>
      <label className="field">عاوزه يعدّل إيه؟ (اختياري)<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: سجّل مصروف المواصلات" /></label>
      <button type="button" className="btn full" onClick={go}>افتحها</button>
    </Modal>
  );
}
