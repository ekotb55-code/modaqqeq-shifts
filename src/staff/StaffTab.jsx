import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Modal, useToast } from '../ui.jsx';
import { ROLE_LABEL, WEEKDAYS, isAdminRole } from '../lib';
import { DEFAULT_RULES, deductStr, rulesOf } from '../attDay.js';
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
                <span>🕒 {s.start ? <bdi>{h12(s.start)} – {h12(s.end)}</bdi> : 'مالوش ميعاد'}</span>
                <span>🌴 {s.dayOff != null && s.dayOff !== '' ? WEEKDAYS[s.dayOff] : 'مفيش'}</span>
                {own && <span>💰 {payStr(pay.people?.[p.uid])}</span>}
                <span style={{ color: 'var(--blue)' }}>تعديل</span>
              </span>
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

function PersonModal({ p, s, pay, own, onSave, onClose }) {
  const [f, setF] = useState({ start: s?.start || '', end: s?.end || '', dayOff: s?.dayOff ?? null });
  const [py, setPy] = useState({ type: pay?.type || 'monthly', amount: pay?.amount ?? '', perOrder: pay?.perOrder ?? '' });
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    const payOut = own ? { type: py.type, amount: Number(py.amount) || 0, perOrder: Number(py.perOrder) || 0 } : null;
    onSave({ start: f.start, end: f.end, dayOff: f.dayOff }, payOut).finally(() => setBusy(false));
  };
  const unit = { monthly: 'في الشهر', daily: 'في اليوم', hourly: 'في الساعة' }[py.type];
  return (
    <Modal title={`${p.name} · ${ROLE_LABEL[p.kind]}`} onClose={onClose} width={460}>
      <div className="stack" style={{ gap: 12 }}>
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
        <button type="button" className="btn" disabled={busy || (f.start && !f.end) || (!f.start && f.end)} onClick={go}>{busy ? 'لحظة…' : 'حفظ'}</button>
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
