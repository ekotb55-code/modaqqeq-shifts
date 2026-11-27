import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Modal, useToast } from '../ui.jsx';
import { ROLE_LABEL, WEEKDAYS, isAdminRole } from '../lib';
import { DEFAULT_RULES, deductStr, flexMonth, jokerMonth, jokerRate, monthDays, nextDay, rulesOf } from '../attDay.js';
import { todayKey } from '../lib';
import { approveDevice, logPlan, removeDevice, saveJoker, saveSched, setAttLock } from '../attAdmin.js';
import { devKey, markApproved } from '../attendance.js';
import AttendanceView from './AttendanceView.jsx';
import WeekPlan, { canPlan } from './WeekPlan.jsx';

// تاب «الموظفين»: كل حاجة تخص الناس في مكان واحد — جدول المواعيد، الحضور، بيانات كل واحد (ميعاده، إجازته، مرتبه)، وبورد القواعد.
// المرتبات والقواعد لصاحب المحل بس (ومدقق). المدير بيشوف الجدول والحضور ويعدّل المواعيد.
export const isOwner = (profile) => isAdminRole(profile.role) || profile.role === 'owner';

export default function StaffTab({ shops, allShops, profile }) {
  const plan = canPlan(profile), own = isOwner(profile);
  const subs = [plan && ['plan', '📅 الجدول'], ['att', '🕒 الحضور'], plan && ['people', '👥 الموظفين'], own && ['rules', '📋 القواعد'], own && ['devices', '🖥️ الأجهزة']].filter(Boolean);
  const [sub, setSub] = useState(subs[0][0]);
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="wrap" style={{ paddingBottom: 0 }}>
        <div className="chips" style={{ gap: 6 }}>
          {subs.map(([id, label]) => <button key={id} type="button" className={'btn sm ' + (sub === id ? '' : 'soft')} onClick={() => setSub(id)}>{label}</button>)}
        </div>
      </div>
      {sub === 'plan' && <WeekPlan shops={shops} profile={profile} />}
      {sub === 'att' && <AttendanceView shops={shops} profile={profile} />}
      {sub === 'people' && <div className="wrap stack" style={{ gap: 16 }}>{shops.map((sh) => <ShopPeople key={sh.id} shop={sh} profile={profile} allShops={allShops || shops} />)}</div>}
      {sub === 'devices' && <div className="wrap stack" style={{ gap: 16 }}>{shops.map((sh) => <DevicesBoard key={sh.id} shop={sh} profile={profile} />)}</div>}
      {sub === 'rules' && <div className="wrap stack" style={{ gap: 16 }}>{shops.map((sh) => <RulesBoard key={sh.id} shop={sh} profile={profile} />)}</div>}
    </div>
  );
}

// ---------- الموظفين: ميعاد كل واحد ويوم إجازته ومرتبه ----------
export const PAY_TYPES = { monthly: 'مرتب شهري', daily: 'يومية', hourly: 'بالساعة' };
const rateStr = (r) => (Math.round(r * 100) / 100).toLocaleString('ar-EG');
// ساعات بكسر عشري للحسابات (99.3 ساعة) علشان الضرب يبقى واضح
const hDec = (h) => (Math.round(h * 10) / 10).toLocaleString('ar-EG');
const money = (n) => (n || n === 0 ? `${Number(n).toLocaleString('ar-EG')} ج` : '—');
const h12 = (s) => { if (!s) return '—'; const [h, m] = s.split(':').map(Number); const x = h % 12 || 12; return (m ? `${x}:${String(m).padStart(2, '0')}` : String(x)) + (h < 12 ? ' ص' : ' م'); };
export const payStr = (p) => !p?.type ? 'مش متحدد' : p.type === 'joker' ? `يومية ${money(p.amount)} لـ ${p.dayHours} ساعات · الساعة ${rateStr(jokerRate(p))} ج` : `${PAY_TYPES[p.type]} ${money(p.amount)}${p.perOrder ? ` + ${money(p.perOrder)} للأوردر` : ''}`;

