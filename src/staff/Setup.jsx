import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, Icon, useToast } from '../ui.jsx';
import { AVATAR_BG, DEFAULT_SHOP, ROLE_LABEL, WEEKDAYS, cashierPassword, createAccount, pickImage, setLinkedShop, slug } from '../lib';

export default function Setup({ profile, shops, linkedShop, onLinkDevice }) {
  const toast = useToast();
  const [sel, setSel] = useState(null);
  const [view, setView] = useState('shops');
  const shop = shops.find((s) => s.id === sel) || null;

  useEffect(() => { if (!sel && shops.length) setSel(shops[0].id); }, [shops, sel]);

  const newShop = async () => {
    const name = window.prompt('اسم المحل الجديد');
    if (!name?.trim()) return;
    const ref = doc(collection(db, 'shops'));
    const b = writeBatch(db);
    b.set(ref, { ...DEFAULT_SHOP, name: name.trim(), createdAt: serverTimestamp(), openShift: null, lastHandover: null });
    b.set(doc(db, 'shopsPublic', ref.id), { name: name.trim(), logo: null, cashiers: [] });
    await b.commit();
    setSel(ref.id);
    toast('المحل اتعمل');
  };

  return (
    <div className="wrap">
      <div className="spread">
        <h1 className="title">الإعداد</h1>
        <div className="tabs">
          <button type="button" className={view === 'shops' ? 'on' : ''} onClick={() => setView('shops')}>المحلات والكاشيرية</button>
          <button type="button" className={view === 'staff' ? 'on' : ''} onClick={() => setView('staff')}>حسابات الموظفين</button>
        </div>
      </div>
      {view === 'staff' ? <StaffAccounts shops={shops} profile={profile} /> : (
        <div className="row">
          <aside className="side" style={{ flex: '1 1 260px', maxWidth: 340 }}>
            <button type="button" className="btn full" onClick={newShop}><Icon d="plus" />محل جديد</button>
            {shops.map((s) => (
              <button key={s.id} type="button" className={'q-item' + (sel === s.id ? ' on' : '')} onClick={() => setSel(s.id)}>
                <span className="spread"><strong>{s.name}</strong>{linkedShop === s.id && <span className="badge info">الجهاز ده</span>}</span>
                <span className="tiny muted">{s.openShift ? `وردية شغالة · ${s.openShift.cashierName}` : 'مفيش وردية مفتوحة'}</span>
              </button>
            ))}
            {shops.length === 0 && <div className="card empty">ابدأ بإضافة أول محل</div>}
          </aside>
          <div className="grow">{shop ? <ShopEditor key={shop.id} shop={shop} linkedShop={linkedShop} onLinkDevice={onLinkDevice} /> : null}</div>
        </div>
      )}
    </div>
  );
}

