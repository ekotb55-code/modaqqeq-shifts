import { useState } from 'react';
import { Icon, Modal } from '../ui.jsx';
import { fmt, machineListOf, num, tierFee } from '../lib';
import { feeTiersOf } from '../walletSms.jsx';

// «احسب للعميل»: the cashier types the invoice and sees what to charge, from the shop's own settings:
//  · machine with a service fee (ممكن / ماجيك / فوري الحساب الرئيسي) → «خد من العميل كاش» invoice + svc%;
//  · machine whose % the customer pays on the card (فوري كاش أوت) → «اضرب على المكنة» invoice + rate%;
//  · Vodafone Cash → invoice + the fee from the shop's table.

const r2 = (n) => Math.round(n * 100) / 100;

export function calcOptions(shop) {
  const out = [];
  machineListOf(shop).filter((m) => m.active !== false && (m.name || '').trim()).forEach((m) => {
    const name = m.name.trim();
    const svc = num(m.svcPct);
    const card = m.rateOn === 'customer' ? num(m.ratePct) : 0;
    const both = svc > 0 && card > 0;
    if (svc > 0) out.push({ id: `svc:${m.id || name}`, kind: 'svc', name: both ? `${name} فواتير` : name, sub: `مقابل خدمة ${fmt(svc)}%`, pct: svc, machine: name });
    if (card > 0) {
      const acc = (m.accounts || []).find((a) => /كاش|كارت|فيزا/.test(a));
      out.push({ id: `card:${m.id || name}`, kind: 'card', name: both || acc ? `${name} ${acc || 'كارت'}` : name, sub: `${fmt(card)}% على العميل`, pct: card, machine: name });
    }
  });
  if ((shop?.wallets || ['insta', 'vf']).includes('vf')) out.push({ id: 'vf', kind: 'vf', name: 'فودافون كاش', sub: 'جدول الخدمة', tiers: feeTiersOf(shop, 'vf') });
  return out;
}

const shortOf = (o) => (o.kind === 'vf' ? 'فودافون' : `${o.name} ${fmt(o.pct)}%`);
const LOOK = { svc: 'var(--lime)', card: 'var(--sky)', vf: 'var(--pink)' };

function result(o, x, vfDir) {
  if (!o || !(x > 0)) return null;
  if (o.kind === 'vf') {
    const fee = tierFee(x, o.tiers);
    return vfDir === 'in'
      ? { t: 'خلّي العميل يحوّل', v: r2(x + fee), note: `هيشتري بـ ${fmt(x)} + ${fmt(fee)} خدمة فودافون` }
      : { t: 'خد من العميل كاش', v: r2(x + fee), note: `${fmt(x)} هتحوّلهم + ${fmt(fee)} خدمة · الخدمة بتفضل في الدرج` };
  }
  const add = r2((x * o.pct) / 100);
  if (o.kind === 'card') return { t: 'اضرب على المكنة', v: r2(x + add), note: `${fmt(x)} الفاتورة + ${fmt(add)} نسبة ${o.machine} (العميل بيدفعها) · الدرج ناقص ${fmt(x)} بس` };
  return { t: 'خد من العميل كاش', v: r2(x + add), note: `${fmt(x)} الفاتورة + ${fmt(add)} مقابل خدمة ${o.machine}` };
}

const memKey = (shop) => 'mdq-calc-' + (shop?.id || '');
const readMem = (shop) => { try { return localStorage.getItem(memKey(shop)); } catch { return null; } };
const writeMem = (shop, v) => { try { localStorage.setItem(memKey(shop), v); } catch { /* private mode */ } };