function ShopPeople({ shop, profile, allShops }) {
  const toast = useToast();
  const own = isOwner(profile);
  const [pub, setPub] = useState(null);
  const [sched, setSched] = useState(null);
  const [pay, setPay] = useState(null);
  const [edit, setEdit] = useState(null);
  const [month, setMonth] = useState(null);
  const anyFlex = !!sched && Object.values(sched.people || {}).some((x) => x?.flex || x?.joker);
  // تسجيلات الشهر ده (يوم يوم، علشان ميحتاجش index) لحساب ساعات المرنين
  useEffect(() => {
    if (!anyFlex) return undefined;
    let dead = false;
    const days = monthDays(todayKey()).filter((d) => d <= todayKey());
    Promise.all([...days, nextDay(days[days.length - 1])].map((d) => getDocs(query(collection(db, 'attendance'), where('shopId', '==', shop.id), where('day', '==', d)))
      .then((q) => q.docs.map((x) => ({ id: x.id, ...x.data() }))).catch(() => [])))
      .then((all) => { if (!dead) setMonth(all.flat()); });
    return () => { dead = true; };
  }, [shop.id, anyFlex]);
  useEffect(() => { getDoc(doc(db, 'shopsPublic', shop.id)).then((s) => setPub(s.data() || {})).catch(() => setPub({})); }, [shop.id]);
  useEffect(() => onSnapshot(doc(db, 'attSched', shop.id), (s) => setSched(s.data() || {}), () => setSched({})), [shop.id]);
  useEffect(() => (own ? onSnapshot(doc(db, 'staffPay', shop.id), (s) => setPay(s.data() || {}), () => setPay({})) : setPay({})), [shop.id, own]);
  if (!pub || !sched || !pay) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const people = [
    ...(pub.cashiers || []).map((p) => ({ ...p, kind: 'cashier' })),
    ...(pub.workers || []).map((p) => ({ ...p, kind: 'worker' })),
  ].filter((p, i, a) => p.uid && !p.disabled && a.findIndex((x) => x.uid === p.uid) === i);
  const save = async (p, s, py, jk) => {
    const was = sched.people?.[p.uid];
    if (jk) { await saveJoker(profile, { person: p, ...jk }); return; }
    // كان جوكر ورجع عادي: يتشال من الفروع التانية
    if (was?.joker && was.shops) await saveJoker(profile, { person: p, home: shop.id, shops: {}, removed: Object.keys(was.shops).filter((x) => x !== shop.id), names: {}, daily: 0, dayHours: 0 });
    await saveSched(profile, shop.id, p, { ...s, joker: false });
    if (own && py) {
      await setDoc(doc(db, 'staffPay', shop.id), { shopId: shop.id, people: { [p.uid]: py } }, { merge: true });
      await logPlan(profile, shop.id, `غيّر مرتب ${p.name}: ${payStr(py)}`, '');
    }
  };
  return (
    <section className="card">
      <h2 className="h2">👥 {pub.name || shop.name}</h2>
      <div className="stack" style={{ gap: 8 }}>
        {people.map((p) => {
          const s = sched.people?.[p.uid] || {};
          return (
            <button key={p.uid} type="button" onClick={() => setEdit(p)} className="spread"
              style={{ border: 0, background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: '10px 12px', cursor: 'pointer', textAlign: 'start', flexWrap: 'wrap', gap: 8 }}>
              <span className="chips" style={{ gap: 8, alignItems: 'center' }}>
                <strong>{p.name}</strong>
                <span className="badge tiny">{ROLE_LABEL[p.kind]}</span>
                {p.joker && p.joker !== shop.id && <span className="badge tiny">🃏 من {nameOf(allShops, p.joker)}</span>}
              </span>
              <span className="small muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {s.joker ? <span>🃏 جوكر · {Object.entries(s.shops || { [shop.id]: s.hours }).map(([id, h]) => `${nameOf(allShops, id)}${Number(h) ? ` ${h} س` : ''}`).join(' · ')}</span> : s.flex ? <span>⏳ مرن · {s.hours} {Number(s.hours) === 1 ? 'ساعة' : 'ساعات'} في اليوم</span> : <>
                  <span>🕒 {s.start ? <bdi>{h12(s.start)} – {h12(s.end)}</bdi> : 'مالوش ميعاد'}</span>
                  <span>🌴 {s.dayOff != null && s.dayOff !== '' ? WEEKDAYS[s.dayOff] : 'مفيش'}</span>
                </>}
                {own && <span>💰 {payStr(pay.people?.[p.uid])}</span>}
                <span style={{ color: 'var(--blue)' }}>تعديل</span>
              </span>
              {s.joker && <JokerBar m={month ? jokerMonth({ uid: p.uid, records: month.filter((r) => r.uid === p.uid), day: todayKey(), sched, dayDocs: {}, rules: null, pay: pay.people?.[p.uid] }) : null} own={own} />}
              {s.flex && <FlexBar m={month ? flexMonth(month.filter((r) => r.uid === p.uid), todayKey(), Number(s.hours) || 0) : null} pay={own ? pay.people?.[p.uid] : null} />}
            </button>
          );
        })}
        {people.length === 0 && <span className="muted">مفيش حد في الفرع ده لسه</span>}
      </div>
      <span className="tiny muted">إضافة كاشير أو عامل جديد بتبقى من «الإعداد». هنا بتظبط ميعاده وإجازته{own ? ' ومرتبه' : ''}.{own ? ' المرتبات بتبان لصاحب المحل بس.' : ''}</span>
      {edit && <PersonModal p={edit} s={sched.people?.[edit.uid]} pay={pay.people?.[edit.uid]} own={own} shop={shop} allShops={allShops} profile={profile} onClose={() => setEdit(null)}
        onSave={(s, py, jk) => save(edit, s, py, jk).then(() => { toast('اتحفظ'); setEdit(null); }).catch((e) => { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); })} />}
    </section>
  );
}

