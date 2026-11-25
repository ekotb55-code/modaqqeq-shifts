import { useEffect, useState } from 'react';
import { collection, deleteField, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import { allOpen, todayKey } from '../lib';
import { logAct } from '../activity.js';

// 🗑 مسح بيانات قديمة (للإدارة بس): كل الورديات قبل يوم معيّن بكل اللي جواها + سطور العجز والزيادة بتاعتها.
// اليوم المختار نفسه بيفضل. الوردية المفتوحة عمرها ما بتتمسح. رصيد الخزن والتحويلات والحضور ميتلمسوش.
export default function PurgeOld({ shop, profile }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (profile?.role !== 'admin') return null;
  return (
    <section className="card" style={{ gap: 10, border: '1px solid #F5C2C2' }}>
      <div className="spread" style={{ gap: 10 }}>
        <span className="stack" style={{ gap: 2 }}>
          <strong>🗑 مسح بيانات قديمة</strong>
          <span className="tiny muted">يمسح ورديات {shop.name} القديمة وسطور العجز والزيادة بتاعتها. المسح نهائي.</span>
        </span>
        <button type="button" className="btn soft sm" style={{ color: '#B3261E' }} onClick={() => setOpen(true)}><Icon d="trash" size={16} />مسح بيانات قديمة</button>
      </div>
      {open && <PurgeModal shop={shop} profile={profile} onClose={() => setOpen(false)} toast={toast} />}
    </section>
  );
}

function PurgeModal({ shop, profile, onClose, toast }) {
  const [before, setBefore] = useState(todayKey());
  const [plan, setPlan] = useState(null); // { shifts: [...], ledger: [...] }
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState('');
  const [done, setDone] = useState(0);
  const openIds = new Set(allOpen(shop).map((x) => x.id));

  const count = async () => {
    setBusy(true); setPlan(null); setWord('');
    try {
      const [s, l] = await Promise.all([
        getDocs(query(collection(db, 'shifts'), where('shopId', '==', shop.id))),
        getDocs(query(collection(db, 'ledger'), where('shopId', '==', shop.id))),
      ]);
      const old = (d) => String(d.data().day || '9999') < before;
      const shifts = s.docs.filter((d) => old(d) && !openIds.has(d.id) && d.data().status !== 'open').map((d) => d.id);
      const ids = new Set(shifts);
      setPlan({ shifts, ledger: l.docs.filter((d) => old(d) && !ids.has(d.id)).map((d) => d.id) });
    } catch (e) { console.error(e); toast('مقدرناش نعدّ · جرّب تاني', 'err'); }
    setBusy(false);
  };

  const go = async () => {
    if (word.trim() !== 'امسح') { toast('اكتب كلمة «امسح» الأول', 'err'); return; }
    setBusy(true); setDone(0);
    try {
      // كل وردية: العمليات والرسايل والصور اللي جواها، وبعدين المراجعة والوردية نفسها
      let n = 0;
      for (const id of plan.shifts) {
        const subs = await Promise.all(['entries', 'messages', 'photos'].map((c) => getDocs(collection(db, 'shifts', id, c))));
        const refs = subs.flatMap((q) => q.docs.map((d) => d.ref));
        refs.push(doc(db, 'reviews', id), doc(db, 'ledger', id), doc(db, 'shifts', id));
        for (let i = 0; i < refs.length; i += 400) {
          const b = writeBatch(db);
          refs.slice(i, i + 400).forEach((r) => b.delete(r));
          await b.commit();
        }
        n += 1; setDone(n);
      }
      // سطور عجز/زيادة قديمة ملهاش وردية
      for (let i = 0; i < plan.ledger.length; i += 400) {
        const b = writeBatch(db);
        plan.ledger.slice(i, i + 400).forEach((id) => b.delete(doc(db, 'ledger', id)));
        await b.commit();
      }
      logAct('purge', `مسح بيانات ${shop.name} القديمة قبل ${before} · ${plan.shifts.length} وردية · ${plan.ledger.length} سطر عجز وزيادة`, { shopId: shop.id });
      toast(`اتمسح ✓ · ${plan.shifts.length} وردية`);
      onClose();
    } catch (e) {
      console.error(e);
      toast(`المسح وقف في النص (${done} وردية اتمسحت) · جرّب تاني`, 'err');
      setBusy(false);
    }
  };

  return (
    <Modal title="مسح بيانات قديمة" icon="trash" color="#B3261E" onClose={busy ? () => {} : onClose} width={480}>
      <span className="small" style={{ lineHeight: 1.8 }}>
        هيتمسح من <b>{shop.name}</b> كل الورديات اللي <b>قبل</b> اليوم اللي تختاره (اليوم نفسه بيفضل)، بكل عملياتها ومراجعتها ورسايلها،
        وسطور العجز والزيادة بتاعتها. الوردية المفتوحة دلوقتي مش هتتمسح، ورصيد الخزن والتحويلات والحضور مش هيتلمسوا.
      </span>
      <label className="field">امسح كل اللي قبل يوم
        <input className="input" type="date" value={before} max={todayKey()} onChange={(e) => { setBefore(e.target.value); setPlan(null); }} disabled={busy} />
      </label>
      {!plan && <button type="button" className="btn soft full" onClick={count} disabled={busy || !before}>{busy ? 'بيعدّ…' : 'شوف هيتمسح إيه'}</button>}
      {plan && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="card" style={{ background: '#FFF1F1', gap: 4 }}>
            <strong>هيتمسح: {plan.shifts.length} وردية (بالعجز والزيادة بتاعها){plan.ledger.length ? ` · ${plan.ledger.length} سطر عجز وزيادة تاني` : ''}</strong>
            <span className="tiny muted">كل اللي قبل {before} في {shop.name}</span>
          </div>
          {plan.shifts.length + plan.ledger.length === 0 ? <span className="small muted">مفيش حاجة قبل اليوم ده.</span> : (
            <>
              <label className="field">المسح نهائي ومينفعش يرجع. اكتب «امسح» علشان تأكد
                <input className="input" value={word} onChange={(e) => setWord(e.target.value)} placeholder="امسح" disabled={busy} />
              </label>
              <button type="button" className="btn full" style={{ background: '#B3261E' }} onClick={go} disabled={busy || word.trim() !== 'امسح'}>
                {busy ? `بيمسح… ${done} من ${plan.shifts.length}` : 'امسح نهائي'}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ♻️ صفّر عمليات المحل وابدأ من جديد (للإدارة بس، بالباسورد): العمليات بس، الإعدادات بتفضل.
export function ResetShop({ shop, profile }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (profile?.role !== 'admin') return null;
  return (
    <section className="card" style={{ gap: 10, border: '1px solid #F5C2C2', background: '#FFF7F7' }}>
      <div className="spread" style={{ gap: 10 }}>
        <span className="stack" style={{ gap: 2 }}>
          <strong>♻️ صفّر عمليات المحل وابدأ من جديد</strong>
          <span className="tiny muted">للمحلات التجربة: يمسح كل عمليات {shop.name} ويسيب الإعدادات. بالباسورد، ونهائي.</span>
        </span>
        <button type="button" className="btn sm" style={{ background: '#B3261E' }} onClick={() => setOpen(true)}>صفّر المحل</button>
      </div>
      {open && <ResetModal shop={shop} profile={profile} onClose={() => setOpen(false)} toast={toast} />}
    </section>
  );
}

async function delRefs(refs, onStep) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
    onStep?.(Math.min(i + 400, refs.length));
  }
}

function ResetModal({ shop, profile, onClose, toast }) {
  const [plan, setPlan] = useState(null);
  const [att, setAtt] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const byShop = (c) => getDocs(query(collection(db, c), where('shopId', '==', shop.id)));

  useEffect(() => {
    (async () => {
      try {
        const [shifts, reviews, ledger, walletIn, transfers, attendance, attDays, repLog] = await Promise.all([
          byShop('shifts'), byShop('reviews'), byShop('ledger'), byShop('walletIn'), byShop('transfers'), byShop('attendance'), byShop('attDays'),
          getDocs(collection(db, 'repDebts', shop.id, 'log')),
        ]);
        setPlan({ shifts, reviews, ledger, walletIn, transfers, attendance, attDays, repLog });
      } catch (e) { console.error(e); toast('مقدرناش نعدّ العمليات · جرّب تاني', 'err'); onClose(); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (!pass) { toast('اكتب الباسورد', 'err'); return; }
    setBusy(true);
    try {
      setStep('بيتأكد من الباسورد…');
      const u = auth.currentUser;
      try { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pass)); }
      catch { toast('الباسورد غلط', 'err'); setBusy(false); setStep(''); return; }

      // 1) اقفل الورديات المفتوحة الأول وصفّر اللي على المحل، علشان محدش يكمّل على وردية بتتمسح
      setStep('بيصفّر المحل…');
      await updateDoc(doc(db, 'shops', shop.id), {
        openShift: null, openShifts: deleteField(), lastHandover: null, lastHandovers: deleteField(), vaultBalances: deleteField(),
        resetAt: serverTimestamp(), resetBy: profile.name,
      });
      // 2) الورديات بكل اللي جواها
      let n = 0;
      for (const s of plan.shifts.docs) {
        const subs = await Promise.all(['entries', 'messages', 'photos'].map((c) => getDocs(collection(db, 'shifts', s.id, c))));
        await delRefs([...subs.flatMap((q) => q.docs.map((d) => d.ref)), s.ref]);
        n += 1; setStep(`بيمسح الورديات… ${n} من ${plan.shifts.size}`);
      }
      // 3) الباقي
      setStep('بيمسح العجز والتحويلات…');
      await delRefs([...plan.reviews.docs, ...plan.ledger.docs, ...plan.walletIn.docs, ...plan.transfers.docs, ...plan.repLog.docs].map((d) => d.ref));
      await setDoc(doc(db, 'repDebts', shop.id), { machines: {}, atMs: Date.now() }, { merge: false });
      if (att) { setStep('بيمسح الحضور…'); await delRefs([...plan.attendance.docs, ...plan.attDays.docs].map((d) => d.ref)); }

      logAct('reset_shop', `صفّر عمليات ${shop.name} وبدأه من جديد · ${plan.shifts.size} وردية · ${plan.ledger.size} عجز وزيادة · ${plan.walletIn.size} تحويل${att ? ` · ${plan.attendance.size} حضور` : ''}`, { shopId: shop.id });
      toast(`✓ ${shop.name} اتصفّر وبدأ من جديد`);
      onClose();
    } catch (e) {
      console.error(e);
      toast('التصفير وقف في النص · دوس «صفّر المحل» تاني يكمّل الباقي', 'err');
      setBusy(false); setStep('');
    }
  };

  const Line = ({ t, n }) => <span className="spread small"><span>{t}</span><b>{n}</b></span>;
  return (
    <Modal title={`صفّر ${shop.name}`} icon="trash" color="#B3261E" onClose={busy ? () => {} : onClose} width={500}>
      {!plan ? <span className="muted">بيعدّ العمليات…</span> : (
        <>
          <div className="card" style={{ background: '#FFF1F1', gap: 6 }}>
            <strong>هيتمسح نهائي:</strong>
            <Line t="الورديات (بعملياتها ومراجعاتها ورسايلها وصورها)" n={plan.shifts.size} />
            <Line t="سطور العجز والزيادة" n={plan.ledger.size} />
            <Line t="تحويلات انستاباي وفودافون اللي وصلت" n={plan.walletIn.size} />
            <Line t="فلوس اتبعتت بين الكاشيرية" n={plan.transfers.size} />
            <Line t="حركات مديونيات المناديب" n={plan.repLog.size} />
            <span className="tiny muted">وكمان: الوردية المفتوحة، آخر تسليم (أول كاشير يستلم من صفر)، وأرصدة الخزن الرئيسية ترجع صفر.</span>
          </div>
          <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} disabled={busy} />
            <span className="small">امسح الحضور والانصراف كمان ({plan.attendance.size} تسجيل)</span>
          </label>
          <span className="tiny muted" style={{ lineHeight: 1.7 }}>بيفضل زي ما هو: إعدادات المحل (الاسم، اللوجو، المكن، المحافظ، الخزن، المصروفات)، الموظفين والأكونتات، ربط المحافظ والرسايل، وسجل الدخول.</span>
          <label className="field">باسورد أكونتك ({auth.currentUser?.email})
            <input className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
          </label>
          <button type="button" className="btn full" style={{ background: '#B3261E' }} onClick={go} disabled={busy || !pass}>{busy ? step || 'بيصفّر…' : 'صفّر المحل نهائي'}</button>
        </>
      )}
    </Modal>
  );
}
