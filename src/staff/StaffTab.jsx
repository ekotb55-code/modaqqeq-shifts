import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Modal, useToast } from '../ui.jsx';
import { ROLE_LABEL, WEEKDAYS, isAdminRole } from '../lib';
import { DEFAULT_RULES, deductStr, flexMonth, monthDays, nextDay, rulesOf } from '../attDay.js';
import { todayKey } from '../lib';
import { logPlan, saveSched } from '../attAdmin.js';
import AttendanceView from './AttendanceView.jsx';
import WeekPlan, { canPlan } from './WeekPlan.jsx';

// تاب «الموظفين»: كل حاجة تخص الناس في مكان واحد — جدول المواعيد، الحضور، بيانات كل واحد (ميعاده، إجازته، مرتبه)، وبورد القواعد.
// المرتبات والقواعد لصاحب المحل بس (ومدقق). المدير بيشوف الجدول والحضور ويعدّل المواعيد.
export const isOwner = (profile) => isAdminRole(profile.role) || profile.role === 'owner';

export default function StaffTab({ shops, profile }) {
  const plan = canPlan(profile), own = isOwner(profile);
  const subs = [plan && ['plan', '📅 الجدول'], ['att', '🕒 الحضور'], plan && ['people', '👥 الموظفين'], own && ['rules', '📋 القواعد']].filter(Boolean);
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
      {sub === 'people' && <div className="wrap stack" style={{ gap: 16 }}>{shops.map((sh) => <ShopPeople key={sh.id} shop={sh} profile={profile} />)}</div>}
      {sub === 'rules' && <div className="wrap stack" style={{ gap: 16 }}>{shops.map((sh) => <RulesBoard key={sh.id} shop={sh} profile={profile} />)}</div>}
    </div>
  );
}

// ---------- الموظفين: ميعاد كل واحد ويوم إجازته ومرتبه ----------
export const PAY_TYPES = { monthly: 'مرتب شهري', daily: 'يومية', hourly: 'بالساعة' };
const money = (n) => (n || n === 0 ? `${Number(n).toLocaleString('ar-EG')} ج` : '—');
const h12 = (s) => { if (!s) return '—'; const [h, m] = s.split(':').map(Number); const x = h % 12 || 12; return (m ? `${x}:${String(m).padStart(2, '0')}` : String(x)) + (h < 12 ? ' ص' : ' م'); };
export const payStr = (p) => !p?.type ? 'مش متحدد' : `${PAY_TYPES[p.type]} ${money(p.amount)}${p.perOrder ? ` + ${money(p.perOrder)} للأوردر` : ''}`;

function ShopPeople({ shop, profile }) {
  const toast = useToast();
  const own = isOwner(profile);
  const [pub, setPub] = useState(null);
  const [sched, setSched] = useState(null);
  const [pay, setPay] = useState(null);
  const [edit, setEdit] = useState(null);
  const [month, setMonth] = useState(null);
  const anyFlex = !!sched && Object.values(sched.people || {}).some((x) => x?.flex);
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
  const save = async (p, s, py) => {
    await saveSched(profile, shop.id, p, s);
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
              </span>
              <span className="small muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {s.flex ? <span>⏳ مرن · {s.hours} {Number(s.hours) === 1 ? 'ساعة' : 'ساعات'} في اليوم</span> : <>
                  <span>🕒 {s.start ? <bdi>{h12(s.start)} – {h12(s.end)}</bdi> : 'مالوش ميعاد'}</span>
                  <span>🌴 {s.dayOff != null && s.dayOff !== '' ? WEEKDAYS[s.dayOff] : 'مفيش'}</span>
                </>}
                {own && <span>💰 {payStr(pay.people?.[p.uid])}</span>}
                <span style={{ color: 'var(--blue)' }}>تعديل</span>
              </span>
              {s.flex && <FlexBar m={month ? flexMonth(month.filter((r) => r.uid === p.uid), todayKey(), Number(s.hours) || 0) : null} pay={own ? pay.people?.[p.uid] : null} />}
            </button>
          );
        })}
        {people.length === 0 && <span className="muted">مفيش حد في الفرع ده لسه</span>}
      </div>
      <span className="tiny muted">إضافة كاشير أو عامل جديد بتبقى من «الإعداد». هنا بتظبط ميعاده وإجازته{own ? ' ومرتبه' : ''}.{own ? ' المرتبات بتبان لصاحب المحل بس.' : ''}</span>
      {edit && <PersonModal p={edit} s={sched.people?.[edit.uid]} pay={pay.people?.[edit.uid]} own={own} onClose={() => setEdit(null)}
        onSave={(s, py) => save(edit, s, py).then(() => { toast('اتحفظ'); setEdit(null); }).catch((e) => { console.error(e); toast('مش قادرين نحفظ، اتأكد من النت', 'err'); })} />}
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

function PersonModal({ p, s, pay, own, onSave, onClose }) {
  const [flex, setFlex] = useState(!!s?.flex);
  const [hours, setHours] = useState(s?.hours ?? 4);
  const [f, setF] = useState({ start: s?.start || '', end: s?.end || '', dayOff: s?.dayOff ?? null });
  const [py, setPy] = useState({ type: pay?.type || 'monthly', amount: pay?.amount ?? '', perOrder: pay?.perOrder ?? '' });
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    const payOut = own ? { type: py.type, amount: Number(py.amount) || 0, perOrder: Number(py.perOrder) || 0 } : null;
    onSave(flex ? { flex: true, hours: Number(hours) || 0, start: '', end: '', dayOff: null } : { flex: false, start: f.start, end: f.end, dayOff: f.dayOff }, payOut).finally(() => setBusy(false));
  };
  const unit = { monthly: 'في الشهر', daily: 'في اليوم', hourly: 'في الساعة' }[py.type];
  return (
    <Modal title={`${p.name} · ${ROLE_LABEL[p.kind]}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="chips" style={{ gap: 6 }}>
          <button type="button" className={'btn sm ' + (!flex ? '' : 'soft')} onClick={() => setFlex(false)}>🕒 بميعاد</button>
          <button type="button" className={'btn sm ' + (flex ? '' : 'soft')} onClick={() => setFlex(true)}>⏳ مرن (عدد ساعات)</button>
        </div>
        {flex && (
          <>
            <label className="field" style={{ width: 200 }}>كام ساعة في اليوم<input type="number" step="0.5" min="0.5" inputMode="decimal" className="input" dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
            <span className="tiny muted">ييجي في أي وقت، ويقدر يحضر وينصرف أكتر من مرة في اليوم. المطلوب منه في الشهر = الساعات دي × أيام الشهر كلها ({Number(hours) || 0} × 30 = {(Number(hours) || 0) * 30} ساعة في شهر 30 يوم). لو مكمّلش يتخصم الناقص، والساعة = المرتب ÷ ساعات الشهر. مفيش عليه تأخير ولا غياب.</span>
          </>
        )}
        {!flex && <>
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
        {own && (
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
        <button type="button" className="btn" disabled={busy || (flex ? !(Number(hours) > 0) : (f.start && !f.end) || (!f.start && f.end))} onClick={go}>{busy ? 'لحظة…' : 'حفظ'}</button>
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