// المرن: اشتغل كام من المطلوب في الشهر، والمطلوب لحد النهارده، والخصم المتوقع لو الشهر خلص كده
const hStr = (h) => { const m = Math.round(h * 60); const a = Math.floor(m / 60), b = m % 60; return b ? `${a}:${String(b).padStart(2, '0')}` : String(a); };
export function FlexBar({ m, pay }) {
  if (!m) return <span className="tiny muted" style={{ width: '100%' }}>بنحسب ساعات الشهر…</span>;
  const pct = m.target ? Math.min(100, (m.worked / m.target) * 100) : 0;
  const behind = m.worked < m.dueSoFar - 0.01;
  const rate = pay?.type === 'monthly' && m.target ? pay.amount / m.target : pay?.type === 'hourly' ? pay.amount : null;
  const missing = Math.max(0, m.target - m.worked);
  return (
    <span className="stack" style={{ width: '100%', gap: 4 }}>
      <span className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>اشتغل <strong>{hStr(m.worked)}</strong> من <strong>{hStr(m.target)}</strong> ساعة الشهر ده</span>
        <span style={{ color: behind ? '#e53935' : '#2e9e5b' }}>{behind ? `متأخر ${hStr(m.dueSoFar - m.worked)} ساعة عن المطلوب لحد النهارده` : '✓ ماشي تمام'}</span>
      </span>
      <span style={{ height: 8, borderRadius: 4, background: 'rgba(0,0,0,.07)', overflow: 'hidden', position: 'relative' }}>
        <span style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: pct + '%', background: behind ? '#f59e0b' : '#2e9e5b' }} />
        <span style={{ position: 'absolute', insetInlineStart: `${Math.min(100, (m.dueSoFar / (m.target || 1)) * 100)}%`, top: -2, bottom: -2, borderInlineStart: '2px solid var(--blue)' }} />
      </span>
      {rate && missing > 0 && pay?.type === 'monthly' && <span className="tiny muted">لو الشهر خلص كده: ناقص {hStr(missing)} ساعة ≈ خصم {Math.round(missing * rate).toLocaleString('ar-EG')} ج (الساعة = المرتب ÷ {hStr(m.target)})</span>}
    </span>
  );
}

const nameOf = (shops, id) => shops?.find((x) => x.id === id)?.name || 'فرع تاني';

// الجوكر في الفرع ده: اشتغل كام ساعة هنا الشهر ده (ومن المطلوب لو ليه ساعات مطلوبة هنا)
function JokerBar({ m, own }) {
  if (!m) return <span className="tiny muted" style={{ width: '100%' }}>بنحسب ساعات الشهر…</span>;
  if (m.hours) return <span className="stack" style={{ width: '100%', gap: 2 }}><FlexBar m={m} />{own && m.rate > 0 && <span className="tiny muted">المحسوب هنا لحد دلوقتي: {hDec(m.paidH)} ساعة × {rateStr(m.rate)} = {Math.round(m.gross).toLocaleString('ar-EG')} ج{m.over > 0 ? ` · ${hDec(m.over)} ساعة زيادة عن المطلوب مش محسوبة` : ''}</span>}</span>;
  return <span className="small" style={{ width: '100%' }}>اشتغل هنا <strong>{hDec(m.worked)}</strong> ساعة الشهر ده{own && m.rate > 0 ? ` · ${Math.round(m.gross).toLocaleString('ar-EG')} ج` : ''}</span>;
}

