import { Avatar, Icon, MachineMark, machineLook } from '../ui.jsx';
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

export function MachineRows({ machines, values, setValues, photos, onPhoto }) {
  const groups = [];
  machines.forEach((m, i) => {
    const g = groups.find((x) => x.name === m.machine);
    if (g) g.items.push(i); else groups.push({ name: m.machine, items: [i] });
  });
  return (
    <div className="stack" style={{ gap: 12 }}>
      {groups.map((g) => {
        const look = machineLook(g.name);
        const total = g.items.reduce((a, i) => a + num(values[i]), 0);
        return (
          <div key={g.name} className="machine-card" style={{ background: look.bg }}>
            <div className="mc-head" style={{ background: look.head, color: look.ink }}>
              <MachineMark name={g.name} size={38} />
              <span className="stack" style={{ gap: 0, flexGrow: 1 }}>
                <strong style={{ fontSize: 18 }}>{g.name}</strong>
                {look.latin && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', opacity: 0.85 }}>{look.latin}</span>}
              </span>
              {g.items.length > 1 && <span className="mc-total">إجمالي {fmt(total)} ج</span>}
            </div>
            {g.items.map((i) => {
              const m = machines[i];
              const has = !!photos[i];
              return (
                <div key={i} className="m-row" style={{ background: '#fff' }}>
                  <span className="lbl">
                    <span className="small"><b>{m.account}</b></span>
                    <span className="tiny" style={{ color: has ? '#3D6B00' : 'var(--muted)', fontWeight: 600 }}>{has ? '✓ الصورة اترفعت' : 'صوّر شاشة المكنة'}</span>
                  </span>
                  <input inputMode="decimal" aria-label={`رصيد ${m.machine} ${m.account}`} value={values[i] ?? ''} onChange={(e) => { const v = [...values]; v[i] = e.target.value; setValues(v); }} onFocus={(e) => e.target.select()} style={{ border: '2px solid #DCE3F5' }} />
                  <button type="button" className={'cam' + (has ? ' ok' : '')} aria-label={`صورة شاشة ${m.machine} ${m.account}`} onClick={() => onPhoto(i)}>
                    <Icon d={has ? 'check' : 'cam'} />
                  </button>
                </div>
              );
            })}
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