export function CalcModal({ shop, options, onClose }) {
  const [sel, setSel] = useState(() => { const m = readMem(shop); return options.some((o) => o.id === m) ? m : options[0]?.id; });
  const [amt, setAmt] = useState('');
  const [vfDir, setVfDir] = useState('out');
  const o = options.find((x) => x.id === sel) || options[0];
  const x = num(amt);
  const res = result(o, x, vfDir);
  const pick = (id) => { setSel(id); writeMem(shop, id); };
  return (
    <Modal title="احسب للعميل" icon="calc" color="var(--sky)" onClose={onClose} width={560}>
      <span className="small muted">اختار المكنة واكتب الفاتورة · النِّسب جاية من إعداد المحل</span>
      <div className="chips">
        {options.map((c) => (
          <button key={c.id} type="button" className={'chip' + (c.id === o.id ? ' on' : '')} style={{ height: 'auto', minHeight: 52, padding: '6px 18px', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }} onClick={() => pick(c.id)}>
            <span>{c.name}</span><span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>{c.sub}</span>
          </button>
        ))}
      </div>
      {o.kind === 'vf' && (
        <div className="chips">
          <button type="button" className={'chip sm' + (vfDir === 'out' ? ' on' : '')} onClick={() => setVfDir('out')}>هتحوّل للعميل</button>
          <button type="button" className={'chip sm' + (vfDir === 'in' ? ' on' : '')} onClick={() => setVfDir('in')}>العميل هيحوّلك</button>
        </div>
      )}
      <label className="field">{o.kind === 'vf' ? (vfDir === 'out' ? 'عاوز يستلم كام' : 'هيشتري بكام') : 'الفاتورة على السيستم'}
        <span style={{ position: 'relative', display: 'block' }}>
          <input className="input" autoFocus inputMode="decimal" dir="ltr" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0"
            style={{ height: 66, fontSize: 30, fontWeight: 800, paddingInlineStart: 64, textAlign: 'right' }} />
          <span className="muted" style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)' }}>جنيه</span>
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {[100, 200, 500, 1000].map((n) => <button key={n} type="button" className="chip" style={{ flex: 1, justifyContent: 'center', height: 42 }} onClick={() => setAmt(String(n))}>{n}</button>)}
      </div>
      <div aria-live="polite" style={{ borderRadius: 24, padding: '18px 22px', background: LOOK[o.kind], color: 'var(--ink)', minHeight: 120 }}>
        {res ? (
          <>
            <div style={{ fontWeight: 700, opacity: 0.8 }}>{res.t}</div>
            <div style={{ fontSize: 50, fontWeight: 900, lineHeight: 1.15 }}>{fmt(res.v)} <span style={{ fontSize: 22 }}>ج</span></div>
            <div className="small" style={{ opacity: 0.8 }}>{res.note}</div>
          </>
        ) : <div style={{ fontWeight: 700, opacity: 0.7, paddingTop: 30, textAlign: 'center' }}>اكتب المبلغ والرقم هيظهر هنا</div>}
      </div>
    </Modal>
  );
}

// Counter tile on the computer + a floating button on phones (CSS picks which one shows).
export function CalcEntry({ shop }) {
  const [open, setOpen] = useState(false);
  const options = calcOptions(shop);
  if (!shop?.calcOn || !options.length) return null; // بتظهر بس في المحلات اللي المحاسب فتحها فيها
  return (
    <>
      <button type="button" className="counter c-sky calc-tile" onClick={() => setOpen(true)} style={{ border: 0, textAlign: 'right', cursor: 'pointer', color: 'var(--ink)' }}>
        <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: 'rgba(255,255,255,.55)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon d="calc" size={18} /></span>احسب للعميل
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {options.slice(0, 4).map((c) => <span key={c.id} style={{ background: 'rgba(255,255,255,.6)', borderRadius: 99, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>{shortOf(c)}</span>)}
        </span>
      </button>
      <button type="button" className="calc-fab" aria-label="احسب للعميل" onClick={() => setOpen(true)}><Icon d="calc" size={28} /></button>
      {open && <CalcModal shop={shop} options={options} onClose={() => setOpen(false)} />}
    </>
  );
}
