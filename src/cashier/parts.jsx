import { Avatar, Icon } from '../ui.jsx';
import { BILL_BG, FACES, fmt, num } from '../lib';

export function Topbar({ shopPub, profile, steps, onLogout, posUrl, onPin, onPhoto, regLabel }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <img className="logo-mdq" src="./modaqqeq-logo.png" alt="مدقق" />
        {steps && (
          <ol className="steps" aria-label="خطوات الوردية">
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
          <span className="who">
            {onPhoto ? (
              <button type="button" onClick={onPhoto} aria-label="غيّر صورتك" title="غيّر صورتك" style={{ border: 0, background: 'transparent', padding: 0, position: 'relative' }}>
                <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={50} />
                <span style={{ position: 'absolute', bottom: -2, left: -2, width: 20, height: 20, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}><Icon d="cam" size={11} stroke={2.4} /></span>
              </button>
            ) : <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={50} />}
            <span className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 15 }}>{profile.name}</strong><span className="tiny muted">{regLabel || 'كاشير'}</span></span>
          </span>
          {onPin && <button type="button" className="icon-btn" aria-label="غيّر الرقم السري" title="غيّر الرقم السري" onClick={onPin}><Icon d="lock" /></button>}
          <button type="button" className="icon-btn" aria-label="تسجيل خروج" title="تسجيل خروج" onClick={onLogout}><Icon d="logout" /></button>
        </div>
      </div>
    </header>
  );
}

export function Bills({ bills, setBills, orig }) {
  const set = (f, v) => setBills({ ...bills, [f]: Math.max(0, Math.floor(num(v))) });
  return (
    <div className="bills">
      {FACES.map((f, i) => {
        const c = num(bills[f]);
        const changed = orig && num(orig[f]) !== c;
        return (
          <div key={f} className="bill" style={{ background: BILL_BG[i] }}>
            {changed && <span className="changed-tag">اتعدّل</span>}
            <span className="face">{f}</span>
            <span className="stepper">
              <button type="button" aria-label={`قلل فئة ${f}`} onClick={() => set(f, c - 1)}>−</button>
              <input inputMode="numeric" aria-label={`عدد فئة ${f}`} value={c} onChange={(e) => set(f, e.target.value)} onFocus={(e) => e.target.select()} />
              <button type="button" className="plus" aria-label={`زود فئة ${f}`} onClick={() => set(f, c + 1)}>+</button>
            </span>
            <span className="small">= {fmt(f * c)} ج</span>
          </div>
        );
      })}
    </div>
  );
}

export function MachineRows({ machines, values, setValues, photos, onPhoto }) {
  const counts = machines.reduce((a, m) => ({ ...a, [m.machine]: (a[m.machine] || 0) + 1 }), {});
  return (
    <div className="stack">
      {machines.map((m, i) => {
        const has = !!photos[i];
        const lastOfGroup = counts[m.machine] > 1 && machines[i + 1]?.machine !== m.machine;
        const total = lastOfGroup ? machines.reduce((a, x, j) => (x.machine === m.machine ? a + num(values[j]) : a), 0) : 0;
        return (
          <div key={i} className="stack" style={{ gap: 6 }}>
            <div className="m-row">
              <span className="lbl">
                <span className="small"><b>{m.machine}</b> · {m.account}</span>
                <span className="tiny" style={{ color: has ? '#3D6B00' : 'var(--muted)', fontWeight: 600 }}>{has ? '✓ الصورة اترفعت · المحاسب هيراجعها' : 'صوّر شاشة المكنة'}</span>
              </span>
              <input inputMode="decimal" aria-label={`رصيد ${m.machine} ${m.account}`} value={values[i] ?? ''} onChange={(e) => { const v = [...values]; v[i] = e.target.value; setValues(v); }} onFocus={(e) => e.target.select()} />
              <button type="button" className={'cam' + (has ? ' ok' : '')} aria-label={`صورة شاشة ${m.machine} ${m.account}`} onClick={() => onPhoto(i)}>
                <Icon d={has ? 'check' : 'cam'} />
              </button>
            </div>
            {lastOfGroup && (
              <div className="spread" style={{ background: 'rgba(255,200,0,.35)', borderRadius: 16, padding: '8px 14px' }}>
                <span className="small" style={{ fontWeight: 700 }}>إجمالي {m.machine}</span>
                <strong style={{ fontSize: 18 }}>{fmt(total)} ج</strong>
              </div>
            )}
          </div>
        );
      })}
      {machines.length === 0 && <span className="muted small">مفيش مكن متسجلة للمحل.</span>}
    </div>
  );
}

export function SideBox({ value, setValue, hint }) {
  return (
    <label className="side-box">
      <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 18, fontWeight: 700 }}>الدرج الجانبي</span><span className="small">{hint}</span></span>
      <span className="in"><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} /><span className="small">ج</span></span>
    </label>
  );
}
