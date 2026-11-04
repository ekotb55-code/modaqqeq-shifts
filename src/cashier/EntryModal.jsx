import { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import { ENTRY_TYPES, OWNER, SRC_LABEL, WALLETS, WEEKDAYS, fmt, num, pickImage, safeLabel, shopSafes } from '../lib';

const META = {
  expense: { title: 'مصروف جديد', icon: 'up' },
  income: { title: 'إيراد جديد', icon: 'down' },
  transfer: { title: 'تحويل محفظة', icon: 'phone' },
  topup: { title: 'شحن رصيد مكنة', icon: 'bolt' },
  move: { title: 'نقل بين الدرجين', icon: 'swap' },
  liquidate: { title: 'تسييل وتحويل', icon: 'swap' },
  withdraw: { title: 'سحب لصاحب المحل', icon: 'person' },
};

export function SafePick({ safes, value, onPick, balances, exclude }) {
  return (
    <div className="chips">
      {safes.filter((x) => x.key !== exclude).map((x) => {
        const b = balances?.[x.key];
        return (
          <button key={x.key} type="button" className={'chip' + (value === x.key ? ' on' : '')} onClick={() => onPick(x.key)} style={{ height: 'auto', minHeight: 46, padding: '6px 16px', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.35 }}>
            <span>{x.label}</span>
            {b !== undefined && b !== null && <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>رصيد {fmt(b)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={'chip' + (on ? ' on' : '')} onClick={onClick}>{children}</button>;
}

export default function EntryModal({ type, shop, shift, profile, onClose, balances }) {
  const toast = useToast();
  const kinds = useMemo(() => { const staff = shop.staff || []; return [
    { id: 'supplier', label: 'مورد', icon: 'truck', q: 'مين المورد؟', subs: shop.suppliers || [], allowNew: 'مورد جديد' },
    { id: 'advance', label: 'سلفة موظف', icon: 'person', q: 'لمين السلفة؟', subs: staff, allowNew: 'اسم تاني' },
    { id: 'shop', label: 'مصروف محل', icon: 'shop', q: 'المصروف ده على إيه؟', subs: shop.shopExpenses || [], allowNew: 'نوع جديد' },
    { id: 'wage', label: 'يومية / مرتب', icon: 'cash', q: 'لمين؟', subs: staff, allowNew: 'اسم تاني' },
    { id: 'delivery', label: 'قبض دليفري', icon: 'truck', q: 'مين الدليفري؟', subs: staff, allowNew: 'اسم تاني' },
    { id: 'refund', label: 'مرتجع لعميل', icon: 'undo', q: '', subs: [] },
    { id: 'other', label: 'حاجة تانية', icon: 'dots', q: '', subs: [] },
  ].filter((k) => !(shop.hiddenExpenseTypes || []).includes(k.id)).concat((shop.customExpenseTypes || []).filter((c) => c.label).map((c) => ({
    id: 'c:' + c.id, label: c.label, icon: 'cash', q: c.q || '', subs: c.subs || [], allowNew: c.q ? 'تاني' : null, custom: true, needNote: !!c.needNote, needPhoto: !!c.needPhoto,
  }))); }, [shop]);

  const [src, setSrc] = useState('');
  const [kind, setKind] = useState('');
  const [sub, setSub] = useState('');
  const [custom, setCustom] = useState('');
  const [invoice, setInvoice] = useState('invoice');
  const [reason, setReason] = useState('');
  const enabledWallets = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key));
  const [wallet, setWallet] = useState(enabledWallets[0]?.key || 'insta');
  const [machine, setMachine] = useState('');
  const [moveTo, setMoveTo] = useState('side');
  const [liqTo, setLiqTo] = useState('');
  const [feeTxt, setFeeTxt] = useState(null);
  const allSafes = shopSafes(shop);
  const cashSafes = allSafes.filter((x) => x.kind === 'cash');
  const machineSafes = allSafes.filter((x) => x.kind === 'machine');
  const liqTargets = [...allSafes, { key: OWNER, label: 'صاحب المحل / المحفظة' }];
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const srcMachine = type === 'liquidate' ? machineSafes.find((x) => x.key === src)?.m : null;
  const liqPct = srcMachine && srcMachine.settle === 'liquidate' ? num(srcMachine.liqFeePct) : 0;
  const autoFee = Math.round(num(amount) * liqPct) / 100;
  const fee = type !== 'liquidate' || !srcMachine ? 0 : feeTxt === null ? autoFee : num(feeTxt);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  const kd = kinds.find((k) => k.id === kind) || { id: '', label: '', q: '', subs: [] };
  const reasons = shop.incomeReasons || [];
  const today = new Date().getDay();
  const advanceDays = shop.advanceDays || [];
  const advanceBlocked = type === 'expense' && kind === 'advance' && advanceDays.length > 0 && !advanceDays.includes(today);
  const needsPhoto = type === 'transfer' || (type === 'expense' && ((kind === 'supplier' && invoice === 'invoice') || kd.needPhoto));

  const subValue = sub === '__new' ? custom.trim() : sub;
  const reasonValue = reason === '__new' ? custom.trim() : reason;

  const takePhoto = async () => {
    const data = await pickImage(1100, 0.65);
    if (data) setPhoto(data);
  };

  const validate = () => {
    if (['expense', 'income', 'topup', 'withdraw', 'liquidate'].includes(type) && !src) return type === 'income' ? 'اختار الفلوس داخلة فين' : 'اختار الفلوس طالعة منين';
    if (type === 'expense' && !kind) return 'اختار نوع المصروف';
    if (num(amount) <= 0) return 'اكتب المبلغ';
    if (advanceBlocked) return 'النهارده مش يوم سلف';
    if (type === 'expense' && kd.subs !== undefined && kd.q && !subValue) return kd.q;
    if (type === 'expense' && ['refund', 'other'].includes(kind) && !note.trim()) return kind === 'refund' ? 'اكتب رقم فاتورة البيع' : 'اكتب المصروف ده إيه';
    if (type === 'expense' && kd.needNote && !note.trim()) return 'اكتب ملاحظة';
    if (type === 'income' && !reasonValue) return 'اختار سبب الإيراد';
    if (type === 'topup' && !machine) return 'اختار المكنة';
    if (type === 'liquidate' && !liqTo) return 'اختار الفلوس رايحة فين';
    if (type === 'liquidate' && liqTo === src) return 'اختار خزنة تانية';
    if (type === 'liquidate' && fee >= num(amount) && fee > 0) return 'مصاريف التسييل أكبر من المبلغ';
    if (needsPhoto && !photo) return type === 'transfer' ? 'لازم ترفع صورة التحويل' : kind === 'supplier' ? 'صوّر الفاتورة' : 'صوّر الإيصال';
    return null;
  };

  const save = async (print) => {
    const err = validate();
    if (err) { toast(err, 'err'); return; }
    setBusy(true);
    const now = new Date();
    const entry = {
      type, amount: num(amount), by: profile.id, byName: profile.name,
      createdAt: serverTimestamp(), createdAtLocal: now.toISOString(), posted: false,
    };
    if (type === 'expense') Object.assign(entry, { src, kind, kindLabel: kd.label, sub: subValue || '', note: note.trim(), invoice: kind === 'supplier' ? invoice : null, newItem: sub === '__new' });
    if (type === 'income') Object.assign(entry, { src, reason: reasonValue, note: note.trim(), newItem: reason === '__new' });
    if (type === 'transfer') Object.assign(entry, { wallet, src: wallet });
    if (type === 'topup') { const mm = machineSafes.find((x) => x.key === machine); Object.assign(entry, { src, machineKey: machine, machine: mm?.m?.machine || '', account: mm?.m?.account || '' }); }
    if (type === 'liquidate') Object.assign(entry, { src, to: liqTo, note: note.trim(), fromLabel: safeLabel(src, shop), toLabel: safeLabel(liqTo, shop), fee: fee > 0 ? fee : 0, net: Math.round((num(amount) - fee) * 100) / 100 });
    if (type === 'move') Object.assign(entry, { src: moveTo === 'side' ? 'drawer' : 'side', to: moveTo });
    if (type === 'withdraw') Object.assign(entry, { src, note: note.trim() });
    try {
      const b = writeBatch(db);
      const eref = doc(collection(db, 'shifts', shift.id, 'entries'));
      if (photo) {
        const pref = doc(collection(db, 'shifts', shift.id, 'photos'));
        entry.photoId = pref.id;
        b.set(pref, { kind: type === 'transfer' ? 'transfer' : 'invoice', entryId: eref.id, label: type === 'transfer' ? SRC_LABEL[wallet] : subValue, amount: num(amount), data: photo, check: 'pending', createdAt: serverTimestamp() });
      }
      b.set(eref, entry);
      const p = b.commit();
      if (navigator.onLine) await p; else p.catch(() => {});
      if (print) printReceipt({ shop, profile, entry, title: META[type].title });
      toast(navigator.onLine ? (print ? 'اتسجل والإيصال بيتطبع' : 'اتسجل') : 'اتحفظ وهيترفع لما النت يرجع');
      onClose();
    } catch (e) {
      console.error(e);
      toast('حصلت مشكلة، جرّب تاني', 'err');
      setBusy(false);
    }
  };

  return (
    <Modal title={META[type].title} icon={META[type].icon} color={ENTRY_TYPES[type].color} onClose={onClose}>
      {['income', 'topup', 'withdraw'].includes(type) && (
        <div className="stack">
          <span className="small muted">{type === 'income' ? 'الفلوس داخلة فين؟' : 'الفلوس طالعة منين؟'}</span>
          <SafePick safes={cashSafes} value={src} onPick={setSrc} balances={balances} />
        </div>
      )}
      {type === 'expense' && (
        <div className="stack">
          <span className="small muted">الفلوس طالعة منين؟</span>
          <SafePick safes={cashSafes} value={src} onPick={setSrc} balances={balances} />
        </div>
      )}
      {type === 'liquidate' && (
        <div className="stack">
          <span className="small muted">الفلوس طالعة من أنهي خزنة؟</span>
          <SafePick safes={allSafes} value={src} onPick={(k) => { setSrc(k); if (k === liqTo) setLiqTo(''); }} balances={balances} />
        </div>
      )}
      {type === 'liquidate' && (
        <div className="stack" style={{ background: '#F7F6FB', borderRadius: 22, padding: '12px 14px' }}>
          <span className="small muted">رايحة فين؟</span>
          <SafePick safes={liqTargets} value={liqTo} onPick={setLiqTo} balances={balances} exclude={src} />
          <input className="input white" placeholder="ملاحظة (اختياري): مثلًا صاحب المحل طلب تسييل انستاباي" value={note} onChange={(e) => setNote(e.target.value)} />
          {srcMachine && (
            <label className="field">مصاريف التسييل{liqPct ? ` (${liqPct}%)` : ''}
              <input className="input white" inputMode="decimal" value={feeTxt === null ? (autoFee ? String(autoFee) : '') : feeTxt} onChange={(e) => setFeeTxt(e.target.value)} placeholder="0 لو مفيش مصاريف" />
              {fee > 0 && num(amount) > 0 && <span className="tiny" style={{ fontWeight: 600 }}>هيطلع {fmt(amount)} من {safeLabel(src, shop)} · يوصل {fmt(num(amount) - fee)} · مصاريف {fmt(fee)}</span>}
            </label>
          )}
          {balances?.[src] !== undefined && balances?.[src] !== null && num(amount) > num(balances[src]) && <span className="badge warn">المبلغ أكبر من رصيد {safeLabel(src, shop)} ({fmt(balances[src])})</span>}
        </div>
      )}

      {type === 'expense' && (
        <>
          <div className="stack">
            <span className="small muted">نوع المصروف</span>
            <div className="grid3">
              {kinds.map((k) => (
                <button key={k.id} type="button" className={'tile-opt' + (kind === k.id ? ' on' : '')} onClick={() => { setKind(k.id); setSub(''); setCustom(''); setNote(''); setPhoto(null); }}>
                  <Icon d={k.icon} />{k.label}
                </button>
              ))}
            </div>
          </div>
          {kd.q && (
            <div className="stack" style={{ background: '#F7F6FB', borderRadius: 22, padding: '12px 14px' }}>
              <span className="spread"><span className="small muted">{kd.q}</span>
                {kind === 'advance' && advanceDays.length > 0 && <span className={'badge ' + (advanceBlocked ? 'bad' : 'ok')}>{advanceBlocked ? `السلف أيام: ${advanceDays.map((d) => WEEKDAYS[d]).join('، ')}` : 'النهارده يوم سلف'}</span>}
              </span>
              <div className="chips">
                {kd.subs.map((x) => <button key={x} type="button" className={'chip sm' + (sub === x ? ' on' : '')} onClick={() => setSub(x)}>{x}</button>)}
                {kd.allowNew && <button type="button" className={'chip sm' + (sub === '__new' ? ' on' : '')} onClick={() => setSub('__new')}>+ {kd.allowNew}</button>}
              </div>
              {sub === '__new' && <input className="input white" placeholder="اكتب الاسم" value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />}
            </div>
          )}
          {kind === 'supplier' && (
            <div className="chips">
              <button type="button" className={'chip' + (invoice === 'invoice' ? ' on' : '')} style={{ flex: '1 1 200px', height: 58 }} onClick={() => setInvoice('invoice')}>فاتورة · هتصورها وتتبعت للدعم</button>
              <button type="button" className={'chip' + (invoice === 'supply' ? ' on' : '')} style={{ flex: '1 1 200px', height: 58 }} onClick={() => { setInvoice('supply'); setPhoto(null); }}>توريد من غير فاتورة</button>
            </div>
          )}
          {kd.custom && (
            <label className="field">{kd.needNote ? 'ملاحظة' : 'ملاحظة (اختياري)'}
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="اكتب تفاصيل لو فيه" />
            </label>
          )}
          {['refund', 'other'].includes(kind) && (
            <label className="field">{kind === 'refund' ? 'رقم فاتورة البيع' : 'اكتب المصروف ده إيه'}
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'refund' ? 'مثلًا 10452' : 'مثلًا تصليح التلاجة'} />
            </label>
          )}
        </>
      )}

      {type === 'income' && (
        <div className="stack" style={{ background: '#F7F6FB', borderRadius: 22, padding: '12px 14px' }}>
          <span className="small muted">سبب الإيراد</span>
          <div className="chips">
            {reasons.map((x) => <button key={x} type="button" className={'chip sm' + (reason === x ? ' on' : '')} onClick={() => setReason(x)}>{x}</button>)}
            <button type="button" className={'chip sm' + (reason === '__new' ? ' on' : '')} onClick={() => setReason('__new')}>+ سبب تاني</button>
          </div>
          {reason === '__new' && <input className="input white" placeholder="اكتب السبب" value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />}
        </div>
      )}

      {type === 'transfer' && (
        <div className="stack">
          <span className="small muted">العميل حوّل على</span>
          <div className="chips">
            {enabledWallets.map((w) => <Chip key={w.key} on={wallet === w.key} onClick={() => setWallet(w.key)}>{w.label}</Chip>)}
          </div>
        </div>
      )}

      {type === 'topup' && (
        <div className="stack">
          <span className="small muted">شحنت أنهي مكنة؟ (المبلغ اللي دفعته للمندوب)</span>
          <SafePick safes={machineSafes} value={machine} onPick={setMachine} balances={balances} />
          {machineSafes.length === 0 && <span className="tiny muted">مفيش مكن مفعّلة للمحل</span>}
        </div>
      )}

      {type === 'move' && (
        <div className="stack">
          <div className="chips">
            <Chip on={moveTo === 'side'} onClick={() => setMoveTo('side')}>من درج الكاشير للجانبي</Chip>
            <Chip on={moveTo === 'drawer'} onClick={() => setMoveTo('drawer')}>من الجانبي لدرج الكاشير</Chip>
          </div>
          <span className="small muted">ده مش بيأثر على إجمالي الفلوس، بس بيظبط حساب كل درج.</span>
        </div>
      )}
      {type === 'withdraw' && (
        <label className="field">ملاحظة (اختياري)<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا أ. سامح خد إيراد الضهر" /></label>
      )}

      {needsPhoto && (
        <div className="stack">
          {photo ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <img src={photo} alt="الصورة" style={{ width: 84, height: 110, objectFit: 'cover', borderRadius: 14 }} />
              <div className="stack">
                <span className="badge ok">✓ الصورة اترفعت</span>
                <span className="tiny muted">{type === 'transfer' ? 'المحاسب هيراجعها على المبلغ' : 'هتوصل للدعم مع المصروف'}</span>
                <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={takePhoto}>غيّر الصورة</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={takePhoto} style={{ height: 80, borderRadius: 24, border: '2px dashed var(--violet)', background: '#F7F3FF', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Icon d="cam" size={24} stroke={2} />{type === 'transfer' ? 'ارفع صورة التحويل (إجباري)' : kind === 'supplier' ? 'صوّر الفاتورة' : 'صوّر الإيصال (إجباري)'}
            </button>
          )}
        </div>
      )}

      <label className="amount-box">
        <span className="small muted">المبلغ</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <input inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={type !== 'expense'} />
          <span className="muted" style={{ fontSize: 17 }}>جنيه</span>
        </span>
      </label>

      {type === 'expense' ? (
        <>
          <button type="button" className="btn full" onClick={() => save(true)} disabled={busy}><Icon d="print" />حفظ وطباعة إيصال</button>
          <button type="button" className="link" onClick={() => save(false)} disabled={busy}>حفظ من غير طباعة</button>
        </>
      ) : (
        <button type="button" className="btn full" onClick={() => save(false)} disabled={busy}>{busy ? 'لحظة…' : 'حفظ'}</button>
      )}
    </Modal>
  );
}

function printReceipt({ shop, profile, entry, title }) {
  let el = document.getElementById('receipt');
  if (!el) { el = document.createElement('div'); el.id = 'receipt'; el.className = 'receipt'; document.body.appendChild(el); }
  const now = new Date();
  const line = [entry.kindLabel, entry.sub, entry.note].filter(Boolean).join(' · ');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `
    <div style="text-align:center;font-family:Alexandria,sans-serif">
      <img src="./modaqqeq-logo.png" alt="" />
      <div style="font-weight:700;margin:4px 0">${esc(shop.name || '')}</div>
      <div>${esc(title)}</div>
      <hr />
      <div style="font-size:16pt;font-weight:800">${fmt(entry.amount)} ج</div>
      <div>${esc(line)}</div>
      <div>من: ${esc(SRC_LABEL[entry.src] || safeLabel(entry.src, shop))}</div>
      <hr />
      <div>الكاشير: ${esc(profile.name)}</div>
      <div>${now.toLocaleString('ar-EG')}</div>
      <div style="margin-top:10mm">توقيع المستلم: ..................</div>
    </div>`;
  document.body.classList.add('print-receipt');
  const done = () => { document.body.classList.remove('print-receipt'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}
