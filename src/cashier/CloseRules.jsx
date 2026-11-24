import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useDraft } from '../ui.jsx';
import { fmt } from '../lib';
import { pushEvent } from '../cloud.js';
import { closeRulesOf, nightState, shopOrders } from '../closeRules.js';

// شروط تقفيل الوردية (بتظهر في شاشة التسليم):
// 1) الأوردرات المفتوحة في برنامج البيع (توصيل للمنزل): مابتمنعش القفل، بس الكاشير بيأكد على كل أوردر
//    إنه هيتسلم بكرة (الوردية الليلية) أو الوردية الجاية هتستلمه.
// 2) الوردية الليلية: مايقفلش قبل المعاد (فيه سماح) إلا بإذن المدير/الأونر (زرار في الإشعار) أو الدعم.
//    الكاشير اللي هو المدير بيقفل لنفسه ويتسجل. لو النت قاطع بيعدّي ويتعلّم للمحاسب يراجع.
// onState({ ready, missing:[], data }) بيقول لشاشة التسليم فاضل إيه وإيه اللي يتحفظ مع التسليم.

const card = (bg) => ({ gap: 10, background: bg });

export default function CloseRules({ shop, shift, profile, cashiers = [], dkey, onState }) {
  const cfg = closeRulesOf(shop);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const opened = shift.openedAt?.toDate ? shift.openedAt.toDate() : (shift.openedAt || shift.openedAtLocal || null);
  const night = nightState(cfg, now, opened);

  // ── الأوردرات ──
  const [orders, setOrders] = useDraft(dkey, 'orders', null); // { list, at } | { failed, msg }
  const [confirmed, setConfirmed] = useDraft(dkey, 'ordersOk', {});
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const j = await shopOrders(cfg);
      setOrders({ list: j.orders || [], at: j.at || new Date().toISOString() });
    } catch (e) {
      setOrders({ failed: true, msg: e.message, at: new Date().toISOString() });
    }
    setLoading(false);
  };
  useEffect(() => { if (cfg.orders && !orders) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cfg.orders]);
  const list = orders?.list || [];
  const later = night.isNight ? 'هيتسلم بكرة' : 'الوردية الجاية هتستلمه';
  const ordersLeft = cfg.orders ? (!orders ? 1 : list.filter((o) => !confirmed[o.no]).length) : 0;

  // ── إذن القفل بدري ──
  const me = cashiers.find((c) => c.uid === profile.id);
  const isMgr = !!me?.isManager;
  const [ask, setAsk] = useState({ status: shift.earlyAskStatus || '', by: shift.earlyAskBy || '' });
  useEffect(() => onSnapshot(doc(db, 'shifts', shift.id), (s) => {
    const d = s.data() || {};
    setAsk({ status: d.earlyAskStatus || '', by: d.earlyAskBy || '' });
  }, () => {}), [shift.id]);
  const [offline, setOffline] = useDraft(dkey, 'earlyOffline', false);
  const early = night.early && ask.status !== 'ok';
  const requestOk = async () => {
    try {
      await updateDoc(doc(db, 'shifts', shift.id), { earlyAskStatus: 'pending', earlyAskAtMs: Date.now(), earlyAskMins: night.minsLeft, earlyAskBy: '', earlyAskByUid: '' });
      pushEvent({ type: 'early_close', shopId: shop.id, shiftId: shift.id, to: 'staff', title: `🌙 ${profile.name} عايز يقفل بدري`, body: `معاد القفل ${cfg.nightClose} · فاضل ${night.minsLeft} دقيقة · دوس «موافق» لو مسموح` });
    } catch { /* offline: هيتبعت لما النت يرجع */ }
  };
  const selfOk = async () => {
    if (!window.confirm(`هتقفل الوردية قبل المعاد بـ ${night.minsLeft} دقيقة على مسؤوليتك كمدير. متأكد؟`)) return;
    try {
      await updateDoc(doc(db, 'shifts', shift.id), { earlyAskStatus: 'ok', earlyAskAtMs: Date.now(), earlyAskMins: night.minsLeft, earlyAskBy: `${profile.name} (المدير بنفسه)`, earlyAskByUid: profile.id, earlyAskByRole: 'self' });
    } catch { /* ignore */ }
  };
  const net = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const missing = [];
  if (ordersLeft > 0) missing.push(orders ? 'أكّد على الأوردرات المفتوحة' : 'استنى الأوردرات');
  if (early && !offline) missing.push(ask.status === 'pending' ? 'مستني إذن المدير' : 'إذن القفل بدري');
  const data = {
    ...(cfg.orders ? { orders: orders?.failed ? { failed: true, msg: orders.msg } : { count: list.length, list: list.map((o) => ({ no: o.no, total: o.total, client: o.client, by: o.by, note: confirmed[o.no] ? later : '' })) } } : {}),
    ...(night.isNight && cfg.nightOn ? { night: { close: cfg.nightClose, minsLeft: night.minsLeft, early: night.early, ok: ask.status === 'ok' ? ask.by : '', offline: early && offline } } : {}),
  };
  const key = JSON.stringify([missing, data]);
  useEffect(() => { onState?.({ missing, data, review: !!(orders?.failed || (early && offline)) }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  if (!cfg.orders && !(cfg.nightOn && night.isNight)) return null;
  return (
    <>
      {cfg.nightOn && night.isNight && night.early && (
        <section className="card" style={card(ask.status === 'ok' ? '#E2FAB0' : '#FFE3A3')}>
          <h2 className="h2">🌙 معاد قفل الوردية الليلية {cfg.nightClose}</h2>
          {ask.status === 'ok' ? (
            <span className="small" style={{ fontWeight: 700, color: '#0E7A4F' }}>✓ {ask.by || 'المدير'} سمح بالقفل بدري</span>
          ) : (
            <>
              <span className="small" style={{ lineHeight: 1.8 }}>لسه فاضل <b>{night.minsLeft} دقيقة</b> على معاد القفل. تقدر تقفل قبل المعاد بـ {cfg.grace} دقايق بس، غير كده لازم المدير يسمح.</span>
              {ask.status === 'pending' && <span className="small" style={{ fontWeight: 700 }}>⏳ الطلب اتبعت للمدير · أول ما يدوس «موافق» الشاشة هتفتح لوحدها</span>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {isMgr
                  ? <button type="button" className="btn" onClick={selfOk}>أنا المدير · اقفل بدري</button>
                  : <button type="button" className="btn" onClick={requestOk} disabled={!net}>{ask.status === 'pending' ? 'ابعت الطلب تاني' : 'اطلب إذن من المدير'}</button>}
                {!net && !offline && <button type="button" className="btn soft" onClick={() => setOffline(true)}>النت قاطع · كمّل والمحاسب يراجع</button>}
              </div>
              {offline && <span className="small" style={{ color: '#8A5A00', fontWeight: 700 }}>⚠️ هتقفل من غير إذن علشان النت قاطع · المحاسب هيراجع الوردية دي</span>}
            </>
          )}
        </section>
      )}
      {cfg.orders && (
        <section className="card" style={card(orders?.failed ? '#FFF3D6' : ordersLeft ? '#FFE3A3' : '#E2FAB0')}>
          <div className="spread">
            <h2 className="h2">🛵 أوردرات التوصيل المفتوحة</h2>
            <button type="button" className="chip sm" onClick={load} disabled={loading}>{loading ? 'بندوّر…' : 'حدّث'}</button>
          </div>
          {!orders && <span className="small">بندوّر في برنامج البيع…</span>}
          {orders?.failed && <span className="small" style={{ color: '#8A5A00', fontWeight: 700, lineHeight: 1.7 }}>⚠️ مقدرناش نشوف الأوردرات ({orders.msg}) · تقدر تقفل، والمحاسب هيراجع الأوردرات</span>}
          {orders && !orders.failed && !list.length && <span className="small" style={{ color: '#0E7A4F', fontWeight: 700 }}>✓ مفيش أوردرات توصيل مفتوحة</span>}
          {list.length > 0 && (
            <>
              <span className="small" style={{ lineHeight: 1.7 }}>لو تقدر توصّلها قبل ما تقفل وصّلها ودوس «تم التوصيل» في البرنامج وبعدين «حدّث». اللي مش هيتسلم دلوقتي أكّد عليه.</span>
              {list.map((o) => (
                <div key={o.no} className="spread small" style={{ background: '#fff', borderRadius: 14, padding: '8px 10px', gap: 8, flexWrap: 'wrap' }}>
                  <span className="stack" style={{ gap: 0 }}>
                    <b>فاتورة {o.no} · {fmt(o.total)} ج</b>
                    <span className="tiny muted">{[o.client, o.by && `بواسطة ${o.by}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" className={'chip sm' + (confirmed[o.no] ? ' on' : '')} aria-pressed={!!confirmed[o.no]} onClick={() => setConfirmed({ ...confirmed, [o.no]: !confirmed[o.no] })}>
                    {confirmed[o.no] ? `✓ ${later}` : later}
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </>
  );
}
