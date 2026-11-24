import { useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, Icon, useToast } from '../ui.jsx';
import { AVATAR_BG, USERNAME_RE, WEEKDAYS, cashierEmail, cashierPassword, createAccount, normUsername, todayKey } from '../lib';
import { logAct } from '../activity.js';

// العمال: حساب بدور «عامل» (worker). بيدخل زي الكاشير باسم دخول ورقم سري 4 أرقام،
// بس مالوش أي صلاحية على الفلوس أو الورديات (قواعد Firestore بتمنعه من بيانات المحل).
// بيانات الجرد اليومي: canCount (بيجرد ولا لأ) و quota (كام صنف في اليوم) ومواعيده.
export const DEFAULT_QUOTA = 25;

const box = { background: 'rgba(255,255,255,.85)', borderRadius: 22, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' };
const chk = { width: 20, height: 20, accentColor: 'var(--blue)' };

function ScheduleFields({ f, set }) {
  return (
    <>
      <label className="field" style={{ width: 120 }}>بيبدأ الساعة<input type="time" className="input" dir="ltr" value={f.start || ''} onChange={(e) => set('start', e.target.value)} /></label>
      <label className="field" style={{ width: 120 }}>بيخلص الساعة<input type="time" className="input" dir="ltr" value={f.end || ''} onChange={(e) => set('end', e.target.value)} /></label>
      <label className="field" style={{ width: 120 }}>يوم الإجازة
        <select className="input" value={f.dayOff ?? ''} onChange={(e) => set('dayOff', e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">—</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </label>
      <label className="field" style={{ width: 130 }}>بيجرد؟
        <span className="chips" style={{ gap: 6, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={!!f.canCount} onChange={(e) => set('canCount', e.target.checked)} style={chk} />{f.canCount ? 'أيوه' : 'لأ'}
        </span>
      </label>
      {f.canCount && (
        <label className="field" style={{ width: 120 }}>حصته في اليوم (صنف)<input className="input" inputMode="numeric" dir="ltr" value={f.quota ?? ''} onChange={(e) => set('quota', Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>
      )}
    </>
  );
}

const EMPTY = { name: '', username: '', pin: '', phone: '', start: '', end: '', dayOff: null, canCount: true, quota: DEFAULT_QUOTA };

export default function Workers({ shop, pub }) {
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [color, setColor] = useState(AVATAR_BG[2]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const all = pub?.workers || [];
  const active = all.filter((w) => !w.disabled);
  const stopped = all.filter((w) => w.disabled);
  const writeList = (list) => setDoc(doc(db, 'shopsPublic', shop.id), { workers: list }, { merge: true });

  const add = async () => {
    if (!f.name.trim()) { toast('اكتب اسم العامل', 'err'); return; }
    const un = normUsername(f.username);
    if (!USERNAME_RE.test(un)) { toast('اسم الدخول كلمة واحدة من غير رموز (حرفين على الأقل)، زي أحمد أو ahmed أو رقم موبايله', 'err'); return; }
    if (!/^[0-9]{4}$/.test(f.pin)) { toast('الرقم السري لازم 4 أرقام', 'err'); return; }
    setBusy(true);
    try {
      const email = cashierEmail(un);
      const uid = await createAccount(email, cashierPassword(f.pin));
      const w = { uid, name: f.name.trim(), username: un, color };
      await setDoc(doc(db, 'users', uid), {
        role: 'worker', name: w.name, username: un, email, color, phone: f.phone.trim(),
        start: f.start, end: f.end, dayOff: f.dayOff, canCount: !!f.canCount, quota: f.canCount ? (Number(f.quota) || 0) : 0,
        startDate: todayKey(), shopIds: [shop.id], shopName: shop.name || '', createdAt: serverTimestamp(),
      });
      setDoc(doc(db, 'cashierSecrets', uid), { pin: f.pin, updatedAt: serverTimestamp() }).catch(() => {});
      await writeList([...all, w]);
      logAct('staff_add', `ضاف العامل ${w.name} (${un}) في ${shop.name}`, { shopId: shop.id });
      toast(`${w.name} اتضاف · يدخل بـ ${un} والرقم السري ${f.pin}`);
      setF(EMPTY);
    } catch (e) {
      console.error(e);
      toast(e.code === 'auth/email-already-in-use' ? `اسم الدخول ${un} مستخدم قبل كده، اختار اسم تاني` : 'مش قادرين نضيف العامل، اتأكد من النت', 'err');
    }
    setBusy(false);
  };

  const row = (w) => <WorkerRow key={w.uid} w={w} all={all} writeList={writeList} open={open === w.uid} onToggle={() => setOpen(open === w.uid ? null : w.uid)} />;
  return (
    <section className="card tint-orange">
      <h2 className="h2">العمال</h2>
      <label className="chips" style={{ gap: 8, alignItems: 'center', background: 'rgba(255,255,255,.85)', borderRadius: 18, padding: '10px 14px' }}>
        <input type="checkbox" style={chk} checked={!!pub?.attendance} onChange={(e) => setDoc(doc(db, 'shopsPublic', shop.id), { attendance: e.target.checked }, { merge: true })
          .then(() => logAct('staff_edit', `${e.target.checked ? 'شغّل' : 'وقّف'} الحضور والانصراف في ${shop.name}`, { shopId: shop.id }))
          .catch(() => toast('مش قادرين نحفظ، اتأكد من النت', 'err'))} />
        <span className="stack" style={{ gap: 0 }}><strong>الحضور والانصراف على جهاز الفرع</strong>
          <span className="tiny muted">زرار «حضور / انصراف» بيظهر على كمبيوتر الكاشير (بعد ما الكاشير يفتح البرنامج مرة). الكاشيرية والعمال بيسجلوا بالرقم السري وصورة من الكاميرا.</span></span>
      </label>
      <div className="stack">
        {active.map(row)}
        {active.length === 0 && <span className="muted small">لسه مفيش عمال</span>}
        {stopped.length > 0 && <span className="small muted" style={{ marginTop: 6 }}>موقوفين</span>}
        {stopped.map(row)}
      </div>
      <div style={box}>
        <Avatar name={f.name} color={color} size={52} />
        <label className="field" style={{ flex: '1 1 170px' }}>الاسم<input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>اسم الدخول<input className="input" dir="auto" autoCapitalize="none" placeholder="أحمد أو 010…" value={f.username} onChange={(e) => set('username', e.target.value)} /></label>
        <label className="field" style={{ width: 120 }}>الرقم السري (4 أرقام)<input className="input" inputMode="numeric" maxLength={4} dir="ltr" value={f.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} /></label>
        <label className="field" style={{ width: 150 }}>الموبايل<input className="input" inputMode="tel" dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <ScheduleFields f={f} set={set} />
        <div className="chips" style={{ gap: 6 }} role="group" aria-label="اللون">
          {AVATAR_BG.map((c) => <button key={c} type="button" aria-label={`لون ${c}`} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 999, background: c, border: color === c ? '3px solid var(--ink)' : '3px solid #fff' }} />)}
        </div>
        <button type="button" className="btn sm" onClick={add} disabled={busy}><Icon d="plus" size={16} />{busy ? 'لحظة…' : 'إضافة عامل'}</button>
      </div>
      <span className="tiny muted">العامل بيدخل من صفحة الدخول باسم الدخول والرقم السري زي الكاشير، بس مش بيشوف فلوس ولا ورديات. «الحصة» = كام صنف يجرده في اليوم، وتتظبط بعدين على حسب سرعته.</span>
    </section>
  );
}

function WorkerRow({ w, all, writeList, open, onToggle }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  const toggle = async () => {
    if (!open && !form) {
      try {
        const d = (await getDoc(doc(db, 'users', w.uid))).data() || {};
        setForm({ phone: d.phone || '', start: d.start || '', end: d.end || '', dayOff: d.dayOff ?? null, canCount: !!d.canCount, quota: d.quota ?? DEFAULT_QUOTA });
      } catch { setForm({ ...EMPTY }); }
    }
    onToggle();
  };
  const save = async () => {
    try {
      await updateDoc(doc(db, 'users', w.uid), { ...form, quota: form.canCount ? (Number(form.quota) || 0) : 0 });
      logAct('staff_edit', `عدّل بيانات العامل ${w.name}`);
      toast('اتحفظ');
    } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  const setDisabled = async (disabled) => {
    if (disabled && !window.confirm(`توقف ${w.name}؟ مش هيقدر يدخل.`)) return;
    try {
      await updateDoc(doc(db, 'users', w.uid), { disabled });
      await writeList(all.map((x) => (x.uid === w.uid ? { ...x, disabled } : x)));
      logAct('staff_edit', `${disabled ? 'وقّف' : 'رجّع'} العامل ${w.name}`);
    } catch { toast('مش قادرين نغيّر، اتأكد من النت', 'err'); }
  };

  return (
    <div className="stack" style={{ background: 'rgba(255,255,255,.7)', borderRadius: 18, padding: 10, gap: 8, opacity: w.disabled ? 0.6 : 1 }}>
      <button type="button" className="spread" onClick={toggle} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'start', width: '100%' }}>
        <span className="chips" style={{ gap: 10, alignItems: 'center' }}><Avatar name={w.name} color={w.color} size={40} /><strong>{w.name}</strong><span className="muted small" dir="auto">{w.username}</span></span>
        <span className="muted small">{open ? 'اقفل' : 'التفاصيل'}</span>
      </button>
      {open && form && (
        <div style={box}>
          <label className="field" style={{ width: 150 }}>الموبايل<input className="input" inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <ScheduleFields f={form} set={set} />
          <button type="button" className="btn sm" onClick={save}>حفظ</button>
          <button type="button" className="link" onClick={() => setDisabled(!w.disabled)}>{w.disabled ? 'رجّعه تاني' : 'وقّفه'}</button>
        </div>
      )}
    </div>
  );
}