// حساب الجوكر في كل فروعه الشهر ده + الإجمالي (صاحب المحل بس)
function JokerMonth({ uid, shopIds, allShops }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let dead = false;
    const today = todayKey();
    const days = monthDays(today);
    const upTo = days.filter((d) => d <= today);
    const chunks = [days.slice(0, 16), [...days.slice(16), nextDay(days[days.length - 1])]];
    Promise.all(shopIds.map(async (id) => {
      const [recs, dd, sc, ru, py] = await Promise.all([
        Promise.all(chunks.map((ch) => getDocs(query(collection(db, 'attendance'), where('shopId', '==', id), where('uid', '==', uid), where('day', 'in', ch))).then((q) => q.docs.map((x) => ({ id: x.id, ...x.data() }))))).then((a) => a.flat()),
        Promise.all(upTo.map((d) => getDoc(doc(db, 'attDays', `${id}_${d}`)).then((x) => [d, x.data()]).catch(() => [d, null]))).then((a) => Object.fromEntries(a.filter((x) => x[1]))),
        getDoc(doc(db, 'attSched', id)).then((x) => x.data() || {}),
        getDoc(doc(db, 'attRules', id)).then((x) => x.data() || null).catch(() => null),
        getDoc(doc(db, 'staffPay', id)).then((x) => x.data()?.people?.[uid] || null).catch(() => null),
      ]);
      return { id, m: jokerMonth({ uid, records: recs, day: today, sched: sc, dayDocs: dd, rules: ru, pay: py }) };
    })).then((r) => { if (!dead) setRows(r); }).catch((e) => { console.error(e); if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [uid, shopIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <span className="tiny muted">بنحسب الشهر في كل الفروع…</span>;
  const tot = rows.reduce((a, { m }) => a + m.net, 0);
  const r0 = (n) => Math.round(n).toLocaleString('ar-EG');
  return (
    <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: 10 }}>
      <strong className="small">🧮 حسابه الشهر ده لحد النهارده</strong>
      {rows.map(({ id, m }) => (
        <div key={id} className="stack" style={{ gap: 2, borderBottom: '1px solid rgba(0,0,0,.06)', paddingBottom: 6 }}>
          <span className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{nameOf(allShops, id)}</strong><strong>{r0(m.net)} ج</strong></span>
          <span className="tiny muted">اشتغل {hDec(m.worked)} ساعة{m.hours ? ` من ${hDec(m.target)} مطلوبة (${m.hours} س × ${m.days} يوم)` : ''} · المحسوب {hDec(m.paidH)} ساعة × {rateStr(m.rate)} ج = {r0(m.gross)} ج</span>
          {m.over > 0 && <span className="tiny muted">{hDec(m.over)} ساعة زيادة عن المطلوب هنا: مش محسوبة ومش أوفر تايم</span>}
          {m.hours > 0 && m.worked < m.dueSoFar - 0.01 && <span className="tiny" style={{ color: '#e53935' }}>متأخر {hDec(m.dueSoFar - m.worked)} ساعة عن المطلوب لحد النهارده</span>}
          {m.ded.map((x) => <span key={x.day} className="tiny" style={{ color: '#e53935' }}>{x.day.slice(5)}: {x.txt} = −{r0(x.money)} ج</span>)}
        </div>
      ))}
      <span className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><strong>الإجمالي</strong><strong>{r0(tot)} ج</strong></span>
      <span className="tiny muted">الساعات المفتوحة (لسه منصرفش) مش محسوبة. كل فرع بيتحسب لوحده.</span>
    </div>
  );
}

function PersonModal({ p, s, pay, own, shop, allShops, profile, onSave, onClose }) {
  const [flex, setFlex] = useState(!!s?.flex);
  const [joker, setJoker] = useState(!!s?.joker);
  const home = s?.home || p.joker || shop.id;
  const [jShops, setJShops] = useState(() => s?.shops || { [shop.id]: s?.hours || 0 });
  const [jPay, setJPay] = useState({ daily: pay?.type === 'joker' ? pay.amount : '', dayHours: pay?.type === 'joker' ? pay.dayHours : 8 });
  const [q, setQ] = useState('');
  // الفروع اللي ينفع يشتغل فيها: فروع صاحب المحل (والإدارة بتشوف الكل)
  const cand = (allShops || []).filter((x) => isAdminRole(profile.role) || (profile.shopIds || []).includes(x.id));
  const [hours, setHours] = useState(s?.hours ?? 4);
  const [f, setF] = useState({ start: s?.start || '', end: s?.end || '', dayOff: s?.dayOff ?? null });
  const [py, setPy] = useState({ type: PAY_TYPES[pay?.type] ? pay.type : 'monthly', amount: PAY_TYPES[pay?.type] ? pay.amount ?? '' : '', perOrder: pay?.perOrder ?? '' });
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    const payOut = own ? { type: py.type, amount: Number(py.amount) || 0, perOrder: Number(py.perOrder) || 0 } : null;
    if (joker) {
      const removed = Object.keys(s?.shops || {}).filter((x) => !(x in jShops));
      onSave(null, null, { home, shops: Object.fromEntries(Object.entries({ ...jShops, [home]: jShops[home] ?? 0 }).map(([k, v]) => [k, Number(v) || 0])), removed, names: Object.fromEntries(cand.map((x) => [x.id, x.name])), daily: jPay.daily, dayHours: jPay.dayHours }).finally(() => setBusy(false));
      return;
    }
    onSave(flex ? { flex: true, hours: Number(hours) || 0, start: '', end: '', dayOff: null } : { flex: false, start: f.start, end: f.end, dayOff: f.dayOff }, payOut).finally(() => setBusy(false));
  };
  const unit = { monthly: 'في الشهر', daily: 'في اليوم', hourly: 'في الساعة' }[py.type];
  return (
    <Modal title={`${p.name} · ${ROLE_LABEL[p.kind]}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="chips" style={{ gap: 6 }}>
          <button type="button" className={'btn sm ' + (!flex && !joker ? '' : 'soft')} onClick={() => { setFlex(false); setJoker(false); }}>🕒 بميعاد</button>
          <button type="button" className={'btn sm ' + (flex && !joker ? '' : 'soft')} onClick={() => { setFlex(true); setJoker(false); }}>⏳ مرن (عدد ساعات)</button>
          {own && <button type="button" className={'btn sm ' + (joker ? '' : 'soft')} onClick={() => setJoker(true)}>🃏 جوكر (كذا فرع)</button>}
        </div>
        {joker && (
          <>
            <span className="tiny muted">الجوكر بيشتغل في كذا فرع وبياخد بالساعة: كل ساعة اشتغلها في أي فرع بتتحسب له هناك. لو حطيته في «📅 الجدول» يوم في فرع، يلتزم بالميعاد ده ويتحسب عليه التأخير والغياب بقواعد الفرع ده. لو كاتب له «ساعات مطلوبة» في فرع، بيتحاسب على الشهر هناك، والزيادة في فرع مبتعوّضش فرع تاني ومش أوفر تايم.</span>
            <strong className="small">بيشتغل في</strong>
            {cand.length > 8 && <input className="input" placeholder="دوّر على فرع" value={q} onChange={(e) => setQ(e.target.value)} />}
            <div className="stack" style={{ gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {cand.filter((x) => x.id === home || x.id in jShops || !q || String(x.name).includes(q)).map((x) => {
                const on = x.id === home || x.id in jShops;
                return (
                  <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: on ? 'rgba(46,158,91,.08)' : 'rgba(0,0,0,.03)', borderRadius: 10, padding: '6px 10px' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={on} disabled={x.id === home} onChange={(e) => setJShops((o) => { const n = { ...o }; if (e.target.checked) n[x.id] = 0; else delete n[x.id]; return n; })} />
                      <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}{x.id === home ? ' (فرعه)' : ''}</span>
                    </label>
                    {on && <>
                      <input type="number" step="0.5" min="0" className="input" dir="ltr" style={{ width: 62, padding: '0 8px' }} value={jShops[x.id] ?? 0} onChange={(e) => setJShops((o) => ({ ...o, [x.id]: e.target.value }))} />
                      <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>س مطلوبة/يوم</span>
                    </>}
                  </div>
                );
              })}
            </div>
            <span className="tiny muted">«0» = مش مطلوب منه ساعات في الفرع ده، أي ساعة يشتغلها هناك بتتحسب.</span>
            <strong className="small">الفلوس</strong>
            <div className="chips" style={{ gap: 10, alignItems: 'flex-end' }}>
              <label className="field" style={{ width: 130 }}>اليومية (ج)<input type="number" inputMode="decimal" className="input" dir="ltr" value={jPay.daily} onChange={(e) => setJPay({ ...jPay, daily: e.target.value })} /></label>
              <label className="field" style={{ width: 130 }}>ساعات اليوم<input type="number" step="0.5" inputMode="decimal" className="input" dir="ltr" value={jPay.dayHours} onChange={(e) => setJPay({ ...jPay, dayHours: e.target.value })} /></label>
              <span className="small" style={{ paddingBottom: 10 }}>الساعة = <strong>{Number(jPay.dayHours) > 0 ? rateStr((Number(jPay.daily) || 0) / Number(jPay.dayHours)) : '—'} ج</strong></span>
            </div>
            {s?.joker && <JokerMonth uid={p.uid} shopIds={Object.keys(s.shops || { [shop.id]: 0 })} allShops={allShops} />}
          </>
        )}
        {flex && !joker && (
          <>
            <label className="field" style={{ width: 200 }}>كام ساعة في اليوم<input type="number" step="0.5" min="0.5" inputMode="decimal" className="input" dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
            <span className="tiny muted">ييجي في أي وقت، ويقدر يحضر وينصرف أكتر من مرة في اليوم. المطلوب منه في الشهر = الساعات دي × أيام الشهر كلها ({Number(hours) || 0} × 30 = {(Number(hours) || 0) * 30} ساعة في شهر 30 يوم). لو مكمّلش يتخصم الناقص، والساعة = المرتب ÷ ساعات الشهر. مفيش عليه تأخير ولا غياب.</span>
          </>
        )}
        {!flex && !joker && <>
        <strong className="small">الميعاد العادي</strong>
        <div className="chips" style={{ gap: 10 }}>
          <label className="field" style={{ width: 125 }}>من<input type="time" className="input" dir="ltr" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label className="field" style={{ width: 125 }}>لـ<input type="time" className="input" dir="ltr" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
          <label className="field" style={{ width: 125 }}>يوم الإجازة
            <select className="input" value={f.dayOff ?? ''} onChange={(e) => setF({ ...f, dayOff: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">مفيش</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        </div>
        <span className="tiny muted">لو عاوز تبدّل الإجازة أو تغيّر الميعاد يوم واحد بس، اعملها من «📅 الجدول».</span>
        </>}
        {own && !joker && (
          <>
            <strong className="small">المرتب</strong>
            <div className="chips" style={{ gap: 6 }}>
              {Object.entries(PAY_TYPES).map(([k, v]) => <button key={k} type="button" className={'btn sm ' + (py.type === k ? '' : 'soft')} onClick={() => setPy({ ...py, type: k })}>{v}</button>)}
            </div>
            <div className="chips" style={{ gap: 10 }}>
              <label className="field" style={{ width: 160 }}>المبلغ ({unit})<input type="number" inputMode="decimal" className="input" dir="ltr" value={py.amount} onChange={(e) => setPy({ ...py, amount: e.target.value })} /></label>
              <label className="field" style={{ width: 160 }}>لكل أوردر (للدليفري)<input type="number" inputMode="decimal" className="input" dir="ltr" placeholder="0" value={py.perOrder} onChange={(e) => setPy({ ...py, perOrder: e.target.value })} /></label>
            </div>
          </>
        )}
        <button type="button" className="btn" disabled={busy || (joker ? !(Number(jPay.daily) > 0 && Number(jPay.dayHours) > 0) : flex ? !(Number(hours) > 0) : (f.start && !f.end) || (!f.start && f.end))} onClick={go}>{busy ? 'لحظة…' : 'حفظ'}</button>
      </div>
    </Modal>
  );
}

// ---------- بورد القواعد: صاحب المحل بيغيّرها براحته ----------
function RulesBoard({ shop, profile }) {
  const toast = useToast();
  const [r, setR] = useState(null);
  const [name, setName] = useState(shop.name || '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { getDoc(doc(db, 'shopsPublic', shop.id)).then((s) => setName(s.data()?.name || shop.name || '')).catch(() => {}); }, [shop.id, shop.name]);
  useEffect(() => onSnapshot(doc(db, 'attRules', shop.id), (s) => { if (!dirty) setR(rulesOf(s.data())); }, () => setR(rulesOf(null))), [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const set = (x) => { setR(x); setDirty(true); };
  const tier = (i, k, v) => set({ ...r, lateTiers: r.lateTiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });
  const save = async () => {
    const out = {
      shopId: shop.id,
      lateTiers: r.lateTiers.filter((t) => Number(t.min) > 0 && Number(t.v) > 0).map((t) => ({ min: Number(t.min), v: Number(t.v), unit: t.unit === 'day' ? 'day' : 'h' })).sort((a, b) => a.min - b.min),
      absentDays: Number(r.absentDays) || 0,
      otMode: r.otMode === 'firstNormal' ? 'firstNormal' : 'double',
    };
    try {
      await setDoc(doc(db, 'attRules', shop.id), out);
      await logPlan(profile, shop.id, `غيّر قواعد الخصم والأوفر تايم: ${out.lateTiers.map((t) => `${t.min} د ← ${deductStr(t)}`).join('، ')} · الغياب ${out.absentDays} يوم · الأوفر تايم ${out.otMode === 'double' ? 'كل ساعة بساعتين' : 'أول ساعة عادي والباقي بساعتين'}`, '');
      setDirty(false); toast('اتحفظ');
    } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); }
  };
  return (
    <section className="card">
      <h2 className="h2">📋 قواعد {name}</h2>
      <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: 12 }}>
        <strong>⏰ التأخير</strong>
        <span className="tiny muted">لو اتأخر الدقايق دي أو أكتر ← يتخصم كده. بنطبّق أكبر صف ينطبق.</span>
        {r.lateTiers.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
            <input type="number" className="input" dir="ltr" style={{ width: 64, padding: '0 8px' }} value={t.min} onChange={(e) => tier(i, 'min', e.target.value)} />
            <span className="small" style={{ whiteSpace: 'nowrap' }}>دقيقة ←</span>
            <input type="number" step="0.5" className="input" dir="ltr" style={{ width: 58, padding: '0 8px' }} value={t.v} onChange={(e) => tier(i, 'v', e.target.value)} />
            <select className="input" style={{ width: 78, padding: '0 6px' }} value={t.unit} onChange={(e) => tier(i, 'unit', e.target.value)}><option value="h">ساعة</option><option value="day">يوم</option></select>
            <button type="button" className="link small" aria-label="امسح الصف" onClick={() => set({ ...r, lateTiers: r.lateTiers.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn sm soft" style={{ alignSelf: 'flex-start' }} onClick={() => set({ ...r, lateTiers: [...r.lateTiers, { min: 60, v: 0.5, unit: 'day' }] })}>＋ صف</button>
      </div>
      <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: 12 }}>
        <strong>🚫 الغياب</strong>
        <div className="chips" style={{ gap: 6, alignItems: 'center' }}>
          <span className="small">الغياب من غير إذن المدير (أو اليوم كله تأخير) = خصم</span>
          <input type="number" step="0.5" className="input" dir="ltr" style={{ width: 64, padding: '0 8px' }} value={r.absentDays} onChange={(e) => set({ ...r, absentDays: e.target.value })} />
          <span className="small">يوم</span>
        </div>
        <span className="tiny muted">لو المدير غيّر يومه لإجازة من «📅 الجدول» قبلها، مبيتحسبش غياب.</span>
      </div>
      <div className="stack" style={{ gap: 6, background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: 12 }}>
        <strong>➕ الأوفر تايم</strong>
        <span className="tiny muted">بيتحسب بس لو المدير وافق عليه (زرار «أوفر تايم» في الحضور). من غير موافقة مبيتحسبش حاجة.</span>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" checked={r.otMode === 'double'} onChange={() => set({ ...r, otMode: 'double' })} /> كل ساعة زيادة بساعتين</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" checked={r.otMode === 'firstNormal'} onChange={() => set({ ...r, otMode: 'firstNormal' })} /> أول ساعة بساعة عادية، والباقي كل ساعة بساعتين</label>
      </div>
      <div className="chips" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={!dirty} onClick={save}>حفظ القواعد</button>
        <button type="button" className="btn soft" onClick={() => set(rulesOf({ ...DEFAULT_RULES }))}>رجّع الافتراضي</button>
      </div>
    </section>
  );
}

// ---------- أجهزة الحضور: الحضور والانصراف من جهاز الفرع بس ----------
const phoneLink = (() => { try { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'att/'; } catch { return 'att/'; } })();
const dateStr = (ms) => (ms ? new Date(ms).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function DevicesBoard({ shop, profile }) {
  const toast = useToast();
  const [pub, setPub] = useState(null);
  const [list, setList] = useState(null);
  const [name, setName] = useState('جهاز الكاشير');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shop.id), (x) => setPub(x.data() || {}), () => setPub({})), [shop.id]);
  useEffect(() => onSnapshot(query(collection(db, 'attDevices'), where('shopId', '==', shop.id)), (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.atLocalMs || 0) - (b.atLocalMs || 0))), () => setList([])), [shop.id]);
  // نخلي علامة «معتمد» على الجهاز ده ماشية مع القايمة (لو اتشال من جهاز تاني)
  useEffect(() => { if (list) { const k = devKey(); markApproved(shop.id, !!k && list.some((d) => d.key === k)); } }, [list, shop.id]);
  if (!pub || !list) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const key = devKey();
  const here = list.find((d) => d.key && d.key === key);
  const lock = !!pub.attLock;
  const sname = pub.name || shop.name;
  const approve = async () => {
    if (list.length && !window.confirm(`الفرع ليه جهاز واحد بس. «${list.map((d) => d.name).join('، ')}» هيتشال والجهاز ده يبقى مكانه. موافق؟`)) return;
    setBusy(true);
    try {
      await approveDevice(profile, shop, name.trim(), list);
      if (!lock && list.length === 0) await setAttLock(profile, shop, true);
      toast(!lock && list.length === 0 ? `الجهاز ده اتعتمد، والحضور في ${sname} بقى من الأجهزة المعتمدة بس` : 'الجهاز ده اتعتمد');
      bump((x) => x + 1);
    } catch (e) { console.error(e); toast('مش قادرين نعتمد الجهاز، اتأكد من النت', 'err'); }
    setBusy(false);
  };
  const remove = async (d) => {
    const last = lock && list.length === 1;
    if (!window.confirm(last ? `ده آخر جهاز معتمد. لو شلته محدش هيقدر يسجّل حضور في ${sname} لحد ما تعتمد جهاز تاني أو تفتح الحضور من أي جهاز. تشيله؟` : `تشيل «${d.name}» من أجهزة الحضور؟`)) return;
    try { await removeDevice(profile, d, key); bump((x) => x + 1); toast('اتشال'); } catch (e) { console.error(e); toast('مش قادرين نشيله، اتأكد من النت', 'err'); }
  };
  const toggle = async (on) => {
    if (on && list.length === 0) { toast('اعتمد جهاز الأول', 'err'); return; }
    try { await setAttLock(profile, shop, on); } catch (e) { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); }
  };
  const row = { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', background: 'rgba(255,255,255,.75)', borderRadius: 14, padding: '10px 12px' };
  return (
    <section className="card">
      <h2 className="h2">🖥️ أجهزة الحضور · {sname}</h2>
      <div className="stack" style={{ gap: 8, background: here ? 'rgba(46,158,91,.10)' : 'rgba(245,158,11,.12)', borderRadius: 14, padding: 12 }}>
        {here ? (
          <strong>✅ الجهاز اللي انت فاتح منه دلوقتي معتمد هنا باسم «{here.name}»</strong>
        ) : (
          <>
            <strong>الجهاز اللي انت فاتح منه دلوقتي مش معتمد للحضور في {sname}</strong>
            <span className="tiny muted">الأسهل: تليفون الحضور (اللينك تحت). أو لو ده الجهاز اللي في الفرع، سمّيه ودوس اعتمد. الفرع ليه جهاز واحد بس، فاعتماد جهاز جديد بيشيل القديم.</span>
            <div className="chips" style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 180px' }}>اسم الجهاز<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <button type="button" className="btn" disabled={busy || !name.trim()} onClick={approve}>{busy ? 'لحظة…' : `✅ اعتمد الجهاز ده لـ ${sname}`}</button>
            </div>
          </>
        )}
      </div>
      <div className="stack" style={{ gap: 4, background: 'rgba(20,121,211,.08)', borderRadius: 14, padding: 12 }}>
        <strong>📱 تليفون الحضور</strong>
        <span className="tiny muted">افتح اللينك ده على تليفون الفرع، وادخل بحسابك واختار {sname}. بعدها من قايمة المتصفح اختار «إضافة إلى الشاشة الرئيسية»، والتليفون هيفتح على الحضور والانصراف بس بكاميرته.</span>
        <span className="chips" style={{ gap: 8, alignItems: 'center' }}>
          <bdi dir="ltr" className="small" style={{ wordBreak: 'break-all' }}>{phoneLink}</bdi>
          <button type="button" className="btn sm soft" onClick={() => navigator.clipboard?.writeText(phoneLink).then(() => toast('اتنسخ'), () => {})}>انسخ</button>
        </span>
      </div>
      <label style={{ ...row, justifyContent: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" style={{ width: 20, height: 20 }} checked={lock} onChange={(e) => toggle(e.target.checked)} />
        <span className="stack" style={{ gap: 0 }}><strong>الحضور والانصراف من الأجهزة المعتمدة بس</strong>
          <span className="tiny muted">{lock ? 'أي جهاز تاني (موبايل أو كمبيوتر في البيت) هيقول «الجهاز ده مش معتمد».' : 'دلوقتي أي جهاز الكاشير فاتح عليه البرنامج يقدر يسجّل حضور.'}</span></span>
      </label>
      <div className="stack" style={{ gap: 6 }}>
        <strong className="small">الجهاز المعتمد (جهاز واحد بس لكل فرع)</strong>
        {list.map((d) => (
          <div key={d.id} style={row}>
            <span className="stack" style={{ gap: 0 }}>
              <strong>{d.name}{d.key === key ? ' · الجهاز ده' : ''}</strong>
              <span className="tiny muted">اعتمده {d.byName || '—'} {dateStr(d.atLocalMs)}</span>
            </span>
            <button type="button" className="link small" style={{ color: '#e53935' }} onClick={() => remove(d)}>شيل</button>
          </div>
        ))}
        {list.length === 0 && <span className="muted small">لسه مفيش أجهزة معتمدة</span>}
      </div>
      <span className="tiny muted">الجوكر بيسجّل من أي جهاز معتمد في الفروع اللي هو فيها. لو حد مسح بيانات المتصفح (السجل والكوكيز) على جهاز الفرع، الجهاز بيبطل يبقى معتمد ولازم تعتمده تاني من هنا.</span>
    </section>
  );
}
