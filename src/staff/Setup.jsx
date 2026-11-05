import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from '../firebase';
import { Avatar, Icon, Modal, useToast } from '../ui.jsx';
import { AVATAR_BG, BUILTIN_EXPENSE_TYPES, DEFAULT_SHOP, REG_KIND, allOpen, isAdminRole, newRegister, newExpenseType, RATE_FROM, WALLETS, WALLET_MODE, walletModesOf, ROLE_LABEL, SETTLE, settleOf, WEEKDAYS, USERNAME_RE, cashierEmail, cashierPassword, changeAccountPassword, createAccount, normUsername, dateStr, flattenMachines, fmt, minutesBetween, todayKey, machineListOf, newMachine, num, pickImage } from '../lib';
import { logAct } from '../activity.js';

export default function Setup({ profile, shops, sel, setSel }) {
  const [view, setView] = useState('shops');
  const shop = shops.find((s) => s.id === sel) || null;


  return (
    <div className="wrap">
      <div className="spread">
        <h1 className="title">الإعداد</h1>
        <div className="tabs" data-tour="setup-tabs">
          <button type="button" className={view === 'shops' ? 'on' : ''} onClick={() => setView('shops')}>المحلات والكاشيرية</button>
          <button type="button" className={view === 'staff' ? 'on' : ''} onClick={() => setView('staff')}>حسابات الموظفين</button>
        </div>
      </div>
      {view === 'staff' ? <StaffAccounts shops={shops} profile={profile} /> : (
        <div className="stack" style={{ gap: 16 }}>
          {shop ? <ShopEditor key={shop.id} shop={shop} /> : (
            <div className="card empty" style={{ minHeight: 220, justifyContent: 'center' }}>{shops.length ? 'اختار المحل من فوق جنب لوجو مدقق علشان تعدّل إعداداته' : 'ابدأ بإضافة أول محل من «اختار المحل» فوق'}</div>
          )}
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

function MachinesEditor({ list, onChange }) {
  const upd = (id, patch) => onChange(list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  return (
    <section className="card tint-yellow" style={{ gap: 14 }}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="h2">المكن</h2>
          <span className="tiny muted">ضيف المكن اللي المحل شغّال عليها بس. المكنة اللي تقفلها مش هتظهر للكاشير.</span>
        </div>
        <button type="button" className="btn sm" onClick={() => onChange([...list, newMachine()])}><Icon d="plus" size={16} />مكنة جديدة</button>
      </div>
      {list.length === 0 && <div className="empty" style={{ padding: 16 }}>مفيش مكن لسه. دوس «مكنة جديدة».</div>}
      {list.map((m) => (
        <div key={m.id} style={{ background: '#fff', borderRadius: 24, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, opacity: m.active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 200px' }}>اسم المكنة<input className="input" placeholder="مثلًا فوري، ماجيك، أمان" value={m.name} onChange={(e) => upd(m.id, { name: e.target.value })} /></label>
            <label className="field" style={{ width: 130 }}>النسبة %<input className="input" inputMode="decimal" dir="ltr" placeholder="2" value={m.ratePct} onChange={(e) => upd(m.id, { ratePct: e.target.value })} /></label>
            <button type="button" className={'chip' + (m.active ? ' on' : '')} onClick={() => upd(m.id, { active: !m.active })} aria-pressed={m.active}>{m.active ? '✓ مفعّلة للمحل' : 'مقفولة'}</button>
            <button type="button" className="icon-btn" aria-label={`امسح ${m.name || 'المكنة'}`} onClick={() => window.confirm('تمسح المكنة دي من المحل؟') && onChange(list.filter((x) => x.id !== m.id))}><Icon d="trash" size={18} /></button>
          </div>
          <div className="stack">
            <span className="small muted">الحسابات</span>
            <div className="chips">
              <button type="button" className={'chip sm' + (!m.hasSubs ? ' on' : '')} onClick={() => upd(m.id, { hasSubs: false })}>حساب واحد</button>
              <button type="button" className={'chip sm' + (m.hasSubs ? ' on' : '')} onClick={() => upd(m.id, { hasSubs: true, accounts: m.accounts.length ? m.accounts : [''] })}>فيها حسابات فرعية</button>
            </div>
            {m.hasSubs && (
              <div className="stack">
                {m.accounts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <input className="input" placeholder="مثلًا الحساب الرئيسي، كاش أوت، الكارت، الهوا" value={a} onChange={(e) => upd(m.id, { accounts: m.accounts.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <button type="button" className="icon-btn" aria-label="امسح الحساب" onClick={() => upd(m.id, { accounts: m.accounts.filter((_, j) => j !== i) })}><Icon d="x" size={16} /></button>
                  </div>
                ))}
                <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => upd(m.id, { accounts: [...m.accounts, ''] })}>+ حساب فرعي</button>
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 16 }}>
            <div className="stack" style={{ flex: '1 1 240px' }}>
              <span className="small muted">النسبة</span>
              <div className="chips">{Object.entries(RATE_FROM).map(([k, l]) => <button key={k} type="button" className={'chip sm' + (m.rateFrom === k ? ' on' : '')} onClick={() => upd(m.id, { rateFrom: k })}>{l}</button>)}</div>
            </div>
            <div className="stack" style={{ flex: '1 1 200px' }}>
              <span className="small muted">حركتها</span>
              <div className="chips">
                <button type="button" className={'chip sm' + (m.inCash !== false ? ' on' : '')} onClick={() => upd(m.id, { inCash: true })}>بتأثر على درج الكاشير</button>
                <button type="button" className={'chip sm' + (m.inCash === false ? ' on' : '')} onClick={() => upd(m.id, { inCash: false })}>مش بتأثر</button>
              </div>
            </div>
            <div className="stack" style={{ flex: '1 1 240px' }}>
              <span className="small muted">الرصيد</span>
              <div className="chips">{Object.entries(SETTLE).map(([k, l]) => <button key={k} type="button" className={'chip sm' + (settleOf(m) === k ? ' on' : '')} onClick={() => upd(m.id, { settle: k })}>{l}</button>)}</div>
              {settleOf(m) === 'liquidate' && (
                <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>مصاريف التسييل %
                  <input className="input" style={{ width: 90, height: 40 }} inputMode="decimal" value={m.liqFeePct ?? ''} onChange={(e) => upd(m.id, { liqFeePct: e.target.value })} placeholder="0" />
                  <span className="tiny muted">لو مفيش سيبها 0</span>
                </label>
              )}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

const EXPENSE_SUGGESTIONS = [
  ['سحب المالك', 'مين سحب؟'],
  ['مشتريات', 'اتشترى إيه؟'],
  ['باقي لعميل', '', { needNote: true }],
  ['مواصلات توصيل', ''],
];

function ExpenseTypesEditor({ custom, hidden, onCustom, onHidden }) {
  const upd = (id, patch) => onCustom(custom.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const have = (label) => custom.some((c) => c.label.trim() === label);
  return (
    <section className="card tint-orange" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h2">أنواع المصروفات</h2>
        <span className="tiny muted">دي الاختيارات اللي بتظهر للكاشير لما يسجّل مصروف. اقفل اللي مش محتاجه، وضيف أنواع خاصة بالمحل.</span>
      </div>
      <div className="stack">
        <span className="small muted">الأنواع الأساسية</span>
        <div className="chips">
          {BUILTIN_EXPENSE_TYPES.map((t) => {
            const on = !hidden.includes(t.id);
            return <button key={t.id} type="button" className={'chip sm' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onHidden(on ? [...hidden, t.id] : hidden.filter((x) => x !== t.id))}>{on ? '✓ ' : ''}{t.label}</button>;
          })}
        </div>
      </div>
      <div className="stack">
        <span className="small muted">أنواع خاصة بالمحل</span>
        {custom.map((c) => (
          <div key={c.id} style={{ background: '#fff', borderRadius: 22, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 160px' }}>اسم النوع<input className="input" value={c.label} placeholder="مثلًا سحب المالك" onChange={(e) => upd(c.id, { label: e.target.value })} /></label>
              <label className="field" style={{ flex: '1 1 160px' }}>السؤال (اختياري)<input className="input" value={c.q} placeholder="مثلًا مين سحب؟" onChange={(e) => upd(c.id, { q: e.target.value })} /></label>
              <button type="button" className="icon-btn" aria-label={`امسح ${c.label || 'النوع'}`} onClick={() => onCustom(custom.filter((x) => x.id !== c.id))}><Icon d="trash" size={18} /></button>
            </div>
            {c.q && <TagList title="الاختيارات اللي تحت السؤال" items={c.subs || []} onChange={(v) => upd(c.id, { subs: v })} placeholder="مثلًا أ. سامح" />}
            <div className="chips">
              <button type="button" className={'chip sm' + (c.needNote ? ' on' : '')} onClick={() => upd(c.id, { needNote: !c.needNote })}>{c.needNote ? '✓ ' : ''}لازم يكتب ملاحظة</button>
              <button type="button" className={'chip sm' + (c.needPhoto ? ' on' : '')} onClick={() => upd(c.id, { needPhoto: !c.needPhoto })}>{c.needPhoto ? '✓ ' : ''}لازم يصوّر إيصال</button>
            </div>
          </div>
        ))}
        <div className="chips">
          {EXPENSE_SUGGESTIONS.filter(([l]) => !have(l)).map(([l, q, extra]) => (
            <button key={l} type="button" className="chip sm" onClick={() => onCustom([...custom, newExpenseType(l, q, extra)])}>+ {l}</button>
          ))}
          <button type="button" className="chip sm on" onClick={() => onCustom([...custom, newExpenseType()])}>+ نوع جديد</button>
        </div>
      </div>
    </section>
  );
}

function ShopEditor({ shop }) {
  const toast = useToast();
  const [pub, setPub] = useState(null);
  const [f, setF] = useState(() => ({
    name: shop.name || '', posUrl: shop.posUrl || '', walletName: shop.walletName || '',
    machineList: machineListOf(shop), wallets: shop.wallets || ['insta', 'vf'], walletModes: walletModesOf(shop), suppliers: shop.suppliers || [], staff: shop.staff || [],
    shopExpenses: shop.shopExpenses || [], customExpenseTypes: shop.customExpenseTypes || [], hiddenExpenseTypes: shop.hiddenExpenseTypes || [], incomeReasons: shop.incomeReasons || [], advanceDays: shop.advanceDays || [],
    registers: shop.registers || [],
  }));
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };

  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shop.id), (s) => setPub(s.data() || { cashiers: [] }), () => {}), [shop.id]);

  const save = async () => {
    try {
      const machineList = f.machineList.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim(), ratePct: num(m.ratePct), liqFeePct: num(m.liqFeePct), settle: settleOf(m), accounts: m.accounts.map((a) => a.trim()).filter(Boolean) }));
      const registers = f.registers.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim() }));
      await updateDoc(doc(db, 'shops', shop.id), { ...f, registers, machineList, machines: flattenMachines(machineList), name: f.name.trim() });
      await setDoc(doc(db, 'shopsPublic', shop.id), { name: f.name.trim() }, { merge: true });
      logAct('setup', `حفظ إعدادات محل ${f.name.trim()}`, { shopId: shop.id });
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
    logAct('setup', `غيّر لوجو محل ${shop.name}`, { shopId: shop.id });
    toast('اللوجو اتحفظ');
  };


  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card tint-blue">
        <div className="spread">
          <h2 className="h2">بيانات المحل</h2>
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <div className="stack center" style={{ flex: '0 0 auto' }}>
            <div style={{ width: 200, height: 110, borderRadius: 20, background: '#fff', border: '2px dashed #B4C6F0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
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

      <ShopPeople shop={shop} />

      <section className="card tint-violet">
        <h2 className="h2">المحافظ المفعّلة للمحل</h2>
        <div className="chips">
          {WALLETS.map((w) => {
            const on = f.wallets.includes(w.key);
            return <button key={w.key} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => set('wallets', on ? f.wallets.filter((x) => x !== w.key) : [...f.wallets, w.key])}>{on ? '✓ ' : ''}{w.label}</button>;
          })}
        </div>
        {WALLETS.filter((w) => f.wallets.includes(w.key)).map((w) => {
          const mode = f.walletModes[w.key] || 'owner';
          return (
            <div key={w.key} className="stack" style={{ background: '#fff', borderRadius: 20, padding: '12px 14px', gap: 8 }}>
              <div className="spread">
                <strong>{w.label}</strong>
                <div className="chips">
                  {Object.entries(WALLET_MODE).map(([k, l]) => (
                    <button key={k} type="button" className={'chip sm' + (mode === k ? ' on' : '')} aria-pressed={mode === k} onClick={() => set('walletModes', { ...f.walletModes, [w.key]: k })}>{l}</button>
                  ))}
                </div>
              </div>
              <span className="tiny muted" style={{ lineHeight: 1.7 }}>
                {mode === 'owner'
                  ? 'الكاشير مش بيستلم ولا بيسلّم رصيد. بيسجّل كل تحويل لوحده بصورته، والتحويلات بتتخصم من درجه.'
                  : 'الكاشير بيستلم رصيد أول الوردية ويكتب الرصيد آخر الوردية بس. الفرق بيظهر للمحاسب وبيتخصم من الدرج.'}
              </span>
            </div>
          );
        })}
      </section>

      <MachinesEditor list={f.machineList} onChange={(v) => set('machineList', v)} />

      <RegistersEditor list={f.registers} machines={f.machineList} wallets={f.wallets} openShifts={shop.openShifts || {}} onChange={(v) => set('registers', v)} />

      <ExpenseTypesEditor custom={f.customExpenseTypes} hidden={f.hiddenExpenseTypes} onCustom={(v) => set('customExpenseTypes', v)} onHidden={(v) => set('hiddenExpenseTypes', v)} />

      <section className="card tint-violet" style={{ gap: 18 }}>
        <h2 className="h2">القوايم</h2>
        <TagList title="الموردين" items={f.suppliers} onChange={(v) => set('suppliers', v)} placeholder="اسم المورد" />
        <TagList title="الموظفين (للسلف واليوميات)" items={f.staff} onChange={(v) => set('staff', v)} placeholder="اسم الموظف" />
        <TagList title="اختيارات «مصروف محل»" items={f.shopExpenses} onChange={(v) => set('shopExpenses', v)} placeholder="مثلًا كهربا" />
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

function RegistersEditor({ list, machines, wallets, openShifts, onChange }) {
  const upd = (i, patch) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const activeMachines = machines.filter((m) => m.active && m.name.trim());
  return (
    <section className="card tint-lime" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h2">الأدراج في المحل</h2>
        <span className="tiny muted" style={{ lineHeight: 1.7 }}>
          الكاشير الأساسي موجود دايمًا. لو فيه كاشير فرعي أو دليفري شغّال في نفس الوقت، ضيفه هنا. أي كاشير يقدر يشتغل على أي درج، وبيختار الدرج وهو بيستلم.
          الفرعي والدليفري بياخدوا الفكة من الأساسي وبيسلّموله فلوسهم في الآخر، والأساسي بيأكد.
        </span>
      </div>
      {list.map((r, i) => {
        const busy = !!openShifts[r.id];
        return (
          <div key={r.id} className="stack" style={{ background: '#fff', borderRadius: 22, padding: 14, gap: 12, opacity: r.active === false ? 0.6 : 1 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <input className="input" style={{ flex: '1 1 200px' }} value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="اسم الدرج: مثلًا كاشير 2 أو درج الدليفري" aria-label="اسم الدرج" />
              <div className="chips">
                {Object.entries(REG_KIND).map(([k, label]) => (
                  <button key={k} type="button" className={'chip sm' + (r.kind === k ? ' on' : '')} onClick={() => upd(i, k === 'delivery' ? { kind: k, hasSide: false, ops: false } : { kind: k })}>{label}</button>
                ))}
              </div>
            </div>
            <div className="chips">
              <button type="button" className={'chip sm' + (r.hasSide ? ' on' : '')} aria-pressed={!!r.hasSide} onClick={() => upd(i, { hasSide: !r.hasSide })}>{r.hasSide ? '✓ ' : ''}عنده درج جانبي</button>
              <button type="button" className={'chip sm' + (r.ops ? ' on' : '')} aria-pressed={!!r.ops} onClick={() => upd(i, { ops: !r.ops })}>{r.ops ? '✓ ' : ''}بيسجّل مصروفات وإيرادات</button>
            </div>
            {wallets.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">محافظ خاصة بيه</span>
                <div className="chips">
                  {WALLETS.filter((w) => wallets.includes(w.key)).map((w) => {
                    const on = (r.wallets || []).includes(w.key);
                    return <button key={w.key} type="button" className={'chip sm' + (on ? ' on' : '')} aria-pressed={on} onClick={() => upd(i, { wallets: toggle(r.wallets || [], w.key) })}>{on ? '✓ ' : ''}{w.label}</button>;
                  })}
                </div>
              </div>
            )}
            {activeMachines.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">مكن عليه (فيزا وغيره) · المكنة اللي تتعلم هنا بتتشال من الأساسي</span>
                <div className="chips">
                  {activeMachines.map((m) => {
                    const on = (r.machineIds || []).includes(m.id);
                    return <button key={m.id} type="button" className={'chip sm' + (on ? ' on' : '')} aria-pressed={on} onClick={() => upd(i, { machineIds: toggle(r.machineIds || [], m.id) })}>{on ? '✓ ' : ''}{m.name}</button>;
                  })}
                </div>
              </div>
            )}
            <div className="spread">
              <span className="tiny muted">{busy ? `شغّال دلوقتي: ${openShifts[r.id].cashierName}` : ''}</span>
              {busy ? <span className="tiny muted">مينفعش توقفه وهو شغّال</span> : (
                <button type="button" className="link" onClick={() => upd(i, { active: r.active === false })}>{r.active === false ? 'فعّله تاني' : 'وقّفه'}</button>
              )}
            </div>
          </div>
        );
      })}
      <div className="chips">
        <button type="button" className="btn soft sm" onClick={() => onChange([...list, newRegister('sub')])}><Icon d="plus" />كاشير فرعي</button>
        <button type="button" className="btn soft sm" onClick={() => onChange([...list, newRegister('delivery')])}><Icon d="plus" />درج دليفري</button>
      </div>
    </section>
  );
}

const SLOTS = ['صباحي', 'مسائي', 'سهر'];

function Cashiers({ shop, pub }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [phone, setPhone] = useState('');
  const [slot, setSlot] = useState('');
  const [color, setColor] = useState(AVATAR_BG[0]);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const all = (pub?.cashiers || []).map((c) => ({ ...c, photo: pub?.photos?.[c.uid] || c.photo || null }));
  const active = all.filter((c) => !c.disabled);
  const stopped = all.filter((c) => c.disabled);

  const writeList = (list) => setDoc(doc(db, 'shopsPublic', shop.id), { cashiers: list }, { merge: true });

  const add = async () => {
    if (!name.trim()) { toast('اكتب اسم الكاشير', 'err'); return; }
    const un = normUsername(username);
    if (!USERNAME_RE.test(un)) { toast('اسم الدخول كلمة واحدة من غير رموز (حرفين على الأقل)، زي شوقي أو shawky أو رقم موبايله', 'err'); return; }
    if (!/^[0-9]{4,8}$/.test(pin)) { toast('الرقم السري لازم من 4 لـ 8 أرقام', 'err'); return; }
    setBusy(true);
    try {
      const email = cashierEmail(un);
      const uid = await createAccount(email, cashierPassword(pin));
      const c = { uid, name: name.trim(), username: un, color, photo: photo || null };
      await setDoc(doc(db, 'users', uid), { role: 'cashier', name: c.name, username: un, email, color, photo: c.photo, phone: phone.trim(), slot, startDate: todayKey(), shopIds: [shop.id], createdAt: serverTimestamp() });
      setDoc(doc(db, 'cashierSecrets', uid), { pin, updatedAt: serverTimestamp() }).catch(() => {});
      await writeList([...all, c]);
      logAct('cashier_add', `ضاف الكاشير ${c.name} (${un}) في ${shop.name}`, { shopId: shop.id });
      setName(''); setUsername(''); setPin(''); setPhone(''); setSlot(''); setPhoto(null);
      toast(`${c.name} اتضاف · يدخل بـ ${un} والرقم السري ${pin}`);
    } catch (e) {
      console.error(e);
      toast(e.code === 'auth/email-already-in-use' ? `اسم الدخول ${un} مستخدم قبل كده، اختار اسم تاني` : 'مش قادرين نضيف الكاشير، اتأكد من النت', 'err');
    }
    setBusy(false);
  };

  const changePhoto = async (c) => {
    const data = await pickImage(300, 0.8);
    if (!data) return;
    await updateDoc(doc(db, 'users', c.uid), { photo: data });
    await setDoc(doc(db, 'shopsPublic', shop.id), { cashiers: all.map((x) => (x.uid === c.uid ? { ...x, photo: data } : x)), photos: { [c.uid]: data } }, { merge: true });
    logAct('cashier_edit', `غيّر صورة الكاشير ${c.name}`, { shopId: shop.id });
    toast('الصورة اتغيرت');
  };

  return (
    <section className="card tint-lime">
      <h2 className="h2">الكاشيرية</h2>
      <div className="stack">
        {active.map((c) => <CashierRow key={c.uid} c={c} shop={shop} all={all} writeList={writeList} open={open === c.uid} onToggle={() => setOpen(open === c.uid ? null : c.uid)} onPhoto={() => changePhoto(c)} />)}
        {active.length === 0 && <span className="muted small">لسه مفيش كاشيرية</span>}
        {stopped.length > 0 && <span className="small muted" style={{ marginTop: 6 }}>موقوفين</span>}
        {stopped.map((c) => <CashierRow key={c.uid} c={c} shop={shop} all={all} writeList={writeList} open={open === c.uid} onToggle={() => setOpen(open === c.uid ? null : c.uid)} onPhoto={() => changePhoto(c)} />)}
      </div>
      <div style={{ background: 'rgba(255,255,255,.85)', borderRadius: 22, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <button type="button" onClick={async () => { const d = await pickImage(300, 0.8); if (d) setPhoto(d); }} style={{ border: 0, background: 'transparent', padding: 0 }} aria-label="صورة الكاشير" title="صورة (اختياري)"><Avatar name={name} photo={photo} color={color} size={52} /></button>
        <label className="field" style={{ flex: '1 1 170px' }}>الاسم<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>اسم الدخول<input className="input" dir="auto" autoCapitalize="none" placeholder="شوقي أو 010…" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="field" style={{ width: 120 }}>الرقم السري<input className="input" inputMode="numeric" maxLength={8} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="field" style={{ width: 150 }}>الموبايل<input className="input" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field" style={{ width: 120 }}>الوردية
          <select className="input" value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">—</option>{SLOTS.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <div className="chips" style={{ gap: 6 }} role="group" aria-label="اللون">
          {AVATAR_BG.map((c) => <button key={c} type="button" aria-label={`لون ${c}`} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 999, background: c, border: color === c ? '3px solid var(--ink)' : '3px solid #fff' }} />)}
        </div>
        <button type="button" className="btn sm" onClick={add} disabled={busy}><Icon d="plus" size={16} />{busy ? 'لحظة…' : 'إضافة كاشير'}</button>
      </div>
      <span className="tiny muted">الكاشير بيدخل من صفحة الدخول باسم الدخول والرقم السري، وبيفتحله محله على طول. اسم الدخول ممكن يبقى عربي أو إنجليزي أو رقم موبايل، ومينفعش يتكرر في كل المحلات. دوس على اسم الكاشير علشان تشوف تفاصيله.</span>
    </section>
  );
}

function CashierRow({ c, shop, all, writeList, open, onToggle, onPhoto }) {
  const toast = useToast();
  const [pinOpen, setPinOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const u1 = onSnapshot(doc(db, 'users', c.uid), (s) => { const d = s.data() || {}; setInfo(d); setForm((f) => f || { phone: d.phone || '', slot: d.slot || '', startDate: d.startDate || '', notes: d.notes || '' }); }, () => {});
    const month = todayKey().slice(0, 7);
    Promise.all([
      getDocs(query(collection(db, 'shifts'), where('shopId', '==', shop.id), where('cashierUid', '==', c.uid))),
      getDocs(query(collection(db, 'ledger'), where('shopId', '==', shop.id), where('cashierUid', '==', c.uid))),
    ]).then(([sh, lg]) => {
      const shifts = sh.docs.map((d) => d.data());
      const thisMonth = shifts.filter((x) => x.month === month);
      const mins = thisMonth.reduce((a, x) => a + (minutesBetween(x.openedAt || x.openedAtLocal, x.submittedAt) || 0), 0);
      const led = lg.docs.map((d) => d.data()).filter((x) => x.month === month);
      setStats({
        total: shifts.length, month: thisMonth.length, mins,
        short: led.filter((x) => x.kind === 'shortage').reduce((a, x) => a + num(x.amount), 0),
        over: led.filter((x) => x.kind === 'overage').reduce((a, x) => a + num(x.amount), 0),
      });
    }).catch(() => setStats({ error: true }));
    return () => u1();
  }, [open, c.uid, shop.id]);

  const save = async () => {
    try { await updateDoc(doc(db, 'users', c.uid), form); logAct('cashier_edit', `عدّل بيانات الكاشير ${c.name}`); toast('اتحفظ'); } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  const setDisabled = async (disabled) => {
    if (disabled && !window.confirm(`توقف ${c.name}؟ مش هيقدر يدخل، ووردياته هتفضل محفوظة.`)) return;
    try {
      await updateDoc(doc(db, 'users', c.uid), { disabled });
      await writeList(all.map((x) => (x.uid === c.uid ? { ...x, disabled } : x)));
      logAct('cashier_edit', `${disabled ? 'وقّف' : 'فعّل'} الكاشير ${c.name}`);
      toast(disabled ? 'اتوقف' : 'اتفعّل تاني');
    } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  const remove = async () => {
    if (!stats || stats.error) { toast('استنى لحد ما التفاصيل تحمّل', 'err'); return; }
    if (stats.total > 0) { toast('مينفعش يتحذف علشان عليه ورديات · تقدر توقفه', 'err'); return; }
    if (!window.confirm(`تحذف ${c.name} نهائي؟`)) return;
    try {
      await updateDoc(doc(db, 'users', c.uid), { disabled: true, deleted: true });
      await writeList(all.filter((x) => x.uid !== c.uid));
      logAct('cashier_edit', `حذف الكاشير ${c.name}`);
      toast('اتحذف');
    } catch { toast('مش قادرين نحذف', 'err'); }
  };
  const hm = (m) => `${Math.floor(m / 60)} س ${m % 60} د`;

  return (
    <div style={{ background: '#fff', borderRadius: 22, padding: '10px 12px', opacity: c.disabled ? 0.65 : 1 }}>
      <div className="spread">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onPhoto} style={{ border: 0, background: 'transparent', padding: 0 }} aria-label={`غيّر صورة ${c.name}`} title="غيّر الصورة"><Avatar name={c.name} photo={c.photo} color={c.color} size={44} /></button>
          <button type="button" onClick={onToggle} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'right' }} aria-expanded={open}>
            <strong>{c.name}</strong>{c.disabled && <span className="badge bad" style={{ marginInlineStart: 6 }}>موقوف</span>}
            <span className="tiny" style={{ display: 'block', textAlign: 'right' }}>{c.username ? `دخول: ${c.username}` : 'اتعمل بالطريقة القديمة · امسحه وضيفه تاني'}</span>
            <span className="tiny muted" style={{ display: 'block' }}>{open ? 'اقفل التفاصيل' : 'التفاصيل'}</span>
          </button>
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          {c.disabled
            ? <button type="button" className="chip sm" onClick={() => setDisabled(false)}>تفعيل تاني</button>
            : <button type="button" className="chip sm" onClick={() => setDisabled(true)}>إيقاف</button>}
        </span>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 12, gap: 12 }}>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            {[['ورديات الشهر', stats ? stats.month ?? '—' : '…'], ['ساعات الشهر', stats && !stats.error ? hm(stats.mins) : '…'], ['عجز الشهر', stats && !stats.error ? fmt(stats.short) : '…'], ['زيادة الشهر', stats && !stats.error ? fmt(stats.over) : '…'], ['كل وردياته', stats ? stats.total ?? '—' : '…']].map(([l, v]) => (
              <div key={l} style={{ background: 'var(--bg)', borderRadius: 16, padding: '10px 12px' }}><div className="tiny muted">{l}</div><div style={{ fontWeight: 700, fontSize: 18 }}>{v}</div></div>
            ))}
          </div>
          {form && (
            <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 150px' }}>الموبايل<input className="input" dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="field" style={{ flex: '1 1 120px' }}>الوردية<select className="input" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}><option value="">—</option>{SLOTS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field" style={{ flex: '1 1 150px' }}>بدأ الشغل<input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
              <label className="field" style={{ flex: '2 1 220px' }}>ملاحظات<input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <button type="button" className="btn sm" onClick={save}>حفظ</button>
            </div>
          )}
          {c.username && (
            <div className="spread" style={{ background: 'var(--bg)', borderRadius: 16, padding: '10px 12px' }}>
              <span className="small"><b>الرقم السري</b> · <span className="muted">يدخل بـ {c.username}</span></span>
              <button type="button" className="btn sm soft" onClick={() => setPinOpen(true)}><Icon d="lock" size={16} />تغيير الرقم السري</button>
            </div>
          )}
          {pinOpen && <PinChange c={c} info={info} onClose={() => setPinOpen(false)} />}
          <div className="spread">
            <span className="tiny muted">{info?.createdAt ? `اتضاف ${dateStr(info.createdAt)}` : ''}</span>
            {stats && !stats.error && stats.total === 0
              ? <button type="button" className="link" style={{ color: 'var(--red)' }} onClick={remove}>حذف نهائي</button>
              : <span className="tiny muted">مينفعش يتحذف علشان عليه ورديات</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const ACCOUNT_GROUPS = [
  { id: 'acc', title: 'المحاسبين والمراجعين', roles: ['accountant', 'reviewer'], hint: 'بيراجعوا الورديات ويقفلوها', tint: '' },
  { id: 'own', title: 'المديرين والأونرز', roles: ['manager', 'owner'], hint: 'بيشوفوا التقارير والخزن بتاعة محلاتهم', tint: 'tint-violet' },
  { id: 'sup', title: 'دعم مدقق', roles: ['support'], hint: 'زي الإدارة: بيضيفوا محلات ويشيكوا على كله، بس مايقدروش يعدّلوا حسابات الإدارة', tint: 'tint-lime' },
  { id: 'adm', title: 'إدارة مدقق', roles: ['admin'], hint: 'بيشوفوا كل المحلات ويعدّلوا الإعدادات', tint: 'tint-blue' },
];

function StaffPassChange({ u, onClose }) {
  const toast = useToast();
  const [known, setKnown] = useState(undefined);
  const [old, setOld] = useState('');
  const [a, setA] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getDoc(doc(db, 'cashierSecrets', u.id)).then((s) => setKnown(s.exists() ? s.data().password || null : null)).catch(() => setKnown(null));
  }, [u.id]);
  const save = async () => {
    const cur = known || old;
    if (!cur) { toast('اكتب الباسورد الحالي', 'err'); return; }
    if (a.length < 6) { toast('الباسورد الجديد 6 حروف أو أرقام على الأقل', 'err'); return; }
    setBusy(true);
    try {
      await changeAccountPassword(u.email, cur, a);
      await setDoc(doc(db, 'cashierSecrets', u.id), { password: a, updatedAt: serverTimestamp() }, { merge: true });
      logAct('password', `غيّر باسورد ${u.name}`);
      toast(`الباسورد بتاع ${u.name} اتغيّر · ابعتهوله`);
      onClose();
    } catch (e) {
      console.error(e);
      toast(['auth/invalid-credential', 'auth/wrong-password'].includes(e.code) ? 'الباسورد الحالي غلط' : e.code === 'auth/too-many-requests' ? 'محاولات كتير، استنى شوية' : 'مش قادرين نغيّره، اتأكد من النت', 'err');
      setBusy(false);
    }
  };
  const reset = async () => {
    try { await sendPasswordResetEmail(auth, u.email); logAct('password', `بعت رابط تغيير باسورد لـ ${u.name}`); toast(`بعتنا رابط تغيير الباسورد على ${u.email}`); onClose(); } catch { toast('مش قادرين نبعت الإيميل · اتأكد إن الإيميل حقيقي', 'err'); }
  };
  return (
    <Modal title={`باسورد ${u.name}`} icon="lock" color="var(--violet)" onClose={onClose} width={440}>
      {known === undefined ? <span className="muted">لحظة…</span> : (
        <>
          <span className="tiny muted" dir="ltr" style={{ textAlign: 'right' }}>{u.email}</span>
          {known ? (
            <span className="small" style={{ background: 'var(--bg)', borderRadius: 14, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>الباسورد الحالي: <b dir="ltr">{show ? known : '••••••'}</b></span>
              <button type="button" className="link" onClick={() => setShow(!show)}>{show ? 'خبّيه' : 'اعرضه'}</button>
            </span>
          ) : (
            <label className="field">الباسورد الحالي
              <input className="input" dir="ltr" value={old} onChange={(e) => setOld(e.target.value)} />
              <span className="tiny muted">مش متسجل عندنا لأن الحساب اتعمل قبل الميزة دي · بعد أول تغيير هيبقى متسجل</span>
            </label>
          )}
          <label className="field">الباسورد الجديد<input className="input" dir="ltr" value={a} onChange={(e) => setA(e.target.value)} placeholder="6 حروف أو أرقام على الأقل" autoFocus /></label>
          <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'حفظ الباسورد الجديد'}</button>
          {!known && <button type="button" className="link" onClick={reset}>مش فاكر الباسورد الحالي؟ ابعت رابط تغيير على إيميله</button>}
        </>
      )}
    </Modal>
  );
}

function PinChange({ c, info, onClose }) {
  const toast = useToast();
  const [known, setKnown] = useState(undefined);
  const [oldPin, setOldPin] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getDoc(doc(db, 'cashierSecrets', c.uid)).then((s) => setKnown(s.exists() ? s.data().pin : null)).catch(() => setKnown(null));
  }, [c.uid]);
  const save = async () => {
    const old = known || oldPin;
    if (!/^[0-9]{4,8}$/.test(old)) { toast('اكتب الرقم السري القديم', 'err'); return; }
    if (!/^[0-9]{4,8}$/.test(a)) { toast('الرقم الجديد لازم من 4 لـ 8 أرقام', 'err'); return; }
    if (a !== b) { toast('الرقمين مش زي بعض', 'err'); return; }
    setBusy(true);
    try {
      await changeAccountPassword(info?.email || cashierEmail(c.username), cashierPassword(old), cashierPassword(a));
      await setDoc(doc(db, 'cashierSecrets', c.uid), { pin: a, updatedAt: serverTimestamp() });
      logAct('password', `غيّر الرقم السري بتاع الكاشير ${c.name}`);
      toast(`الرقم السري بتاع ${c.name} اتغيّر · يدخل بـ ${c.username} والرقم ${a}`);
      onClose();
    } catch (e) {
      console.error(e);
      toast(['auth/invalid-credential', 'auth/wrong-password'].includes(e.code) ? 'الرقم القديم غلط' : e.code === 'auth/too-many-requests' ? 'محاولات كتير، استنى شوية' : 'مش قادرين نغيّره، اتأكد من النت', 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title={`الرقم السري · ${c.name}`} icon="lock" color="var(--violet)" onClose={onClose} width={420}>
      {known === undefined ? <span className="muted">لحظة…</span> : (
        <>
          {known ? (
            <span className="small" style={{ background: 'var(--bg)', borderRadius: 14, padding: '10px 12px' }}>الرقم الحالي: <b dir="ltr">{known}</b></span>
          ) : (
            <label className="field">الرقم السري القديم
              <input className="input" inputMode="numeric" maxLength={8} dir="ltr" value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} />
              <span className="tiny muted">مش متسجل عندنا لأن الكاشير اتعمل قبل الميزة دي · بعد أول تغيير هيبقى متسجل</span>
            </label>
          )}
          <label className="field">الرقم الجديد (من 4 لـ 8 أرقام)<input className="input" inputMode="numeric" maxLength={8} dir="ltr" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
          <label className="field">اكتبه تاني<input className="input" inputMode="numeric" maxLength={8} dir="ltr" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} /></label>
          <button type="button" className="btn full" onClick={save} disabled={busy}>{busy ? 'لحظة…' : 'حفظ الرقم الجديد'}</button>
        </>
      )}
    </Modal>
  );
}

const PEOPLE_GROUPS = [
  { role: 'manager', title: 'مدير الفرع', hint: 'بيوصله تقرير كل وردية بعد التقفيل' },
  { role: 'owner', title: 'الأونر', hint: 'بيشوف تقارير المحل كلها' },
  { role: 'accountant', title: 'المحاسبين', hint: 'بيراجعوا ورديات المحل ويقفلوها' },
  { role: 'reviewer', title: 'المراجعين', hint: 'بيتابعوا ويراجعوا ورا المحاسبين' },
];

function ShopPeople({ shop }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  useEffect(() => onSnapshot(collection(db, 'users'), (q) => setUsers(q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.disabled)), () => {}), []);
  const toggle = async (u) => {
    const ids = u.shopIds || [];
    const on = ids.includes(shop.id);
    try {
      await updateDoc(doc(db, 'users', u.id), { shopIds: on ? ids.filter((x) => x !== shop.id) : [...ids, shop.id] });
      logAct('access', on ? `شال ${u.name} من ${shop.name}` : `ضاف ${u.name} على ${shop.name}`, { shopId: shop.id });
      toast(on ? `${u.name} اتشال من ${shop.name}` : `${u.name} بقى على ${shop.name}`);
    } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  return (
    <section className="card" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h2">المسؤولين عن المحل</h2>
        <span className="tiny muted">اختار مين يتابع المحل ده. لو الاسم مش موجود اعمله حساب من «حسابات الموظفين».</span>
      </div>
      {PEOPLE_GROUPS.map((g) => {
        const list = users.filter((u) => u.role === g.role);
        return (
          <div key={g.role} className="stack">
            <span className="small"><b>{g.title}</b> <span className="muted">· {g.hint}</span></span>
            <div className="chips">
              {list.map((u) => {
                const on = (u.shopIds || []).includes(shop.id);
                return (
                  <button key={u.id} type="button" className={'chip sm' + (on ? ' on' : '')} onClick={() => toggle(u)} aria-pressed={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingInlineStart: 6 }}>
                    <Avatar name={u.name} photo={u.photo} color={u.color || '#4CC3FF'} size={28} />{u.name}{on ? ' ✓' : ''}
                  </button>
                );
              })}
              {list.length === 0 && <span className="tiny muted">مفيش حسابات بالدور ده لسه</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function StaffAccounts({ shops, profile }) {
  // Support can do everything except touch Modaqqeq admin accounts or make new admins.
  const isSupport = profile?.role === 'support';
  const roleOptions = ['accountant', 'reviewer', 'manager', 'owner', 'support', ...(isSupport ? [] : ['admin'])];
  const locked = (u) => isSupport && u.role === 'admin';
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
  const [passFor, setPassFor] = useState(null);
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
      setDoc(doc(db, 'cashierSecrets', uid), { password: pass, updatedAt: serverTimestamp() }).catch(() => {});
      logAct('staff_add', `عمل حساب ${ROLE_LABEL[role] || role} لـ ${name.trim()} (${email.trim()})`);
      setForm({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
      toast('الحساب اتعمل · ابعتله الإيميل والباسورد');
    } catch (e) {
      toast(e.code === 'auth/email-already-in-use' ? 'الإيميل ده متسجل قبل كده' : 'مش قادرين نعمل الحساب', 'err');
    }
    setBusy(false);
  };

  const update = (u, patch) => updateDoc(doc(db, 'users', u.id), patch).then(() => { logAct('staff_edit', `عدّل حساب ${u.name}${patch.role ? ` · بقى ${ROLE_LABEL[patch.role] || patch.role}` : ''}${'disabled' in patch ? (patch.disabled ? ' · اتوقف' : ' · اتفعّل') : ''}`); toast('اتحفظ'); }).catch(() => toast('مش قادرين نحفظ', 'err'));

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
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        </div>
        {!isAdminRole(form.role) && (
          <div className="stack"><span className="small muted">المحلات اللي هيشوفها</span>
            <div className="chips">{shops.map((s) => <button key={s.id} type="button" className={'chip sm' + (form.shopIds.includes(s.id) ? ' on' : '')} onClick={() => setForm({ ...form, shopIds: toggleShop(form.shopIds, s.id) })}>{s.name}</button>)}</div>
          </div>
        )}
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={busy}><Icon d="plus" />{busy ? 'لحظة…' : 'اعمل الحساب'}</button>
      </section>
      {ACCOUNT_GROUPS.map((g) => {
        const list = users.filter((u) => g.roles.includes(u.role));
        if (!list.length && g.id !== 'acc') return null;
        return (
          <section key={g.id} className={'card ' + g.tint} style={{ gap: 0 }}>
            <h2 className="h2" style={{ marginBottom: 2 }}>{g.title} <span className="tiny muted" style={{ fontWeight: 500 }}>· {list.length}</span></h2>
            <span className="tiny muted" style={{ marginBottom: 8 }}>{g.hint}</span>
            {list.length === 0 && <div className="empty">مفيش حسابات هنا لسه</div>}
            {list.map((u) => (
              <div key={u.id} className="list-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={u.name} color={u.color || '#4CC3FF'} size={40} />
                  <span className="stack" style={{ gap: 0 }}><strong>{u.name}</strong><span className="tiny muted" dir="ltr">{u.email}</span></span>
                </span>
                <select className="input" style={{ width: 150, height: 44 }} value={u.role} onChange={(e) => update(u, { role: e.target.value })} aria-label={`دور ${u.name}`}>
                  {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {u.role !== 'admin' && (
                  <div className="chips" style={{ flex: '1 1 260px' }}>
                    {shops.map((s) => <button key={s.id} type="button" className={'chip sm' + ((u.shopIds || []).includes(s.id) ? ' on' : '')} onClick={() => update(u, { shopIds: toggleShop(u.shopIds || [], s.id) })}>{shopName(s.id)}</button>)}
                  </div>
                )}
                {!locked(u) && <button type="button" className="btn sm soft" onClick={() => setPassFor(u)} aria-label={`غيّر باسورد ${u.name}`}><Icon d="lock" size={15} />الباسورد</button>}
                {!locked(u) && <button type="button" className="copy" aria-label={`اقفل حساب ${u.name}`} title="اقفل الحساب" onClick={() => window.confirm(`تقفل حساب ${u.name}؟`) && update(u, { disabled: true })}><Icon d="trash" size={16} /></button>}
              </div>
            ))}
          </section>
        );
      })}
      <section style={{ display: 'contents' }}>
        {passFor && <StaffPassChange u={passFor} onClose={() => setPassFor(null)} />}
      </section>
    </div>
  );
}
