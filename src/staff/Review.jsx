import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, CopyBtn, Icon, PhotoView, ZoomImage, useToast } from '../ui.jsx';
import { BILL_BG, FACES, SRC_LABEL, shopForRegister, computeShift, diffText, durationStr, fmt, minutesBetween, num, safeLabel, timeStr, toDate, dateStr } from '../lib';
import Statements from './Statements.jsx';
import { DeletedList, entryTitle } from '../cashier/Dash.jsx';

const STATUS = {
  open: { label: 'شغالة', cls: 'info' },
  submitted: { label: 'جديدة', cls: 'warn' },
  reviewing: { label: 'بتتراجع', cls: 'dark' },
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
  const pending = useShopShifts(shops, ['open', 'submitted', 'reviewing']);
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
        <aside className="side" style={{ flex: '1 1 300px', maxWidth: 420 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>الورديات <span className="muted" style={{ fontWeight: 500 }}>· {sorted.length}</span></h2>
          {shops.length === 0 && <div className="card empty">لسه مفيش محلات مربوطة بحسابك</div>}
          {shops.length > 0 && sorted.length === 0 && <div className="card empty">مفيش ورديات مستنية مراجعة</div>}
          {sorted.map((s) => {
            const late = s.status === 'submitted' && minutesBetween(s.submittedAt, new Date()) > 60;
            const st = late ? { label: `متأخرة ${durationStr(s.submittedAt)}`, cls: 'bad' } : STATUS[s.status];
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
  const moves = systemMoves(shift, sum, cashierSafe);
  const autoPosted = review?.autoPosted || {};
  const toggleMove = (m) => setDoc(doc(db, 'reviews', shift.id), { shopId: shift.shopId, autoPosted: { [m.id]: !autoPosted[m.id] } }, { merge: true }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const leftEntries = entries.filter((e) => !e.posted).length;
  const leftMoves = moves.filter((m) => !autoPosted[m.id]).length;
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

  const togglePosted = (e) => updateDoc(doc(db, 'shifts', shift.id, 'entries', e.id), { posted: !e.posted, postedBy: profile.name }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const photoOf = (id) => photos.find((p) => p.id === id);
  const checkPhoto = (p, check) => updateDoc(doc(db, 'shifts', shift.id, 'photos', p.id), { check, checkedBy: profile.name, checkedAt: serverTimestamp() }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const photoTyped = (p) => {
    if (p.kind !== 'machine') return p.amount ?? null;
    const list = (p.stage === 'receive' ? rcv.machines : hnd.machines) || [];
    const m = list.find((x) => `${x.machine} · ${x.account}` === p.label);
    return m ? m.value : null;
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
      <section className="card spread shift-head" style={{ gap: 16 }}>
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
          <span className={'badge ' + STATUS[status].cls}>{STATUS[status].label}</span>
          {reviewing && review?.startedAt && <span className="badge info">بدأت من {durationStr(review.startedAt)}</span>}
          {fullShop?.posUrl && (
            <a className="pos-link keep" href={fullShop.posUrl} target="_blank" rel="noopener noreferrer">
              <span className="ic"><Icon d="monitor" size={18} /></span>برنامج البيع بتاع الفرع<Icon d="up" size={14} />
            </a>
          )}
        </span>
      </section>

      {status === 'open' && canReview && (
        <section className="card spread">
          <span className="muted">الوردية لسه شغالة. لو الكاشير مشي من غير ما يسلّم تقدر تقفلها بالنيابة عنه.</span>
          <button type="button" className="btn soft sm" onClick={forceSubmit}>قفل بالنيابة</button>
        </section>
      )}

      {status === 'submitted' && canReview && (
        <section className="card spread" style={{ background: 'var(--blue)', color: '#fff' }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>الوردية مستنياك. دوس ابدأ وبعدين اكتب رقم المبيعات من السيستم.</span>
          <button type="button" className="btn lime" onClick={start} disabled={busy}>ابدأ المراجعة</button>
        </section>
      )}

      {(reviewing || closed) && (
        <section className="card" style={{ gap: 14 }}>
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

      <section className="card" style={{ gap: 0 }}>
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2 className="h2">2. المصروفات والحركات <span className="tiny muted" style={{ fontWeight: 500 }}>· علّم على كل حاجة دخلتها على السيستم</span></h2>
          {leftMoves + leftEntries > 0 ? <span className="badge warn">فاضل {leftMoves + leftEntries}</span> : <span className="badge ok">✓ كله اتعلّم</span>}
        </div>
        {moves.length > 0 && <div className="tiny muted" style={{ fontWeight: 700, padding: '6px 0' }}>حركات الخزن (المحاسب بيعملها)</div>}
        {moves.map((m) => (
          <div key={m.id} className="list-row" style={{ background: autoPosted[m.id] ? undefined : '#F2F7FF' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
              <input type="checkbox" checked={!!autoPosted[m.id]} onChange={() => toggleMove(m)} disabled={!canReview} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />
              <span className="stack" style={{ gap: 1 }}>
                <span style={{ fontWeight: 700 }}>{m.title}</span>
                <span className="tiny muted">{m.from} ← {m.to}</span>
              </span>
            </label>
            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 16, minWidth: 90, justifyContent: 'flex-end' }}>{fmt(m.amount)}<CopyBtn value={fmt(m.amount)} label="نسخ المبلغ" /></span>
          </div>
        ))}
        {moves.length > 0 && entries.length > 0 && <div className="tiny muted" style={{ fontWeight: 700, padding: '10px 0 6px' }}>عمليات الكاشير</div>}
        {entries.length === 0 && moves.length === 0 && <div className="empty">مفيش عمليات في الوردية دي</div>}
        {entries.map((e) => {
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
              <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 16, minWidth: 90, justifyContent: 'flex-end' }}>{fmt(e.amount)}<CopyBtn value={fmt(e.amount)} label="نسخ المبلغ" /></span>
            </div>
          );
        })}
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
        <section className="card">
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
                  <span className="small"><b>{{ transfer: 'تحويل', invoice: 'فاتورة', machine: p.stage === 'receive' ? 'مكنة · استلام' : 'مكنة · تسليم' }[p.kind]}</b> · {p.label}</span>
                  {typed !== null && <span className="small">الكاشير كتب: <b>{fmt(typed)}</b></span>}
                  {p.kind === 'transfer' && shop?.walletName && <span className="tiny muted">لازم يكون المستلم: {shop.walletName}</span>}
                  {canReview ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={'chip sm' + (ok ? ' on' : '')} style={{ flex: 1 }} onClick={() => checkPhoto(p, ok ? 'pending' : 'ok')}>{ok ? '✓ مطابقة' : 'مطابقة'}</button>
                      <button type="button" className="chip sm" style={{ flex: 1, background: bad ? 'var(--red)' : undefined, color: bad ? '#fff' : undefined }} onClick={() => checkPhoto(p, bad ? 'pending' : 'bad')}>مش مطابقة</button>
                    </span>
                  ) : <span className={'badge ' + (ok ? 'ok' : bad ? 'bad' : 'warn')}>{ok ? 'مطابقة' : bad ? 'مش مطابقة' : 'لسه'}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

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
          <section className="card" style={{ flex: '1 1 320px' }}>
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
    <section className="card" style={{ gap: 10 }}>
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