function TagList({ title, items, onChange, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (!t || items.includes(t)) return; onChange([...items, t]); setV(''); };
  return (
    <div className="stack">
      <strong className="small">{title}</strong>
      <div className="chips">
        {items.map((x) => (
          <span key={x} className="chip sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{x}
            <button type="button" aria-label={`امسح ${x}`} onClick={() => onChange(items.filter((y) => y !== x))} style={{ border: 0, background: 'transparent', padding: 0, display: 'flex' }}><Icon d="x" size={14} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn soft sm" onClick={add}>إضافة</button>
      </div>
    </div>
  );
}

function ShopEditor({ shop, linkedShop, onLinkDevice }) {
  const toast = useToast();
  const [pub, setPub] = useState(null);
  const [f, setF] = useState(() => ({
    name: shop.name || '', posUrl: shop.posUrl || '', walletName: shop.walletName || '',
    machines: shop.machines || [], suppliers: shop.suppliers || [], staff: shop.staff || [],
    shopExpenses: shop.shopExpenses || [], incomeReasons: shop.incomeReasons || [], advanceDays: shop.advanceDays || [],
  }));
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };

  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shop.id), (s) => setPub(s.data() || { cashiers: [] }), () => {}), [shop.id]);

  const save = async () => {
    try {
      const machines = f.machines.filter((m) => m.machine.trim() && m.account.trim());
      await updateDoc(doc(db, 'shops', shop.id), { ...f, machines, name: f.name.trim() });
      await setDoc(doc(db, 'shopsPublic', shop.id), { name: f.name.trim() }, { merge: true });
      setDirty(false);
      toast('اتحفظ');
    } catch (e) { console.error(e); toast('مش قادرين نحفظ', 'err'); }
  };

  const uploadLogo = async () => {
    const data = await pickImage(520, 0.92, 'image/png');
    if (!data) return;
    if (data.length > 600000) { toast('الصورة كبيرة، جرّب صورة أصغر', 'err'); return; }
    await setDoc(doc(db, 'shopsPublic', shop.id), { logo: data }, { merge: true });
    await updateDoc(doc(db, 'shops', shop.id), { logo: data });
    toast('اللوجو اتحفظ');
  };

  const link = () => {
    setLinkedShop(shop.id);
    onLinkDevice(shop.id);
    toast('الجهاز ده اتربط بالمحل · لما تخرج هتظهر شاشة الكاشيرية');
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="spread">
          <h2 className="h2">بيانات المحل</h2>
          <button type="button" className={'btn sm ' + (linkedShop === shop.id ? 'soft' : 'blue')} onClick={link}>{linkedShop === shop.id ? '✓ الجهاز ده مربوط بالمحل' : 'اربط الجهاز ده بالمحل'}</button>
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <div className="stack center" style={{ flex: '0 0 auto' }}>
            <div style={{ width: 200, height: 110, borderRadius: 20, background: 'var(--chip)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {pub?.logo ? <img src={pub.logo} alt="لوجو المحل" style={{ maxHeight: 100, maxWidth: 190, objectFit: 'contain' }} /> : <span className="muted small">مفيش لوجو</span>}
            </div>
            <button type="button" className="link" onClick={uploadLogo}>{pub?.logo ? 'غيّر اللوجو' : 'ارفع لوجو المحل'}</button>
          </div>
          <div className="stack" style={{ flex: '1 1 280px' }}>
            <label className="field">اسم المحل<input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="field">لينك برنامج البيع<input className="input" dir="ltr" placeholder="https://" value={f.posUrl} onChange={(e) => set('posUrl', e.target.value)} /></label>
            <label className="field">اسم الحساب اللي بيستلم انستاباي (للمطابقة)<input className="input" value={f.walletName} onChange={(e) => set('walletName', e.target.value)} /></label>
          </div>
        </div>
      </section>

      <Cashiers shop={shop} pub={pub} />

      <section className="card">
        <h2 className="h2">المكن والحسابات</h2>
        {f.machines.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="المكنة (فوري)" value={m.machine} onChange={(e) => set('machines', f.machines.map((x, j) => (j === i ? { ...x, machine: e.target.value } : x)))} />
            <input className="input" placeholder="الحساب (الرئيسي)" value={m.account} onChange={(e) => set('machines', f.machines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} />
            <button type="button" className="icon-btn" aria-label="امسح" onClick={() => set('machines', f.machines.filter((_, j) => j !== i))}><Icon d="trash" size={18} /></button>
          </div>
        ))}
        <button type="button" className="btn soft sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('machines', [...f.machines, { machine: '', account: '' }])}><Icon d="plus" size={16} />حساب مكنة</button>
      </section>

      <section className="card" style={{ gap: 18 }}>
        <h2 className="h2">القوايم</h2>
        <TagList title="الموردين" items={f.suppliers} onChange={(v) => set('suppliers', v)} placeholder="اسم المورد" />
        <TagList title="الموظفين (للسلف واليوميات)" items={f.staff} onChange={(v) => set('staff', v)} placeholder="اسم الموظف" />
        <TagList title="أنواع مصاريف المحل" items={f.shopExpenses} onChange={(v) => set('shopExpenses', v)} placeholder="مثلًا كهربا" />
        <TagList title="أسباب الإيراد" items={f.incomeReasons} onChange={(v) => set('incomeReasons', v)} placeholder="مثلًا سداد آجل" />
        <div className="stack">
          <strong className="small">أيام السلف <span className="muted" style={{ fontWeight: 400 }}>(لو مفيش أيام متعلمة، السلف مسموحة كل يوم)</span></strong>
          <div className="chips">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" className={'chip sm' + (f.advanceDays.includes(i) ? ' on' : '')} onClick={() => set('advanceDays', f.advanceDays.includes(i) ? f.advanceDays.filter((x) => x !== i) : [...f.advanceDays, i])}>{d}</button>
            ))}
          </div>
        </div>
      </section>

      <div style={{ position: 'sticky', bottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={save} disabled={!dirty} style={{ boxShadow: 'var(--shadow-lg)' }}><Icon d="check" />{dirty ? 'حفظ التعديلات' : 'كله محفوظ'}</button>
      </div>
    </div>
  );
}

