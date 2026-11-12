import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from '../firebase';
import { Avatar, Icon, Modal, useToast } from '../ui.jsx';
import { AVATAR_BG, BUILTIN_EXPENSE_TYPES, DEFAULT_SHOP, MACHINE_PRESETS, REG_KIND, allOpen, isAdminRole, newRegister, newExpenseType, RATE_FROM, WALLETS, WALLET_MODE, walletModesOf, ROLE_LABEL, SETTLE, settleOf, WEEKDAYS, USERNAME_RE, cashierEmail, cashierPassword, changeAccountPassword, createAccount, uidByLogin, matches, normUsername, DEFAULT_FEE_TIERS, tierFee, dateStr, flattenMachines, fmt, minutesBetween, todayKey, machineListOf, newMachine, newVault, num, pickImage } from '../lib';
import { logAct } from '../activity.js';
import { CLOUD } from '../cloud.js';
import { applyFormat, buildFormat, firstWords, parseSms } from '../smsFormat.js';

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
          {shop ? <ShopEditor key={shop.id} shop={shop} shops={shops} /> : (
            <div className="card empty" style={{ minHeight: 220, justifyContent: 'center' }}>{shops.length ? 'اختار المحل من فوق جنب لوجو مدقق علشان تعدّل إعداداته' : 'ابدأ بإضافة أول محل من «اختار المحل» فوق'}</div>
          )}
        </div>
      )}
    </div>
  );
}

