import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, MachineMark, PhotoSlot, machineLook } from '../ui.jsx';
import { HelpButton } from '../Tour.jsx';
import { UpdateButton } from '../update.jsx';
import { BILL_BG, FACES, fmt, machineGroupsOf, num } from '../lib';

export function Topbar({ shopPub, profile, steps, onLogout, posUrl, onPin, onPhoto, regLabel, onTheme, bell }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <img className="logo-mdq" src="./modaqqeq-logo.png" alt="مدقق" />
        {steps && (
          <ol className="steps" aria-label="خطوات الوردية" data-tour="steps">
            {steps.map((s) => (
              <li key={s.title} style={{ display: 'flex' }}>
                <button type="button" className={s.state} onClick={s.go} disabled={!s.go && s.state !== 'on'} style={{ opacity: 1, cursor: s.go ? 'pointer' : 'default' }} aria-current={s.state === 'on' ? 'step' : undefined}>
                  <span className="n">{s.state === 'done' ? '✓' : s.n}</span>{s.title}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          {posUrl && (
            <a className="pos-link" href={posUrl} target="_blank" rel="noopener noreferrer">
              <span className="ic"><Icon d="monitor" size={18} /></span>برنامج البيع<Icon d="up" size={14} />
            </a>
          )}
          {shopPub?.logo ? <img className="logo-shop" src={shopPub.logo} alt={shopPub.name} /> : <strong>{shopPub?.name}</strong>}
          <span className="vsep" aria-hidden="true" />
          <span className="who" data-tour="me">
            {onPhoto ? (
              <button type="button" onClick={onPhoto} aria-label="غيّر صورتك" title="غيّر صورتك" style={{ border: 0, background: 'transparent', padding: 0, position: 'relative' }}>
                <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={50} />
                <span style={{ position: 'absolute', bottom: -2, left: -2, width: 20, height: 20, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}><Icon d="cam" size={11} stroke={2.4} /></span>
              </button>
            ) : <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={50} />}
            <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 15 }}>{profile.name}</strong><span className="tiny muted">{regLabel || 'كاشير'}</span></span>
          </span>
          <span className="tb-wide">
            {onTheme && <button type="button" className="icon-btn" aria-label="غيّر شكل التطبيق" title="غيّر شكل التطبيق" onClick={onTheme}><Icon d="palette" /></button>}
            {onPin && <button type="button" className="icon-btn" aria-label="غيّر الرقم السري" title="غيّر الرقم السري" onClick={onPin}><Icon d="lock" /></button>}
          </span>
          {bell}
          <span className="tb-upd"><UpdateButton /></span>
          <HelpButton />
          <span className="tb-wide"><button type="button" className="icon-btn" aria-label="شارك التطبيق" title="شارك التطبيق" onClick={shareApp}><Icon d="share" /></button></span>
          <span className="tb-wide"><button type="button" className="icon-btn" aria-label="تسجيل خروج" title="تسجيل خروج" onClick={onLogout}><Icon d="logout" /></button></span>
          <MoreMenu items={[
            onTheme && { label: 'غيّر شكل التطبيق', el: <button type="button" className="icon-btn" aria-label="غيّر شكل التطبيق" onClick={onTheme}><Icon d="palette" /></button> },
            onPin && { label: 'غيّر الرقم السري', el: <button type="button" className="icon-btn" aria-label="غيّر الرقم السري" onClick={onPin}><Icon d="lock" /></button> },
            { label: 'حدّث التطبيق', el: <UpdateButton noBanner /> },
            { label: 'شارك التطبيق', el: <button type="button" className="icon-btn" aria-label="شارك التطبيق" onClick={shareApp}><Icon d="share" /></button> },
            { label: 'تسجيل خروج', el: <button type="button" className="icon-btn" aria-label="تسجيل خروج" onClick={onLogout}><Icon d="logout" /></button> },
          ].filter(Boolean)} />
        </div>
      </div>
    </header>
  );
}

// Sends the app link (WhatsApp or anything else). On a computer it copies the link.
export async function shareApp() {
  const url = location.origin + location.pathname;
  const text = 'تطبيق مدقق لاستلام وتسليم الورديات · افتح الرابط ومن قايمة المتصفح اختار «إضافة إلى الشاشة الرئيسية» علشان يتثبت زي أي تطبيق';
  try { if (navigator.share) { await navigator.share({ title: 'مدقق · الورديات', text, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); window.dispatchEvent(new CustomEvent('mdq-toast', { detail: 'اتنسخ رابط التطبيق · الصقه في واتساب' })); }
  catch { window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener'); }
}

// On phones the less-used buttons go behind ☰. The list closes by itself: after choosing, tapping outside, or 8 seconds.
export function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const t = setTimeout(() => setOpen(false), 8000);
    document.addEventListener('pointerdown', out);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', out); };
  }, [open]);
  // A tap anywhere on the row presses its button.
  const press = (e) => {
    const btn = e.currentTarget.querySelector('button');
    if (btn && !btn.contains(e.target)) btn.click();
    setTimeout(() => setOpen(false), 150);
  };
  return (
    <span className="tb-more" ref={box}>
      <button type="button" className={'icon-btn' + (open ? ' on' : '')} aria-label="باقي الاختيارات" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
      </button>
      {open && (
        <div className="tb-menu" role="menu">
          {items.map((it) => (
            <div key={it.label} className="tb-item" role="menuitem" onClick={press}>
              {it.el}<span>{it.label}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function Bills({ bills, setBills, orig, noSteppers }) {
  const set = (f, v) => setBills({ ...bills, [f]: Math.max(0, Math.floor(num(v))) });
  return (
    <div className={'bills' + (noSteppers ? ' compact' : '')}>
      {FACES.map((f, i) => {
        const c = num(bills[f]);
        const changed = orig && num(orig[f]) !== c;
        return (
          <div key={f} className="bill" style={{ background: BILL_BG[i] }}>
            {changed && <span className="changed-tag">اتعدّل</span>}
            <span className="face">{f}</span>
            <span className={'stepper' + (noSteppers ? ' bare' : '')}>
              {!noSteppers && <button type="button" aria-label={`قلل فئة ${f}`} onClick={() => set(f, c - 1)}>−</button>}
              <input inputMode="numeric" aria-label={`عدد فئة ${f}`} value={c} onChange={(e) => set(f, e.target.value)} onFocus={(e) => e.target.select()} />
              {!noSteppers && <button type="button" className="plus" aria-label={`زود فئة ${f}`} onClick={() => set(f, c + 1)}>+</button>}
            </span>
            <span className="small">= {fmt(f * c)} ج</span>
          </div>
        );
      })}
    </div>
  );
}

// Colour for the "take a photo" text: the header ink is white on dark cards, so use a dark colour there.
const isWhite = (c) => /^#f{3}$|^#f{6}$/i.test(String(c || ''));
function photoTone(look) {
  if (!isWhite(look.ink)) return look.ink;
  return look.latin === 'CARD' ? '#1A2B6B' : look.mark;
}

export function MachineRows({ machines, values, setValues, photos, onPhoto, prev, prevName, inline }) {
  const groups = machineGroupsOf(machines);
  const cards = groups.map((g) => {
    const look = machineLook(g.name);
    const total = g.items.reduce((a, i) => a + num(values[i]), 0);
    const first = g.items[0];
    return (
      <div key={g.name} className={"machine-card" + (g.items.length > 1 ? " multi" : "")} style={{ background: look.bg }}>
        <div className="mc-head" style={{ background: look.head, color: look.ink }}>
          <MachineMark name={g.name} size={38} />
          <span className="stack" style={{ gap: 0, flexGrow: 1 }}>
            <strong style={{ fontSize: 18 }}>{g.name}</strong>
            {look.latin && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', opacity: 0.85 }}>{look.latin}</span>}
          </span>
          {g.items.length > 1 && <span className="mc-total">إجمالي {fmt(total)} ج</span>}
        </div>
        <div className="mc-accounts" style={{ gridTemplateColumns: `repeat(${Math.min(g.items.length, 3)}, minmax(0, 1fr))` }}>
          {g.items.map((i) => {
            const m = machines[i];
            return (
              <div key={i} className="mc-acc">
                <span className="stack" style={{ gap: 0 }}>
                  <span className="small" style={{ fontWeight: 700 }}>{m.account}</span>
                  {prev && prev[i] !== '' && <span className="tiny muted">{prevName ? `${prevName} سلّم` : 'اتسلّم'} {fmt(prev[i])}</span>}
                </span>
                <label className="mc-in">
                  <input inputMode="decimal" aria-label={`رصيد ${m.machine} ${m.account}`} value={values[i] ?? ''} onChange={(e) => { const v = [...values]; v[i] = e.target.value; setValues(v); }} onFocus={(e) => e.target.select()} placeholder="الرصيد" />
                  <span className="small muted">ج</span>
                </label>
              </div>
            );
          })}
        </div>
        <PhotoSlot data={photos[first]} onPick={(src) => onPhoto(first, src)} label={g.items.length > 1 ? `صورة واحدة لشاشة ${g.name} (فيها الحسابين)` : `صوّر شاشة ${g.name}`} tone={photoTone(look)} />
      </div>
    );
  });
  if (inline) return <>{cards}</>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {cards}
      {machines.length === 0 && <span className="muted small">مفيش مكن متسجلة للمحل.</span>}
    </div>
  );
}

export function SideBox({ value, setValue, hint }) {
  return (
    <label className="side-box" data-tour="side">
      <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 18, fontWeight: 700 }}>الدرج الجانبي</span><span className="small">{hint}</span></span>
      <span className="in"><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} /><span className="small">ج</span></span>
    </label>
  );
}