function Cashiers({ shop, pub }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState(AVATAR_BG[0]);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = (pub?.cashiers || []).filter((c) => !c.disabled);

  const add = async () => {
    if (!name.trim()) { toast('اكتب اسم الكاشير', 'err'); return; }
    if (!/^[0-9]{4}$/.test(pin)) { toast('الرقم السري لازم 4 أرقام', 'err'); return; }
    setBusy(true);
    try {
      const email = `c-${slug()}@cashier.modaqqeq.app`;
      const uid = await createAccount(email, cashierPassword(pin));
      const c = { uid, name: name.trim(), email, color, photo: photo || null };
      await setDoc(doc(db, 'users', uid), { role: 'cashier', name: c.name, email, color, photo: c.photo, shopIds: [shop.id], createdAt: serverTimestamp() });
      await setDoc(doc(db, 'shopsPublic', shop.id), { cashiers: [...(pub?.cashiers || []), c] }, { merge: true });
      setName(''); setPin(''); setPhoto(null);
      toast(`${c.name} اتضاف · الرقم السري ${pin}`);
    } catch (e) { console.error(e); toast('مش قادرين نضيف الكاشير، اتأكد من النت', 'err'); }
    setBusy(false);
  };

  const remove = async (c) => {
    if (!window.confirm(`تشيل ${c.name} من المحل؟ مش هيقدر يدخل تاني.`)) return;
    try {
      await updateDoc(doc(db, 'users', c.uid), { disabled: true });
      await setDoc(doc(db, 'shopsPublic', shop.id), { cashiers: (pub?.cashiers || []).filter((x) => x.uid !== c.uid) }, { merge: true });
      toast('اتشال');
    } catch { toast('مش قادرين نشيله', 'err'); }
  };

  const changePhoto = async (c) => {
    const data = await pickImage(300, 0.8);
    if (!data) return;
    await updateDoc(doc(db, 'users', c.uid), { photo: data });
    await setDoc(doc(db, 'shopsPublic', shop.id), { cashiers: (pub?.cashiers || []).map((x) => (x.uid === c.uid ? { ...x, photo: data } : x)) }, { merge: true });
    toast('الصورة اتغيرت');
  };

  return (
    <section className="card">
      <h2 className="h2">الكاشيرية</h2>
      <div className="chips" style={{ gap: 12 }}>
        {list.map((c) => (
          <div key={c.uid} style={{ background: 'var(--chip)', borderRadius: 22, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => changePhoto(c)} style={{ border: 0, background: 'transparent', padding: 0 }} aria-label={`غيّر صورة ${c.name}`} title="غيّر الصورة"><Avatar name={c.name} photo={c.photo} color={c.color} size={44} /></button>
            <strong>{c.name}</strong>
            <button type="button" className="copy" aria-label={`شيل ${c.name}`} onClick={() => remove(c)}><Icon d="trash" size={16} /></button>
          </div>
        ))}
        {list.length === 0 && <span className="muted small">لسه مفيش كاشيرية</span>}
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 22, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <button type="button" onClick={async () => { const d = await pickImage(300, 0.8); if (d) setPhoto(d); }} style={{ border: 0, background: 'transparent', padding: 0 }} aria-label="صورة الكاشير" title="صورة (اختياري)"><Avatar name={name} photo={photo} color={color} size={52} /></button>
        <label className="field" style={{ flex: '1 1 180px' }}>الاسم<input className="input white" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field" style={{ width: 130 }}>رقم سري (4 أرقام)<input className="input white" inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <div className="chips" style={{ gap: 6 }} role="group" aria-label="اللون">
          {AVATAR_BG.map((c) => <button key={c} type="button" aria-label={`لون ${c}`} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 999, background: c, border: color === c ? '3px solid var(--ink)' : '3px solid #fff' }} />)}
        </div>
        <button type="button" className="btn sm" onClick={add} disabled={busy}><Icon d="plus" size={16} />{busy ? 'لحظة…' : 'إضافة كاشير'}</button>
      </div>
      <span className="tiny muted">علشان تغيّر الرقم السري لكاشير: شيله وضيفه تاني برقم جديد. اضغط على صورته علشان تغيّرها.</span>
    </section>
  );
}

