import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, CopyBtn, Icon, PhotoView, useToast } from '../ui.jsx';
import { RATE_FROM, SETTLE, SRC_LABEL, diffText, durationStr, fmt, minutesBetween, num, sideExpected, summarize, timeStr, toDate, dateStr } from '../lib';
import { entryTitle } from '../cashier/Dash.jsx';

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
                <span className="small muted">{s.cashierName} · من {timeStr(s.openedAt || s.openedAtLocal)}{s.submittedAt ? ` لـ ${timeStr(s.submittedAt)}` : ''}</span>
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

export function ShiftDetail({ shift, shop, profile, canReview }) {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [review, setReview] = useState(null);
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
    return () => { a(); b(); c(); };
  }, [shift.id]);

  const sum = summarize({ ...shift, review: { sales: sales === '' ? null : num(sales) } }, entries);
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

  const close = async () => {
    if (sales === '') { toast('اكتب رقم المبيعات الأول', 'err'); return; }
    const warnPhotos = unchecked > 0 ? `\nلسه فيه ${unchecked} صورة ما اتراجعتش.` : '';
    if (!window.confirm(`تقفيل الوردية بنتيجة: ${diffText(sum.diff)}؟${warnPhotos}`)) return;
    setBusy(true);
    try {
      const now = new Date();
      const b = writeBatch(db);
      const mins = minutesBetween(review?.startedAt, now);
      b.update(doc(db, 'reviews', shift.id), { sales: num(sales), diff: sum.diff, closedAt: serverTimestamp(), closeMinutes: mins, waitMinutes: minutesBetween(shift.submittedAt, review?.startedAt), totals: { expenses: sum.outCash, income: sum.income, insta: sum.insta, vf: sum.vf, cash: sum.handCash } });
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
  const machinePhotos = photos.filter((p) => p.kind === 'machine');
  const unchecked = photos.filter((p) => p.check !== 'ok' && p.check !== 'bad').length;
  const checkPhoto = (p, check) => updateDoc(doc(db, 'shifts', shift.id, 'photos', p.id), { check, checkedBy: profile.name, checkedAt: serverTimestamp() }).catch(() => toast('مش قادرين نحفظ', 'err'));
  const photoTyped = (p) => {
    if (p.kind !== 'machine') return p.amount ?? null;
    const list = (p.stage === 'receive' ? rcv.machines : hnd.machines) || [];
    const m = list.find((x) => `${x.machine} · ${x.account}` === p.label);
    return m ? m.value : null;
  };

  const log = [
    { t: shift.openedAt || shift.openedAtLocal, text: `${shift.cashierName} استلم الوردية${rcv.prevCashier ? ` من ${rcv.prevCashier}` : ''}${rcv.diffFromPrev ? ' · عدّل في أرقام الاستلام' : ''}` },
    ...entries.map((e) => ({ t: e.createdAt || e.createdAtLocal, text: `${entryTitle(e)} · ${fmt(e.amount)} ج` })),
    shift.submittedAt && { t: shift.submittedAt, text: shift.forced ? `${shift.forcedBy} قفل الوردية بالنيابة` : `${shift.cashierName} سلّم الوردية` },
    review?.startedAt && { t: review.startedAt, text: `${review.accountantName} بدأ المراجعة` },
    review?.closedAt && { t: review.closedAt, text: `${review.accountantName} قفل الوردية · ${diffText(review.diff)}` },
  ].filter(Boolean).sort((a, b) => toDate(a.t) - toDate(b.t));

  const resultStyle = sum.diff === null ? { background: 'var(--chip)' } : sum.diff < 0 ? { background: 'var(--red-soft)', color: '#9B1C1C' } : sum.diff > 0 ? { background: 'var(--lime-soft)', color: 'var(--lime-ink)' } : { background: 'var(--blue-soft)', color: '#144F86' };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card spread">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {shop?.logo ? <img src={shop.logo} alt="" style={{ height: 48, width: 'auto', maxWidth: 140, objectFit: 'contain' }} /> : <Avatar name={shop?.name} size={48} color="#FFC99A" />}
          <div className="stack" style={{ gap: 2 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{shop?.name} · {shift.cashierName}</h1>
            <span className="small muted">{dateStr(shift.openedAt || shift.openedAtLocal)} · {timeStr(shift.openedAt || shift.openedAtLocal)} ← {shift.submittedAt ? timeStr(shift.submittedAt) : 'لسه شغالة'} · {durationStr(shift.openedAt || shift.openedAtLocal, shift.submittedAt)}</span>
          </div>
        </div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {shift.forced && <span className="badge bad">اتقفلت بالنيابة</span>}
          <span className={'badge ' + STATUS[status].cls}>{STATUS[status].label}</span>
          {reviewing && review?.startedAt && <span className="badge info">بدأت من {durationStr(review.startedAt)}</span>}
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
          <div className="eq">
            <span className="b">الاستلام <b>{fmt(sum.recvCash)}</b></span>+<span className="b">المبيعات <b>{fmt(sales)}</b></span>+<span className="b">الإيرادات <b>{fmt(sum.income)}</b></span>
            −<span className="b">المصروفات <b>{fmt(sum.outCash)}</b></span>−<span className="b">التحويلات <b>{fmt(sum.transfers)}</b></span>
            =<span className="b">المتوقع <b>{fmt(sum.expected)}</b></span>
            <span className="b">التسليم الفعلي <b>{fmt(sum.handCash)}</b></span>
          </div>
        </section>
      )}

      <div className="row" style={{ gap: 16 }}>
        <section className="card tint-orange" style={{ flex: '1 1 320px' }}>
          <h2 className="h2">النقدية</h2>
          <table className="table">
            <thead><tr><th>الخزنة</th><th>استلام</th><th>تسليم</th><th>رايحة فين</th></tr></thead>
            <tbody>
              <tr><td><b>درج الكاشير</b></td><td>{fmt(rcv.drawerTotal)}<CopyBtn value={fmt(rcv.drawerTotal)} /></td><td>{fmt(hnd.drawerTotal)}<CopyBtn value={fmt(hnd.drawerTotal)} /></td><td>{hnd.keepDrawer ? (hnd.keepDrawer === 'stay' ? 'فضل' : 'للمحل') : '—'}</td></tr>
              <tr><td><b>الجانبي</b></td><td>{fmt(rcv.side)}<CopyBtn value={fmt(rcv.side)} /></td><td>{fmt(hnd.side)}<CopyBtn value={fmt(hnd.side)} /></td><td>{hnd.keepSide ? (hnd.keepSide === 'stay' ? 'فضل' : 'للمحل') : '—'}</td></tr>
            </tbody>
          </table>
          {hnd.sideFix && <span className="badge bad" style={{ whiteSpace: 'normal' }}>الجانبي كان {hnd.sideFix.diff < 0 ? 'ناقص' : 'زيادة'} {fmt(Math.abs(hnd.sideFix.diff))} ج والكاشير {hnd.sideFix.diff < 0 ? 'كمّله من' : 'رجّعه لـ'} درجه</span>}
          {shift.handover && Math.abs(num(hnd.side) - sideExpected(shift, entries)) > 0.009 && <span className="badge bad" style={{ whiteSpace: 'normal' }}>الجانبي مش مظبوط · المفروض {fmt(sideExpected(shift, entries))} واتسلّم {fmt(hnd.side)}</span>}
          {rcv.diffFromPrev && <span className="badge warn" style={{ whiteSpace: 'normal' }}>الكاشير عدّل في الاستلام · اللي قبله سلّم درج {fmt(rcv.prevDrawerTotal)} وجانبي {fmt(rcv.prevSide)}</span>}
          <h2 className="h2" style={{ marginTop: 6 }}>المحافظ {shop?.walletName && <span className="tiny muted" style={{ fontWeight: 500 }}>· انستاباي باسم {shop.walletName}</span>}</h2>
          <div className="spread"><span>انستاباي</span><span><b>{fmt(sum.insta)}</b><CopyBtn value={fmt(sum.insta)} /></span></div>
          <div className="spread"><span>فودافون كاش</span><span><b>{fmt(sum.vf)}</b><CopyBtn value={fmt(sum.vf)} /></span></div>
        </section>
        <section className="card tint-yellow" style={{ flex: '1 1 320px' }}>
          <h2 className="h2">المكن <span className="tiny muted" style={{ fontWeight: 500 }}>· رصيد تراكمي</span></h2>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>الحساب</th><th>استلام</th><th>تسليم</th><th>الفرق</th></tr></thead>
              <tbody>
                {(rcv.machines || []).map((m, i) => {
                  const h = (hnd.machines || []).find((x) => x.machine === m.machine && x.account === m.account);
                  return (
                    <tr key={i}><td><b>{m.machine}</b> {m.account}</td><td>{fmt(m.value)}</td><td>{h ? fmt(h.value) : '—'}</td><td>{h ? fmt(num(h.value) - num(m.value)) : '—'}<CopyBtn value={h ? fmt(num(h.value) - num(m.value)) : 0} /></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {[...new Map((rcv.machines || []).filter((m) => m.ratePct !== undefined).map((m) => [m.machine, m])).values()].map((m) => (
            <span key={m.machine} className="tiny"><b>{m.machine}</b> · نسبة {fmt(m.ratePct)}% {RATE_FROM[m.rateFrom] || ''} · {SETTLE[m.settle] || ''}</span>
          ))}
          {machinePhotos.length > 0 && <span className="tiny muted">صور المكن تحت في قسم الصور</span>}
        </section>
      </div>

      <section className="card" style={{ gap: 0 }}>
        <h2 className="h2" style={{ marginBottom: 8 }}>2. المصروفات والحركات <span className="tiny muted" style={{ fontWeight: 500 }}>· علّم على اللي دخلته على السيستم</span></h2>
        {entries.length === 0 && <div className="empty">مفيش عمليات في الوردية دي</div>}
        {entries.map((e) => {
          const ph = e.photoId && photoOf(e.photoId);
          const name = e.sub || e.reason || e.machine || '';
          return (
            <div key={e.id} className="list-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
                <input type="checkbox" checked={!!e.posted} onChange={() => togglePosted(e)} disabled={!canReview} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />
                <span className="stack" style={{ gap: 1 }}>
                  <span style={{ fontWeight: 700 }}>{entryTitle(e)}{e.newItem && <span className="badge warn" style={{ marginInlineStart: 6 }}>جديد</span>}</span>
                  <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || ''}</span>
                </span>
              </label>
              {ph && <img className="thumb" style={{ width: 44, height: 44 }} src={ph.data} alt="صورة" onClick={() => setView(ph.data)} />}
              {name && <span className="small" style={{ display: 'flex', alignItems: 'center' }}>{name}<CopyBtn value={name} label="نسخ الاسم" /></span>}
              <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 16, minWidth: 90, justifyContent: 'flex-end' }}>{fmt(e.amount)}<CopyBtn value={fmt(e.amount)} label="نسخ المبلغ" /></span>
            </div>
          );
        })}
      </section>

      {photos.length > 0 && (
        <section className="card">
          <div className="spread">
            <h2 className="h2">الصور <span className="tiny muted" style={{ fontWeight: 500 }}>· اتأكد إن الرقم اللي في الصورة هو اللي الكاشير كتبه</span></h2>
            {unchecked > 0 ? <span className="badge warn">فاضل {unchecked} صورة</span> : <span className="badge ok">✓ كل الصور اتراجعت</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {photos.map((p) => {
              const ok = p.check === 'ok', bad = p.check === 'bad';
              const typed = photoTyped(p);
              return (
                <div key={p.id} style={{ background: 'var(--bg)', borderRadius: 20, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, border: `2px solid ${ok ? 'var(--lime)' : bad ? 'var(--red)' : 'transparent'}` }}>
                  <img src={p.data} alt={p.label} onClick={() => setView(p.data)} style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 14, cursor: 'zoom-in', background: '#fff' }} />
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
            <button type="button" className="btn blue full" onClick={close} disabled={busy || sales === ''}><Icon d="check" />تقفيل الوردية وإرسال التقرير</button>
            <span className="tiny muted">التقرير بيوصل للمدير والأونر في صفحة التقارير.</span>
          </section>
        )}
      </div>
      <PhotoView src={view} onClose={() => setView(null)} />
    </div>
  );
}
