import { useState } from 'react';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
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
