import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { logAct } from '../activity.js';
import { Avatar, Modal, useToast } from '../ui.jsx';
import { todayKey, toDate } from '../lib';
import { FALLBACK, KIND_LABEL, LATE_SYNC_MIN } from '../attendance.js';

// الحضور والانصراف: مين حضر ومين انصرف في يوم معيّن، بالصورة ووقت السيرفر.
// ⚠️ = محتاج مراجعة: من غير صورة، أو اتسجل من غير نت / ساعة الجهاز غلط، أو حضر ومنصرفش.

const hm = (d) => (d ? d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '—');
const flagsOf = (r) => {
  const f = [];
  if (!r.photo) f.push('من غير صورة');
  if (r.method === 'pin' && r.fallback) f.push(`بالرقم السري: ${FALLBACK[r.fallback] || r.fallback}`);
  const at = toDate(r.at);
  if (!at) f.push('لسه مستني النت');
  else if (Math.abs(at.getTime() - (r.atLocalMs || 0)) > LATE_SYNC_MIN * 60000) f.push(`اتسجل من غير نت أو ساعة الجهاز غلط (الجهاز قال ${hm(new Date(r.atLocalMs))})`);
  return f;
};

function ShopDay({ shop, day }) {
  const [rows, setRows] = useState(null);
  const [pub, setPub] = useState(null);
  const [big, setBig] = useState(null);
  useEffect(() => { getDoc(doc(db, 'shopsPublic', shop.id)).then((s) => setPub(s.data() || {})).catch(() => setPub({})); }, [shop.id]);
  useEffect(() => onSnapshot(query(collection(db, 'attendance'), where('shopId', '==', shop.id), where('day', '==', day)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('attendance', e.code); setRows([]); }), [shop.id, day]);

  if (!rows || !pub) return <section className="card"><span className="muted">بنحمّل…</span></section>;
  const byUid = new Map();
  rows.slice().sort((a, b) => (toDate(a.at)?.getTime() || a.atLocalMs) - (toDate(b.at)?.getTime() || b.atLocalMs)).forEach((r) => {
    if (!byUid.has(r.uid)) byUid.set(r.uid, { uid: r.uid, name: r.name, list: [] });
    byUid.get(r.uid).list.push(r);
  });
  const people = [...(pub.cashiers || []), ...(pub.workers || [])].filter((p) => p.uid && !p.disabled);
  const absent = people.filter((p) => !byUid.has(p.uid));
  const past = day < todayKey();

  return (
    <section className="card">
      <h2 className="h2">{pub.name || shop.name}{!pub.attendance && <span className="tiny muted"> · الحضور مش شغال في الفرع ده (من الإعداد ← العمال)</span>}</h2>
      <div className="stack" style={{ gap: 10 }}>
        {[...byUid.values()].map((p) => {
          const last = p.list[p.list.length - 1];
          const noOut = last.kind === 'in' && past;
          const person = people.find((x) => x.uid === p.uid);
          return (
            <div key={p.uid} className="stack" style={{ background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 10, gap: 8 }}>
              <span className="chips" style={{ gap: 10, alignItems: 'center' }}>
                <Avatar name={p.name} color={person?.color} size={40} /><strong>{p.name}</strong>
                {noOut && <span className="badge warn">⚠️ حضر ومنصرفش</span>}
              </span>
              <div className="chips" style={{ gap: 10 }}>
                {p.list.map((r) => {
                  const fl = flagsOf(r);
                  return (
                    <div key={r.id} className="stack" style={{ gap: 4, alignItems: 'center', width: 130, textAlign: 'center' }}>
                      {r.photo ? <button type="button" onClick={() => setBig(r)} style={{ border: 0, padding: 0, background: 'none' }}><img src={r.photo} alt="" style={{ width: 120, borderRadius: 14 }} /></button>
                        : <span style={{ width: 120, height: 90, borderRadius: 14, background: 'var(--warn-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📷✗</span>}
                      <strong>{KIND_LABEL[r.kind]} <bdi>{hm(toDate(r.at))}</bdi></strong>
                      {r.method === 'face' && <span className="badge tiny">✓ بالوش</span>}
                      {fl.map((x) => <span key={x} className="badge warn tiny" style={{ whiteSpace: 'normal' }}>⚠️ {x}</span>)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {byUid.size === 0 && <span className="muted">مفيش تسجيلات في اليوم ده</span>}
        {absent.length > 0 && <span className="small muted">مسجلوش: {absent.map((p) => p.name).join('، ')}</span>}
      </div>
      {big && (
        <Modal title={`${big.name} · ${KIND_LABEL[big.kind]} ${hm(toDate(big.at))}`} onClose={() => setBig(null)}>
          <img src={big.photo} alt="" style={{ width: '100%', borderRadius: 18 }} />
        </Modal>
      )}
    </section>
  );
}

export default function AttendanceView({ shops }) {
  const [day, setDay] = useState(todayKey());
  return (
    <div className="wrap stack" style={{ gap: 16 }}>
      <label className="field" style={{ width: 200 }}>اليوم<input type="date" className="input" dir="ltr" value={day} max={todayKey()} onChange={(e) => setDay(e.target.value || todayKey())} /></label>
      {shops.map((sh) => <ShopDay key={sh.id} shop={sh} day={day} />)}
      {shops.map((sh) => <ShopFaces key={'f' + sh.id} shop={sh} />)}
    </div>
  );
}

// الوشوش المتسجلة: صاحب المحل أو المدير يقارن صورة التسجيل بالشخص ويوافق. لو غلط يمسحها والشخص يسجّل تاني.
function ShopFaces({ shop }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  useEffect(() => onSnapshot(query(collection(db, 'faces'), where('shopId', '==', shop.id)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('faces', e.code); setRows([]); }), [shop.id]);
  if (!rows || rows.length === 0) return null;
  const approve = (r) => updateDoc(doc(db, 'faces', r.id), { approved: true, approvedBy: auth.currentUser?.uid || '', approvedAt: serverTimestamp() })
    .then(() => logAct('staff_edit', `وافق على تسجيل وش ${r.name}`, { shopId: shop.id })).catch(() => toast('مش قادرين نحفظ، اتأكد من النت', 'err'));
  const remove = (r) => {
    if (!window.confirm(`تمسح بصمة وش ${r.name}؟ هيحتاج يسجّل وشّه تاني.`)) return;
    deleteDoc(doc(db, 'faces', r.id)).then(() => logAct('staff_edit', `مسح بصمة وش ${r.name}`, { shopId: shop.id })).catch(() => toast('مش قادرين نمسح، اتأكد من النت', 'err'));
  };
  const pending = rows.filter((r) => !r.approved);
  return (
    <section className="card">
      <h2 className="h2">الوشوش المتسجلة · {shop.name}{pending.length > 0 && <span className="badge warn" style={{ marginInlineStart: 8 }}>{pending.length} مستني موافقتك</span>}</h2>
      <span className="tiny muted">قارن الصورة بالشخص. لو هو، دوس «موافقة». لو مش هو (حد سجّل وش غيره)، امسحها.</span>
      <div className="chips" style={{ gap: 12 }}>
        {rows.sort((a, b) => Number(!!a.approved) - Number(!!b.approved)).map((r) => (
          <div key={r.id} className="stack" style={{ gap: 6, alignItems: 'center', width: 150, textAlign: 'center', background: 'rgba(255,255,255,.75)', borderRadius: 18, padding: 10 }}>
            {r.photo ? <img src={r.photo} alt="" style={{ width: 130, borderRadius: 14 }} /> : <Avatar name={r.name} size={80} />}
            <strong>{r.name}</strong>
            <span className="tiny muted">وافق على التصوير <bdi>{toDate(r.consentAt)?.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }) || '—'}</bdi></span>
            {r.approved ? <span className="badge">✓ متوافق عليه</span> : <button type="button" className="btn sm" onClick={() => approve(r)}>موافقة</button>}
            <button type="button" className="link small" onClick={() => remove(r)}>امسح</button>
          </div>
        ))}
      </div>
    </section>
  );
}