function StaffAccounts({ shops }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => onSnapshot(collection(db, 'users'), (q) => setUsers(q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.role !== 'cashier' && !u.disabled)), () => {}), []);
  const shopName = (id) => shops.find((s) => s.id === id)?.name || '؟';
  const toggleShop = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const add = async () => {
    const { name, email, pass, role, shopIds } = form;
    if (!name.trim() || !email.trim() || pass.length < 6) { toast('اكتب الاسم والإيميل وباسورد 6 حروف على الأقل', 'err'); return; }
    setBusy(true);
    try {
      const uid = await createAccount(email.trim(), pass);
      await setDoc(doc(db, 'users', uid), { role, name: name.trim(), email: email.trim(), shopIds, color: AVATAR_BG[users.length % AVATAR_BG.length], createdAt: serverTimestamp() });
      setForm({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
      toast('الحساب اتعمل · ابعتله الإيميل والباسورد');
    } catch (e) {
      toast(e.code === 'auth/email-already-in-use' ? 'الإيميل ده متسجل قبل كده' : 'مش قادرين نعمل الحساب', 'err');
    }
    setBusy(false);
  };

  const update = (u, patch) => updateDoc(doc(db, 'users', u.id), patch).then(() => toast('اتحفظ')).catch(() => toast('مش قادرين نحفظ', 'err'));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <h2 className="h2">حساب جديد</h2>
        <div className="row" style={{ gap: 10 }}>
          <label className="field" style={{ flex: '1 1 180px' }}>الاسم<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 220px' }}>الإيميل<input className="input" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 160px' }}>الباسورد<input className="input" dir="ltr" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 160px' }}>الدور
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {['accountant', 'reviewer', 'manager', 'owner', 'admin'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        </div>
        {form.role !== 'admin' && (
          <div className="stack"><span className="small muted">المحلات اللي هيشوفها</span>
            <div className="chips">{shops.map((s) => <button key={s.id} type="button" className={'chip sm' + (form.shopIds.includes(s.id) ? ' on' : '')} onClick={() => setForm({ ...form, shopIds: toggleShop(form.shopIds, s.id) })}>{s.name}</button>)}</div>
          </div>
        )}
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={busy}><Icon d="plus" />{busy ? 'لحظة…' : 'اعمل الحساب'}</button>
      </section>
      <section className="card" style={{ gap: 0 }}>
        <h2 className="h2" style={{ marginBottom: 8 }}>الحسابات</h2>
        {users.map((u) => (
          <div key={u.id} className="list-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={u.name} color={u.color || '#8FD3FF'} size={40} />
              <span className="stack" style={{ gap: 0 }}><strong>{u.name}</strong><span className="tiny muted" dir="ltr">{u.email}</span></span>
            </span>
            <select className="input" style={{ width: 150, height: 44 }} value={u.role} onChange={(e) => update(u, { role: e.target.value })} aria-label={`دور ${u.name}`}>
              {['accountant', 'reviewer', 'manager', 'owner', 'admin'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            {u.role !== 'admin' && (
              <div className="chips" style={{ flex: '1 1 260px' }}>
                {shops.map((s) => <button key={s.id} type="button" className={'chip sm' + ((u.shopIds || []).includes(s.id) ? ' on' : '')} onClick={() => update(u, { shopIds: toggleShop(u.shopIds || [], s.id) })}>{shopName(s.id)}</button>)}
              </div>
            )}
            <button type="button" className="copy" aria-label={`اقفل حساب ${u.name}`} title="اقفل الحساب" onClick={() => window.confirm(`تقفل حساب ${u.name}؟`) && update(u, { disabled: true })}><Icon d="trash" size={16} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}