function TagList({ title, items, onChange, placeholder, hint }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (!t || items.includes(t)) return; onChange([...items, t]); setV(''); };
  return (
    <div className="stack">
      <strong className="small">{title}</strong>
      {hint && <span className="tiny muted">{hint}</span>}
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

// مكون جديد مخصص للموظفين (شغال / موقوف)
function StaffList({ title, active, stopped, onChangeActive, onChangeStopped, placeholder, hint }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (!t || active.includes(t) || stopped.includes(t)) return; onChangeActive([...active, t]); setV(''); };
  const stop = (x) => { onChangeActive(active.filter((y) => y !== x)); onChangeStopped([...stopped, x]); };
  const activate = (x) => { onChangeStopped(stopped.filter((y) => y !== x)); onChangeActive([...active, x]); };
  const removeAct = (x) => { if (window.confirm(`تحذف الموظف ${x} نهائي؟`)) onChangeActive(active.filter((y) => y !== x)); };
  const removeStp = (x) => { if (window.confirm(`تحذف الموظف ${x} نهائي؟`)) onChangeStopped(stopped.filter((y) => y !== x)); };

  return (
    <div className="stack" style={{ background: 'rgba(255,255,255,0.6)', padding: 14, borderRadius: 16, border: '1px solid rgba(0,0,0,0.05)' }}>
      <strong className="small">{title}</strong>
      {hint && <span className="tiny muted">{hint}</span>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, marginTop: 4 }}>
        <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn soft sm" onClick={add}>إضافة موظف</button>
      </div>

      <span className="tiny muted" style={{ marginTop: 4 }}>شغالين دلوقتي</span>
      <div className="chips">
        {active.length === 0 && <span className="tiny muted">مفيش</span>}
        {active.map((x) => (
          <span key={x} className="chip sm on" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{x}
            <span style={{ borderInlineStart: '1px solid rgba(0,0,0,0.1)', display: 'inline-flex', paddingInlineStart: 6, gap: 4, marginInlineStart: 4 }}>
              <button type="button" onClick={() => stop(x)} title="إيقاف الموظف" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 13 }}>⏸️</button>
              <button type="button" onClick={() => removeAct(x)} title="حذف نهائي" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--red)' }}><Icon d="x" size={14} /></button>
            </span>
          </span>
        ))}
      </div>

      {stopped.length > 0 && (
        <>
          <span className="tiny muted" style={{ marginTop: 12 }}>موقوفين</span>
          <div className="chips">
            {stopped.map((x) => (
              <span key={x} className="chip sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.85 }}>{x}
                <span style={{ borderInlineStart: '1px solid rgba(0,0,0,0.1)', display: 'inline-flex', paddingInlineStart: 6, gap: 4, marginInlineStart: 4 }}>
                  <button type="button" onClick={() => activate(x)} title="تفعيل تاني" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 13 }}>▶️</button>
                  <button type="button" onClick={() => removeStp(x)} title="حذف نهائي" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--red)' }}><Icon d="x" size={14} /></button>
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MachinesEditor({ list, onChange }) {
  const [picking, setPicking] = useState(false);
  const upd = (id, patch) => onChange(list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  // Presets that are not already added to this shop.
  const left = MACHINE_PRESETS.filter((p) => !list.some((m) => m.name.trim() === p.name));
  const addPreset = (p) => { onChange([...list, { ...newMachine(), ...p }]); setPicking(false); };
  return (
    <section className="card tint-yellow" style={{ gap: 14 }}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="h2">المكن</h2>
          <span className="tiny muted">ضيف المكن اللي المحل شغّال عليها بس. المكنة اللي تقفلها مش هتظهر للكاشير.</span>
        </div>
        <button type="button" className="btn sm" onClick={() => setPicking(!picking)}><Icon d="plus" size={16} />مكنة جديدة</button>
      </div>
      {picking && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">اختار مكنة:</span>
          <div className="chips">
            {left.map((p) => <button key={p.name} type="button" className="chip" onClick={() => addPreset(p)}>{p.name}</button>)}
            <button type="button" className="chip sm" onClick={() => addPreset({})}>مكنة تانية…</button>
          </div>
        </div>
      )}
      {list.length === 0 && !picking && <div className="empty" style={{ padding: 16 }}>مفيش مكن لسه. دوس «مكنة جديدة».</div>}
      {list.map((m) => (
        <div key={m.id} style={{ background: '#fff', borderRadius: 24, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, opacity: m.active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 200px' }}>اسم المكنة<input className="input" placeholder="مثلًا فوري، ماجيك، أمان" value={m.name} onChange={(e) => upd(m.id, { name: e.target.value })} /></label>
            <label className="field" style={{ width: 130 }}>النسبة %<input className="input" inputMode="decimal" dir="ltr" placeholder="2" value={m.ratePct} onChange={(e) => upd(m.id, { ratePct: e.target.value })} /></label>
            <label className="field" style={{ width: 150 }} title="العميل بيدفع قيمة الفاتورة + النسبة دي. مثلًا 8%: الرصيد نزل 1000 يبقى الدرج فيه 1080">مقابل الخدمة %<input className="input" inputMode="decimal" dir="ltr" placeholder="0" value={m.svcPct ?? ''} onChange={(e) => upd(m.id, { svcPct: e.target.value })} /></label>
            <button type="button" className={'chip' + (m.active ? ' on' : '')} onClick={() => upd(m.id, { active: !m.active })} aria-pressed={m.active}>{m.active ? '✓ مفعّلة للمحل' : 'مقفولة'}</button>
            <button type="button" className="icon-btn" aria-label={`امسح ${m.name || 'المكنة'}`} onClick={() => window.confirm('تمسح المكنة دي من المحل؟') && onChange(list.filter((x) => x.id !== m.id))}><Icon d="trash" size={18} /></button>
          </div>
          {num(m.svcPct) > 0 && <span className="tiny" style={{ background: '#EAFBC2', borderRadius: 12, padding: '6px 10px', alignSelf: 'flex-start' }}>العميل بيدفع الفاتورة + {num(m.svcPct)}% · لو الرصيد نزل 1,000 يبقى الدرج المفروض فيه {fmt(1000 + 10 * num(m.svcPct))}</span>}
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
              <span className="small muted">أول الوردية</span>
              <div className="chips">
                <button type="button" className={'chip sm' + (!m.startZero ? ' on' : '')} onClick={() => upd(m.id, { startZero: false })}>بتستلم رصيد اللي قبلها</button>
                <button type="button" className={'chip sm' + (m.startZero ? ' on' : '')} onClick={() => upd(m.id, { startZero: true })}>بتبدأ بصفر · في التسليم بس</button>
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

// خزن رئيسية: named safes for the branch. Money can be liquidated / moved into them.
function VaultsEditor({ list, onChange, balances = {}, edits = {}, onEdit }) {
  const upd = (id, patch) => onChange(list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const has = (name) => list.some((v) => v.name.trim() === name);
  return (
    <section className="card tint-blue" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h2">الخزن الرئيسية</h2>
        <span className="tiny muted" style={{ lineHeight: 1.7 }}>خزنة بتسمّيها زي ما تحب (مثلًا «الخزنة الرئيسية»). فلوس درج الكاشير والجانبي والمحافظ والمكن بتتحوّل ليها بالتسييل أو التحويل. رصيدها بيتراكم من وردية للتانية، ويتضاف عليه لما المحاسب يقفل كل وردية. اكتب رصيدها الحالي لو فيها فلوس من قبل.</span>
      </div>
      {list.length === 0 && <div className="empty" style={{ padding: 16 }}>مفيش خزن رئيسية لسه. دوس «خزنة جديدة».</div>}
      {list.map((v) => (
        <div key={v.id} style={{ background: '#fff', borderRadius: 22, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', opacity: v.active === false ? 0.6 : 1 }}>
          <label className="field" style={{ flex: '1 1 220px' }}>اسم الخزنة<input className="input" value={v.name} placeholder="مثلًا الخزنة الرئيسية" onChange={(e) => upd(v.id, { name: e.target.value })} /></label>
          <label className="field" style={{ width: 170 }}>الرصيد الحالي (ج)<input className="input" inputMode="decimal" dir="ltr" value={edits[v.id] ?? String(num(balances[v.id]))} onChange={(e) => onEdit(v.id, e.target.value)} /></label>
          <button type="button" className={'chip' + (v.active !== false ? ' on' : '')} aria-pressed={v.active !== false} onClick={() => upd(v.id, { active: v.active === false })}>{v.active !== false ? '✓ مفعّلة' : 'مقفولة'}</button>
          <button type="button" className="icon-btn" aria-label={`امسح ${v.name || 'الخزنة'}`} onClick={() => window.confirm('تمسح الخزنة دي؟ العمليات القديمة هتفضل محفوظة.') && onChange(list.filter((x) => x.id !== v.id))}><Icon d="trash" size={18} /></button>
        </div>
      ))}
      <div className="chips">
        {!has('الخزنة الرئيسية') && <button type="button" className="chip sm" onClick={() => onChange([...list, newVault('الخزنة الرئيسية')])}>+ الخزنة الرئيسية</button>}
        <button type="button" className="chip sm on" onClick={() => onChange([...list, newVault()])}><Icon d="plus" size={14} /> خزنة جديدة</button>
      </div>
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

function ShopEditor({ shop, shops = [] }) {
  const toast = useToast();
  const [pub, setPub] = useState(null);
  const [f, setF] = useState(() => ({
    name: shop.name || '', posUrl: shop.posUrl || '', walletName: shop.walletName || '',
    shiftsCount: shop.shiftsCount || 1, firstShiftStart: shop.firstShiftStart || '09:00', shiftDuration: shop.shiftDuration || 12,
    machineList: machineListOf(shop), wallets: shop.wallets || ['insta', 'vf'], walletModes: walletModesOf(shop), walletFees: shop.walletFees || {},
    suppliers: shop.suppliers || [], staff: shop.staff || [], stoppedStaff: shop.stoppedStaff || [], partners: shop.partners || [],
    shopExpenses: shop.shopExpenses || [], customExpenseTypes: shop.customExpenseTypes || [], hiddenExpenseTypes: shop.hiddenExpenseTypes || [], incomeReasons: shop.incomeReasons || [], advanceDays: shop.advanceDays || [],
    registers: shop.registers || [], vaults: shop.vaults || [],
  }));
  const [dirty, setDirty] = useState(false);
  const [vaultEdits, setVaultEdits] = useState({}); // رصيد الخزنة اللي المحاسب عدّله بإيده (id -> رقم)
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };

  useEffect(() => onSnapshot(doc(db, 'shopsPublic', shop.id), (s) => setPub(s.data() || { cashiers: [] }), () => {}), [shop.id]);

  const save = async () => {
    try {
      const machineList = f.machineList.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim(), ratePct: num(m.ratePct), liqFeePct: num(m.liqFeePct), settle: settleOf(m), startZero: !!m.startZero, accounts: m.accounts.map((a) => a.trim()).filter(Boolean) }));
      const registers = f.registers.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim() }));
      const vaults = f.vaults.filter((v) => v.name.trim()).map((v) => ({ ...v, name: v.name.trim() }));
      const vaultUpd = Object.fromEntries(Object.entries(vaultEdits).map(([id, v]) => [`vaultBalances.${id}`, num(v)]));
      await updateDoc(doc(db, 'shops', shop.id), { ...f, registers, vaults, ...vaultUpd, machineList, machines: flattenMachines(machineList), name: f.name.trim() });
      await setDoc(doc(db, 'shopsPublic', shop.id), { name: f.name.trim() }, { merge: true });
      logAct('setup', `حفظ إعدادات محل ${f.name.trim()}`, { shopId: shop.id });
      setVaultEdits({});
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


  const [copyOpen, setCopyOpen] = useState(false);
  // Copy chosen parts of another shop's settings into this form. Nothing is saved until «حفظ».
  const copyFrom = (src, parts) => {
    const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
    const up = {};
    if (parts.shifts) Object.assign(up, { shiftsCount: src.shiftsCount || 1, firstShiftStart: src.firstShiftStart || '09:00', shiftDuration: src.shiftDuration || 12 });
    if (parts.machines) up.machineList = clone(machineListOf(src));
    if (parts.wallets) Object.assign(up, { wallets: clone(src.wallets || ['insta', 'vf']), walletModes: clone(walletModesOf(src)), walletFees: clone(src.walletFees || {}) });
    if (parts.expenses) Object.assign(up, { customExpenseTypes: clone(src.customExpenseTypes || []), hiddenExpenseTypes: clone(src.hiddenExpenseTypes || []), shopExpenses: clone(src.shopExpenses || []), advanceDays: clone(src.advanceDays || []) });
    if (parts.income) up.incomeReasons = clone(src.incomeReasons || []);
    if (parts.suppliers) up.suppliers = clone(src.suppliers || []);
    if (parts.staff) Object.assign(up, { staff: clone(src.staff || []), partners: clone(src.partners || []) });
    if (parts.registers) Object.assign(up, { registers: clone(src.registers || []), vaults: clone((src.vaults || []).map((v) => ({ ...v }))) });
    if (parts.pos) up.posUrl = src.posUrl || '';
    setF((x) => ({ ...x, ...up }));
    setDirty(true);
    setCopyOpen(false);
    toast(`اتنسخ من ${src.name} · راجع الإعدادات ودوس «حفظ»`);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {copyOpen && <CopySettings shops={shops.filter((x) => x.id !== shop.id)} target={shop} onCopy={copyFrom} onClose={() => setCopyOpen(false)} />}
      <section className="card tint-blue">
        <div className="spread">
          <h2 className="h2">بيانات المحل</h2>
          {shops.length > 1 && <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => setCopyOpen(true)}><Icon d="swap" size={16} />انسخ الإعدادات من محل تاني</button>}
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
            
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <label className="field" style={{ flex: '1 1 120px' }}>عدد الورديات
                <select className="input" value={f.shiftsCount} onChange={(e) => set('shiftsCount', num(e.target.value))}>
                  <option value="1">وردية واحدة</option>
                  <option value="2">ورديتين</option>
                  <option value="3">3 ورديات</option>
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 120px' }}>بداية أول وردية
                <input type="time" className="input" dir="ltr" value={f.firstShiftStart} onChange={(e) => set('firstShiftStart', e.target.value)} />
              </label>
              <label className="field" style={{ flex: '1 1 120px' }}>مدة الوردية (ساعات)
                <input type="number" className="input" dir="ltr" min="1" max="24" value={f.shiftDuration} onChange={(e) => set('shiftDuration', num(e.target.value))} />
              </label>
            </div>
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
              {mode === 'shop' && <FeeTiers tiers={f.walletFees[w.key]} onChange={(v) => set('walletFees', { ...f.walletFees, [w.key]: v })} />}
            </div>
          );
        })}
      </section>

      <SmsForward shop={shop} wallets={WALLETS.filter((w) => f.wallets.includes(w.key)).map((w) => ({ ...w, mode: f.walletModes[w.key] || 'owner' }))} />

      <MachinesEditor list={f.machineList} onChange={(v) => set('machineList', v)} />

      <VaultsEditor list={f.vaults} onChange={(v) => set('vaults', v)} balances={shop.vaultBalances || {}} edits={vaultEdits} onEdit={(id, v) => { setVaultEdits((x) => ({ ...x, [id]: v })); setDirty(true); }} />

      <RegistersEditor list={f.registers} machines={f.machineList} wallets={f.wallets} openShifts={shop.openShifts || {}} onChange={(v) => set('registers', v)} />

      <ExpenseTypesEditor custom={f.customExpenseTypes} hidden={f.hiddenExpenseTypes} onCustom={(v) => set('customExpenseTypes', v)} onHidden={(v) => set('hiddenExpenseTypes', v)} />

      <section className="card tint-violet" style={{ gap: 18 }}>
        <h2 className="h2">القوايم</h2>
        
        <StaffList 
          title="الموظفين (للسلف، العجز، واليوميات)" 
          active={f.staff} 
          stopped={f.stoppedStaff} 
          onChangeActive={(v) => set('staff', v)} 
          onChangeStopped={(v) => set('stoppedStaff', v)} 
          placeholder="اسم الموظف" 
          hint="الموظف الموقوف مش هيظهر قدام الكاشير، بس هيفضل متسجل في الورديات القديمة."
        />

        <TagList title="الشركاء (لمسحوبات المالك)" items={f.partners} onChange={(v) => set('partners', v)} placeholder="اسم الشريك" hint="الأسماء اللي هتظهر لما الكاشير يختار سحب المالك." />
        
        <TagList title="الموردين" items={f.suppliers} onChange={(v) => set('suppliers', v)} placeholder="اسم المورد" />
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
  { id: 'acc', title: 'المحاسبين', roles: ['accountant', 'reviewer'], hint: 'بيراجعوا الورديات ويقفلوها', tint: '' },
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
  { role: 'owner', title: 'الأونر', hint: 'صاحب المحل · بيشوف تقارير المحل كلها', own: true },
  { role: 'manager', title: 'مدير الفرع', hint: 'بيوصله تقرير كل وردية بعد التقفيل', own: true },
  { role: 'accountant', title: 'المحاسبين', hint: 'محاسبين مدقق اللي بيراجعوا ورديات المحل ويقفلوها' },
];

// Making an account with an email that is already used:
// 1) it belongs to an account in the app (maybe stopped) → give it back (turn it on, add the shops);
// 2) it is only a login with no account in the app → if the typed password is right, link it again.
async function reuseEmail({ email, pass, data }) {
  const all = (await getDocs(query(collection(db, 'users'), where('email', '==', email)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const u = all[0];
  if (u) {
    if (!window.confirm(`الإيميل ده لحساب «${u.name}» (${ROLE_LABEL[u.role] || u.role}${u.disabled ? ' · متوقف' : ''}).\nترجّعه${u.disabled ? ' وتفعّله' : ''} وتضيفه على المحلات دي؟`)) return 'cancel';
    await updateDoc(doc(db, 'users', u.id), { disabled: false, shopIds: [...new Set([...(u.shopIds || []), ...(data.shopIds || [])])], ...(u.role === 'cashier' ? {} : { role: data.role || u.role }) });
    logAct('staff_edit', `رجّع حساب ${u.name} (${email})`);
    return 'reused';
  }
  try {
    const uid = await uidByLogin(email, pass);
    await setDoc(doc(db, 'users', uid), { ...data, email, createdAt: serverTimestamp() });
    setDoc(doc(db, 'cashierSecrets', uid), { password: pass, updatedAt: serverTimestamp() }).catch(() => {});
    logAct('staff_add', `ربط إيميل قديم ${email} بحساب ${data.name}`);
    return 'linked';
  } catch {
    return 'orphan';
  }
}
const REUSE_MSG = {
  reused: 'الحساب رجع واتضاف على المحلات ✓',
  linked: 'الإيميل كان متسجل من غير حساب · اتربط بالحساب الجديد ✓',
  orphan: 'الإيميل متسجل في فايربيز من غير حساب في التطبيق، والباسورد اللي كتبته مش بتاعه. اكتب باسورده القديم، أو استخدم إيميل تاني، أو امسحه من Firebase ← Authentication',
};

// Owners and branch managers belong to their own shop: the shop shows only its people, and new ones are made from here.
// Accountants are Modaqqeq's team, so the whole team shows and you tick who follows this shop.
function ShopPeople({ shop }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(null); // role of the new-account form that is open
  const [linking, setLinking] = useState(null); // role of the "already has an account" search that is open
  const [q, setQ] = useState('');
  useEffect(() => onSnapshot(collection(db, 'users'), (qs) => setUsers(qs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.disabled)), () => {}), []);
  const setOn = async (u, on) => {
    const ids = u.shopIds || [];
    try {
      await updateDoc(doc(db, 'users', u.id), { shopIds: on ? [...new Set([...ids, shop.id])] : ids.filter((x) => x !== shop.id) });
      logAct('access', on ? `ضاف ${u.name} على ${shop.name}` : `شال ${u.name} من ${shop.name}`, { shopId: shop.id });
      toast(on ? `${u.name} بقى على ${shop.name}` : `${u.name} اتشال من ${shop.name}`);
    } catch { toast('مش قادرين نحفظ', 'err'); }
  };
  const person = (u, on, onClick) => (
    <button key={u.id} type="button" className={'chip sm' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingInlineStart: 6 }}>
      <Avatar name={u.name} photo={u.photo} color={u.color || '#4CC3FF'} size={28} />{u.name}{on ? ' ✓' : ''}
    </button>
  );
  return (
    <section className="card" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h2">المسؤولين عن المحل</h2>
        <span className="tiny muted">الأونر ومدير الفرع بيتعملوا من هنا جوه المحل. ولو حد منهم ليه حساب في محل تاني، دوس «عنده حساب في محل تاني؟».</span>
      </div>
      {PEOPLE_GROUPS.map((g) => {
        const sameRole = (u) => u.role === g.role || (g.role === 'accountant' && u.role === 'reviewer');
        const mine = users.filter((u) => sameRole(u) && (u.shopIds || []).includes(shop.id));
        if (!g.own) {
          const list = users.filter(sameRole);
          return (
            <div key={g.role} className="stack">
              <span className="small"><b>{g.title}</b> <span className="muted">· {g.hint}</span></span>
              <div className="chips">
                {list.map((u) => { const on = (u.shopIds || []).includes(shop.id); return person(u, on, () => setOn(u, !on)); })}
                {list.length === 0 && <span className="tiny muted">مفيش محاسبين لسه · اعملهم من «حسابات الموظفين»</span>}
              </div>
            </div>
          );
        }
        const others = linking === g.role ? users.filter((u) => (u.role === 'owner' || u.role === 'manager') && !(u.shopIds || []).includes(shop.id) && q.trim() && (matches(u.name, q) || matches(u.email, q))).slice(0, 8) : [];
        return (
          <div key={g.role} className="stack" style={{ background: 'var(--chip)', borderRadius: 20, padding: '12px 14px', gap: 10 }}>
            <span className="small"><b>{g.title}</b> <span className="muted">· {g.hint}</span></span>
            <div className="chips">
              {mine.map((u) => person(u, true, () => window.confirm(`تشيل ${u.name} من ${shop.name}؟ (الحساب نفسه مش هيتمسح)`) && setOn(u, false)))}
              {mine.length === 0 && <span className="tiny muted">مفيش {g.title} للمحل ده لسه</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" onClick={() => { setAdding(adding === g.role ? null : g.role); setLinking(null); }}><Icon d="plus" size={16} />{g.title} جديد</button>
              <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => { setLinking(linking === g.role ? null : g.role); setAdding(null); setQ(''); }}>عنده حساب في محل تاني؟</button>
            </div>
            {adding === g.role && <NewPerson role={g.role} shop={shop} count={users.length} onDone={() => setAdding(null)} />}
            {linking === g.role && (
              <div className="stack" style={{ gap: 8 }}>
                <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب اسمه أو إيميله…" />
                {q.trim() && !others.length && <span className="tiny muted">مفيش حد بالاسم ده · اعمله حساب جديد</span>}
                <div className="chips">{others.map((u) => person(u, false, () => { setOn(u, true); setLinking(null); }))}</div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function NewPerson({ role, shop, count, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', pass: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!f.name.trim() || !f.email.trim() || f.pass.length < 6) { toast('اكتب الاسم والإيميل وباسورد 6 حروف على الأقل', 'err'); return; }
    setBusy(true);
    try {
      const uid = await createAccount(f.email.trim(), f.pass);
      await setDoc(doc(db, 'users', uid), { role, name: f.name.trim(), email: f.email.trim(), shopIds: [shop.id], color: AVATAR_BG[count % AVATAR_BG.length], createdAt: serverTimestamp() });
      setDoc(doc(db, 'cashierSecrets', uid), { password: f.pass, updatedAt: serverTimestamp() }).catch(() => {});
      logAct('staff_add', `عمل حساب ${ROLE_LABEL[role] || role} لـ ${f.name.trim()} في ${shop.name}`, { shopId: shop.id });
      toast('الحساب اتعمل · ابعتله الإيميل والباسورد');
      onDone();
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        const r = await reuseEmail({ email: f.email.trim(), pass: f.pass, data: { role, name: f.name.trim(), shopIds: [shop.id], color: AVATAR_BG[count % AVATAR_BG.length] } }).catch(() => 'orphan');
        if (r !== 'cancel') toast(REUSE_MSG[r], r === 'orphan' ? 'err' : undefined);
        if (r === 'reused' || r === 'linked') { onDone(); return; }
      } else toast('مش قادرين نعمل الحساب', 'err');
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
      <label className="field" style={{ flex: '1 1 160px' }}>الاسم<input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field" style={{ flex: '1 1 200px' }}>الإيميل<input className="input" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field" style={{ flex: '1 1 140px' }}>الباسورد<input className="input" dir="ltr" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} /></label>
      <button type="button" className="btn" onClick={go} disabled={busy}>{busy ? 'لحظة…' : 'اعمل الحساب'}</button>
    </div>
  );
}

// The shops of one account: only the ones it has, plus a search to add another (instead of all the shops as buttons).
function ShopsOf({ shops, ids, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const mine = ids.map((id) => shops.find((s) => s.id === id)).filter(Boolean);
  const found = q.trim() ? shops.filter((s) => !ids.includes(s.id) && matches(s.name, q)).slice(0, 8) : [];
  return (
    <div className="stack" style={{ gap: 6, flex: '1 1 260px' }}>
      <div className="chips">
        {mine.map((s) => <button key={s.id} type="button" className="chip sm on" title="دوس علشان تشيله" onClick={() => onChange(ids.filter((x) => x !== s.id))}>{s.name} ✕</button>)}
        {!mine.length && <span className="tiny muted">مش على أي محل</span>}
        <button type="button" className="chip sm" onClick={() => { setOpen(!open); setQ(''); }}>＋ محل</button>
      </div>
      {open && (
        <div className="stack" style={{ gap: 6 }}>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب اسم المحل…" style={{ height: 44 }} />
          <div className="chips">{found.map((s) => <button key={s.id} type="button" className="chip sm" onClick={() => { onChange([...ids, s.id]); setQ(''); setOpen(false); }}>{s.name}</button>)}</div>
          {q.trim() && !found.length && <span className="tiny muted">مفيش محل بالاسم ده</span>}
        </div>
      )}
    </div>
  );
}

function StaffAccounts({ shops, profile }) {
  // Support can do everything except touch Modaqqeq admin accounts or make new admins.
  const isSupport = profile?.role === 'support';
  const roleOptions = ['accountant', 'manager', 'owner', 'support', ...(isSupport ? [] : ['admin'])];
  const locked = (u) => isSupport && u.role === 'admin';
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
  const [passFor, setPassFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState([]);
  useEffect(() => onSnapshot(collection(db, 'users'), (q) => {
    const all = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.role !== 'cashier');
    setUsers(all.filter((u) => !u.disabled));
    setStopped(all.filter((u) => u.disabled));
  }, () => {}), []);
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
      if (e.code === 'auth/email-already-in-use') {
        const r = await reuseEmail({ email: email.trim(), pass, data: { role, name: name.trim(), shopIds, color: AVATAR_BG[users.length % AVATAR_BG.length] } }).catch(() => 'orphan');
        if (r !== 'cancel') toast(REUSE_MSG[r], r === 'orphan' ? 'err' : undefined);
        if (r === 'reused' || r === 'linked') setForm({ name: '', email: '', pass: '', role: 'accountant', shopIds: [] });
      } else toast('مش قادرين نعمل الحساب', 'err');
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
            <ShopsOf shops={shops} ids={form.shopIds} onChange={(ids) => setForm({ ...form, shopIds: ids })} />
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
                  <Avatar name={u.name} photo={u.photo} color={u.color || '#4CC3FF'} size={40} />
                  <span className="stack" style={{ gap: 0 }}><strong>{u.name}</strong><span className="tiny muted" dir="ltr">{u.email}</span></span>
                </span>
                <select className="input" style={{ width: 150, height: 44 }} value={u.role === 'reviewer' ? 'accountant' : u.role} onChange={(e) => update(u, { role: e.target.value })} aria-label={`دور ${u.name}`}>
                  {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {u.role !== 'admin' && (
                  <ShopsOf shops={shops} ids={u.shopIds || []} onChange={(ids) => update(u, { shopIds: ids })} />
                )}
                {!locked(u) && <button type="button" className="btn sm soft" onClick={() => setPassFor(u)} aria-label={`غيّر باسورد ${u.name}`}><Icon d="lock" size={15} />الباسورد</button>}
                {!locked(u) && <button type="button" className="copy" aria-label={`اقفل حساب ${u.name}`} title="اقفل الحساب" onClick={() => window.confirm(`تقفل حساب ${u.name}؟`) && update(u, { disabled: true })}><Icon d="trash" size={16} /></button>}
              </div>
            ))}
          </section>
        );
      })}
      {stopped.length > 0 && (
        <section className="card" style={{ gap: 8 }}>
          <details>
            <summary className="h2" style={{ cursor: 'pointer' }}>حسابات متوقفة <span className="tiny muted" style={{ fontWeight: 500 }}>· {stopped.length} · مش بيقدروا يدخلوا</span></summary>
            <div className="stack" style={{ gap: 0, marginTop: 8 }}>
              {stopped.map((u) => (
                <div key={u.id} className="list-row" style={{ gap: 10 }}>
                  <Avatar name={u.name} photo={u.photo} color={u.color || '#B4B2C9'} size={36} />
                  <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
                    <strong>{u.name} <span className="tiny muted">· {ROLE_LABEL[u.role] || u.role}</span></strong>
                    <span className="tiny muted" dir="ltr" style={{ textAlign: 'end' }}>{u.email}</span>
                  </span>
                  <button type="button" className="btn sm" onClick={() => update(u, { disabled: false })}>فعّله تاني</button>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
      <section style={{ display: 'contents' }}>
        {passFor && <StaffPassChange u={passFor} onClose={() => setPassFor(null)} />}
      </section>
    </div>
  );
}

// Service fee the customer pays on each wallet operation: up to 500 → 5, up to 800 → 10 …
function FeeTiers({ tiers, onChange }) {
  const list = tiers && tiers.length ? tiers : DEFAULT_FEE_TIERS;
  const upd = (i, k, v) => onChange(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  let from = 0;
  return (
    <div className="stack" style={{ gap: 8, background: '#F7F6FB', borderRadius: 16, padding: '10px 12px' }}>
      <span className="small"><b>مقابل الخدمة على العميل</b> <span className="muted">· بيتحسب على كل رسالة داخل أو طالع</span></span>
      {list.map((x, i) => {
        const lo = from; from = num(x.upTo) || from;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="small" style={{ minWidth: 54 }}>من {fmt(lo)}</span>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>لحد<input className="input" style={{ width: 96, height: 40 }} inputMode="decimal" dir="ltr" value={x.upTo} onChange={(e) => upd(i, 'upTo', e.target.value)} /></label>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>الخدمة<input className="input" style={{ width: 80, height: 40 }} inputMode="decimal" dir="ltr" value={x.fee} onChange={(e) => upd(i, 'fee', e.target.value)} />ج</label>
            <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label="امسح السطر" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon d="trash" size={14} /></button>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm soft" style={{ height: 38 }} onClick={() => onChange([...list, { upTo: (num(list[list.length - 1]?.upTo) || 0) + 500, fee: num(list[list.length - 1]?.fee) || 0 }])}><Icon d="plus" size={14} />سطر</button>
        <button type="button" className="link" onClick={() => onChange(DEFAULT_FEE_TIERS)}>رجّع الأرقام الأصلية</button>
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.7 }}>مثال: وصل للمحفظة {fmt(100 + tierFee(100, list))} يعني العميل اشترى بـ 100 والخدمة {fmt(tierFee(100, list))} · وصل {fmt(700 + tierFee(700, list))} يعني باع بـ 700. فوق آخر سطر بياخد آخر رقم خدمة.</span>
    </div>
  );
}

// ── Bank SMS on the owner's phone → the shop app ──
// Each wallet gets a secret link. A small app on the owner's Android phone (MacroDroid) sends every
// "you received a transfer" SMS to that link; the cashier then confirms which ones are his customers'.
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
function SmsForward({ shop, wallets }) {
  const toast = useToast();
  const [keys, setKeys] = useState([]);
  const [show, setShow] = useState(null);
  const [teach, setTeach] = useState(null); // sample text, or '' for a blank form
  useEffect(() => onSnapshot(query(collection(db, 'smsKeys'), where('shopId', '==', shop.id)),
    (q) => setKeys(q.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.warn('smsKeys', e.code)), [shop.id]);
  if (!wallets.length || !CLOUD.url) return null;
  const linkOf = (k) => `${CLOUD.url}?k=${k.id}`;
  const make = async (w) => {
    try {
      await setDoc(doc(db, 'smsKeys', newKey()), { shopId: shop.id, shopName: shop.name || '', wallet: w.key, mode: w.mode || 'owner', atMs: Date.now() });
      logAct('setup', `عمل رابط رسايل البنك لـ ${w.label} · ${shop.name}`, { shopId: shop.id });
    } catch (e) { console.error(e); toast('مش قادرين نعمله، جرّب تاني', 'err'); }
  };
  const remove = async (k) => {
    if (!window.confirm('تلغي الرابط ده؟ الموبايل اللي بيبعت عليه هيبطل يوصل.')) return;
    await deleteDoc(doc(db, 'smsKeys', k.id)).catch(() => toast('مش قادرين نلغيه', 'err'));
  };
  const copy = (t) => { navigator.clipboard?.writeText(t).then(() => toast('اتنسخ'), () => toast('انسخه بإيدك', 'err')); };
  return (
    <section className="card tint-violet">
      <h2 className="h2">📩 رسايل البنك على موبايل صاحب المحل</h2>
      <span className="tiny muted" style={{ lineHeight: 1.8 }}>
        المحفظة اللي «بتروح لصاحب المحل»: رسالة البنك توصل للكاشير ويدوس «ده عميلي» ويتسجل التحويل من غير صورة.
        المحفظة اللي «تبع المحل» (زي فودافون كاش على موبايل المحل): كل رسالة داخل أو طالع بتتسجل لوحدها بمقابل الخدمة، والكاشير والمحاسب بيشوفوا الرصيد.
        محتاجين الموبايل اللي بتوصله الرسايل أندرويد عليه تطبيق MacroDroid (مجاني).
      </span>
      {wallets.map((w) => {
        const k = keys.find((x) => x.wallet === w.key);
        return (
          <div key={w.key} className="stack" style={{ background: '#fff', borderRadius: 20, padding: '12px 14px', gap: 8 }}>
            <div className="spread">
              <span className="stack" style={{ gap: 0 }}><strong>{w.label}</strong><span className="tiny muted">{w.mode === 'shop' ? 'تبع المحل · كل رسالة داخل/طالع بتتسجل لوحدها' : 'بتروح لصاحب المحل · الكاشير بيأكد التحويل'}</span></span>
              {k ? <span className="badge">{k.lastAtMs ? `آخر رسالة: ${new Date(k.lastAtMs).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'لسه موصلش رسايل'}</span>
                : <button type="button" className="btn sm" onClick={() => make(w)}>اعمل رابط</button>}
            </div>
            {k && <>
              {k.lastText && <span className="tiny" style={{ background: 'var(--chip)', borderRadius: 12, padding: '6px 10px', lineHeight: 1.7 }}>{k.lastOk ? '✓ ' : '✗ مفهمناش الرسالة دي: '}{k.lastText}</span>}
              {k.lastText && !k.lastOk && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTeach(k.lastText)}>🎓 علّم السيستم الرسالة دي</button>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn sm" onClick={() => copy(linkOf(k))}>انسخ الرابط</button>
                <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => setShow(show === k.id ? null : k.id)}>{show === k.id ? 'اقفل الخطوات' : 'خطوات تجهيز الموبايل'}</button>
                <button type="button" className="btn sm soft" style={{ height: 44, color: '#C62828' }} onClick={() => remove(k)}>إلغاء الرابط</button>
              </div>
              {show === k.id && (
                <ol className="small" style={{ lineHeight: 2, paddingInlineStart: 20, margin: 0 }}>
                  <li>على موبايل صاحب المحل نزّل <b>MacroDroid</b> من Play Store وافتحه.</li>
                  <li>دوس <b>Add Macro</b> وسمّيه «مدقق».</li>
                  <li>في <b>Triggers</b> اختار <b>Call/SMS</b> ← <b>SMS Received</b>، وفي الرسالة اختار <b>Contains</b> واكتب <code>استقبلت</code> (ولمحفظة «تبع المحل» زي فودافون كاش اكتب <code>مبلغ</code> علشان تمسك الداخل والطالع). لو صاحب المحل عنده حساب في البنك الأهلي كمان، دوس + في «المحفزات» واعمل محفّز تاني بنفس الطريقة بكلمة <code>ستلام</code>. (لو مش موجود: <b>Applications</b> ← <b>Notification</b> واختار تطبيق الرسايل.)</li>
                  <li>في <b>Actions</b> اختار <b>Connectivity</b> ← <b>HTTP Request</b>: النوع <b>POST</b>، والـ URL هو الرابط اللي فوق.</li>
                  <li>في الـ Body دوس على <b>...</b> واختار <b>SMS Message</b> (أو <b>Notification Text</b>).</li>
                  <li>احفظ ✓ ووافق على الصلاحيات اللي يطلبها.</li>
                  <li>جرّب بتحويل صغير؛ بعد ثواني هتلاقي «آخر رسالة» هنا اتغيرت، والكاشير يشوفه عنده.</li>
                </ol>
              )}
            </>}
          </div>
        );
      })}
      <SmsFormats onTeach={() => setTeach('')} />
      {teach !== null && <TeachSms sample={teach} onClose={() => setTeach(null)} />}
    </section>
  );
}

// Bank messages the system learned (for every shop): the admin pastes one sample and says where the amount, name… are.
function SmsFormats({ onTeach }) {
  const [list, setList] = useState([]);
  useEffect(() => onSnapshot(collection(db, 'smsFormats'), (q) => setList(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}), []);
  const remove = (f) => { if (window.confirm(`تمسح صيغة «${f.bank || f.key}»؟`)) deleteDoc(doc(db, 'smsFormats', f.id)).catch(() => {}); };
  return (
    <div className="stack" style={{ background: '#fff', borderRadius: 20, padding: '12px 14px', gap: 8 }}>
      <div className="spread">
        <strong>رسايل البنوك اللي السيستم بيفهمها</strong>
        <button type="button" className="btn sm" onClick={onTeach}>🎓 علّم السيستم رسالة جديدة</button>
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.7 }}>السيستم بيفهم لوحده رسايل بنك الإسكندرية والبنك الأهلي. لو عندك بنك أو محفظة تانية، الصق رسالة منها هنا وعرّفه فين المبلغ والاسم. الصيغة بتشتغل لكل المحلات.</span>
      {list.map((f) => (
        <div key={f.id} className="m-row" style={{ padding: '8px 12px' }}>
          <span className="lbl"><span className="small" style={{ fontWeight: 700 }}>{f.bank || 'بنك'}</span><span className="tiny muted">بتبدأ بـ «{f.key}»</span></span>
          <button type="button" className="icon-btn" aria-label="امسح الصيغة" onClick={() => remove(f)}><Icon d="trash" size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function TeachSms({ sample: first, onClose }) {
  const toast = useToast();
  const [sample, setSample] = useState(first || '');
  const guess = parseSms(first || '') || {};
  const [v, setV] = useState({ bank: '', key: firstWords(first || ''), amount: guess.amount ? String(first.match(/[\d,]+(?:\.\d+)?/g)?.find((x) => Number(x.replace(/,/g, '')) === guess.amount) || guess.amount) : '', name: guess.fromName || '', phone: guess.fromPhone || '', ref: guess.ref || '', balance: guess.balance ? String(first.match(/[\d,]+(?:\.\d+)?/g)?.find((x) => Number(x.replace(/,/g, '')) === guess.balance) || guess.balance) : '', dir: guess.dir || 'in' });
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const onSample = (x) => { setSample(x); if (!v.key || v.key === firstWords(sample)) set('key', firstWords(x)); };
  const { format, missing } = buildFormat(sample, v);
  const got = sample && v.key && v.amount ? applyFormat(format, sample) : null;
  const LBL = { amount: 'المبلغ', name: 'الاسم', phone: 'الموبايل', ref: 'رقم المعاملة', balance: 'الرصيد' };
  const ok = got && !missing.length && v.bank.trim();
  const save = async () => {
    try {
      await setDoc(doc(collection(db, 'smsFormats')), { bank: v.bank.trim(), key: format.key, dir: format.dir, amount: format.amount, name: format.name, phone: format.phone, ref: format.ref, balance: format.balance, sample: sample.slice(0, 400), on: true, atMs: Date.now() });
      logAct('setup', `علّم السيستم رسالة ${v.bank.trim()}`);
      toast('اتحفظ ✓ الرسايل الجاية بالشكل ده هتوصل للكاشير');
      onClose();
    } catch (e) { console.error(e); toast('مش قادرين نحفظ، جرّب تاني', 'err'); }
  };
  return (
    <Modal title="علّم السيستم رسالة بنك" icon="phone" color="#A07CFF" onClose={onClose} width={560}>
      <label className="field">١. الصق رسالة البنك هنا (رسالة تحويل وارد)
        <textarea className="input" rows={4} style={{ height: 'auto', paddingBlock: 10, lineHeight: 1.7 }} value={sample} onChange={(e) => onSample(e.target.value)} placeholder="مثلًا: تم إستلام عملية تحويل أموال بمبلغ 315.00 جنيه من …" />
      </label>
      <span className="small muted" style={{ lineHeight: 1.7 }}>٢. انسخ من الرسالة نفسها كل معلومة واكتبها في خانتها، بالظبط زي ما هي مكتوبة في الرسالة:</span>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: '1 1 140px' }}>المبلغ<input className="input" dir="ltr" value={v.amount} onChange={(e) => set('amount', e.target.value)} placeholder="315.00" /></label>
        <label className="field" style={{ flex: '2 1 220px' }}>اسم اللي حوّل<input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: '1 1 160px' }}>رقم الموبايل (لو موجود)<input className="input" dir="ltr" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <label className="field" style={{ flex: '1 1 160px' }}>رقم المعاملة (لو موجود)<input className="input" dir="ltr" value={v.ref} onChange={(e) => set('ref', e.target.value)} /></label>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 160px' }}>الرصيد بعد العملية (لو موجود)<input className="input" dir="ltr" value={v.balance} onChange={(e) => set('balance', e.target.value)} /></label>
        <div className="stack" style={{ flex: '1 1 200px', gap: 6 }}>
          <span className="small">الرسالة دي فلوس</span>
          <div className="chips">
            <button type="button" className={'chip sm' + (v.dir !== 'out' ? ' on' : '')} onClick={() => set('dir', 'in')}>داخلة (استلمنا)</button>
            <button type="button" className={'chip sm' + (v.dir === 'out' ? ' on' : '')} onClick={() => set('dir', 'out')}>طالعة (حوّلنا)</button>
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: '1 1 160px' }}>اسم البنك<input className="input" value={v.bank} onChange={(e) => set('bank', e.target.value)} placeholder="مثلًا بنك مصر" /></label>
        <label className="field" style={{ flex: '2 1 220px' }}>الرسالة بتبدأ بـ (كلام ثابت في كل رسالة)<input className="input" value={v.key} onChange={(e) => set('key', e.target.value)} /></label>
      </div>
      {missing.length > 0 && <span className="badge bad">مش لاقيين في الرسالة: {missing.map((k) => LBL[k]).join('، ')} · انسخها من الرسالة بالظبط</span>}
      {sample && v.amount && !missing.length && (
        <div className="stack" style={{ background: got ? '#EAFBC2' : '#FFE4E4', borderRadius: 16, padding: '10px 14px', gap: 4 }}>
          <strong className="small">{got ? `✓ السيستم هيقرا الرسالة كده (${got.dir === 'out' ? 'فلوس طالعة' : 'فلوس داخلة'}):` : '✗ السيستم مش قادر يقرا الرسالة بالشكل ده'}</strong>
          {got && <span className="small" style={{ lineHeight: 1.8 }}>المبلغ <b>{fmt(got.amount)} ج</b> · الاسم <b>{got.fromName || '—'}</b>{got.fromPhone ? <> · الموبايل <b>{got.fromPhone}</b></> : ''}{got.ref ? <> · رقم المعاملة <b>{got.ref}</b></> : ''}{got.balance !== null && got.balance !== undefined ? <> · الرصيد <b>{fmt(got.balance)}</b></> : ''}</span>}
          {!got && <span className="tiny">اتأكد إن «الرسالة بتبدأ بـ» كلام موجود فعلًا في أول الرسالة.</span>}
        </div>
      )}
      {got && <span className="tiny muted" style={{ lineHeight: 1.7 }}>📱 متنساش: في MacroDroid على موبايل صاحب المحل، ضيف محفّز رسالة SMS تاني بكلمة من «{format.key}».</span>}
      <button type="button" className="btn full" disabled={!ok} onClick={save}>{!v.bank.trim() && got ? 'اكتب اسم البنك' : 'احفظ الصيغة'}</button>
    </Modal>
  );
}

// Pick a shop and the parts of its settings to copy.
const COPY_PARTS = [
  { k: 'machines', label: 'المكن وحساباتها ونسبها ومقابل الخدمة', on: true },
  { k: 'wallets', label: 'المحافظ وطريقتها ومقابل الخدمة بتاعها', on: true },
  { k: 'expenses', label: 'أنواع المصروفات ومصروفات المحل وأيام السلف', on: true },
  { k: 'income', label: 'أسباب الإيراد', on: true },
  { k: 'shifts', label: 'عدد الورديات ومواعيدها', on: true },
  { k: 'suppliers', label: 'الموردين', on: false },
  { k: 'staff', label: 'أسماء الموظفين والشركا', on: false },
  { k: 'registers', label: 'الأدراج والخزن', on: false },
  { k: 'pos', label: 'لينك برنامج البيع', on: false },
];
function CopySettings({ shops, target, onCopy, onClose }) {
  const [q, setQ] = useState('');
  const [src, setSrc] = useState(null);
  const [parts, setParts] = useState(() => Object.fromEntries(COPY_PARTS.map((p) => [p.k, p.on])));
  const list = shops.filter((s) => matches(s.name, q));
  const count = (s, k) => ({
    machines: (s.machineList || []).length || [...new Set((s.machines || []).map((m) => m.machine))].length,
    wallets: (s.wallets || []).length, expenses: (s.customExpenseTypes || []).length + (s.shopExpenses || []).length,
    income: (s.incomeReasons || []).length, suppliers: (s.suppliers || []).length, staff: (s.staff || []).length,
    registers: (s.registers || []).length + (s.vaults || []).length,
  }[k]);
  return (
    <Modal title={`انسخ إعدادات لـ ${target.name}`} icon="swap" color="var(--blue)" onClose={onClose} width={560}>
      {!src ? (
        <>
          <span className="small muted">من أنهي محل؟</span>
          <div className="sp-search"><Icon d="search" size={18} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على محل…" /></div>
          <div className="stack" style={{ gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {list.map((s) => (
              <button key={s.id} type="button" className="m-row" style={{ padding: '10px 14px', border: 0, cursor: 'pointer', textAlign: 'start', width: '100%' }} onClick={() => setSrc(s)}>
                <span className="lbl"><span style={{ fontWeight: 700 }}>{s.name}</span><span className="tiny muted">{count(s, 'machines') || 0} مكنة · {(s.wallets || []).length} محفظة · {(s.customExpenseTypes || []).length + (s.shopExpenses || []).length} نوع مصروف</span></span>
              </button>
            ))}
            {!list.length && <span className="tiny muted">مفيش محل بالاسم ده</span>}
          </div>
        </>
      ) : (
        <>
          <div className="spread"><span>من: <b>{src.name}</b></span><button type="button" className="link" onClick={() => setSrc(null)}>غيّر المحل</button></div>
          <span className="small muted">تنسخ إيه؟ (اللي هتعلّم عليه هيحل محل اللي في {target.name})</span>
          <div className="stack" style={{ gap: 4 }}>
            {COPY_PARTS.map((p) => (
              <label key={p.k} className="m-row" style={{ padding: '8px 12px', cursor: 'pointer', gap: 10 }}>
                <input type="checkbox" checked={!!parts[p.k]} onChange={(e) => setParts({ ...parts, [p.k]: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />
                <span className="lbl"><span className="small" style={{ fontWeight: 600 }}>{p.label}</span>{count(src, p.k) !== undefined && <span className="tiny muted">{count(src, p.k)} عنصر في {src.name}</span>}</span>
              </label>
            ))}
          </div>
          <span className="tiny muted" style={{ lineHeight: 1.7 }}>الأرصدة والكاشيرية والمسؤولين ولوجو المحل مش بيتنسخوا. بعد النسخ راجع الإعدادات ودوس «حفظ»، ولو غيّرت رأيك اقفل الصفحة من غير حفظ.</span>
          <button type="button" className="btn full" disabled={!Object.values(parts).some(Boolean)} onClick={() => onCopy(src, parts)}>انسخ</button>
        </>
      )}
    </Modal>
  );
}
