import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import { useToast } from '../ui.jsx';
import { fmt, num } from '../lib';
import { logAct } from '../activity.js';

// «المناديب»: تسليم ورديات مناديب التوزيع (تطبيق التحميل والتفريغ).
// المندوب بيسلّم من تطبيقه، والتسليم بيظهر هنا للمحاسب: يكتب مبيعات العربية من السيستم ويأكّد، وأي عجز بيتسجل باسمه.
// البيانات على سكريبت جوجل لوحده (شيت «مدقق • التحميل والتفريغ»)؛ السكريبت بيتأكد إنك محاسب من حسابك هنا.
const LU_API = 'https://script.google.com/macros/s/AKfycbzAiM8070GNCmLGOMYDeCHdf-cCMMFFJ3GIjpzznb5znOyWwAHlYZF1eRpqpju9-RoY/exec';

async function luApi(action, data) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('انتهت الجلسة - ادخل تاني');
  let r;
  try { r = await fetch(LU_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ auth: { kind: 'fb', idToken }, action, data: data || {} }) }); }
  catch { throw new Error(navigator.onLine ? 'سيرفر المناديب ما ردّش - حاول تاني كمان شوية' : 'مفيش نت'); }
  let j = null;
  try { j = await r.json(); } catch { throw new Error('سيرفر المناديب ما ردّش صح - حاول تاني كمان شوية'); }
  if (!j.ok) throw new Error(j.err || 'حصلت مشكلة');
  return j.state;
}
const dayTxt = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${+m[3]}/${+m[2]}` : d || ''; };
const timeTxt = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return t || ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'ص' : 'م'}`; };
const r3 = (v) => Math.round(v * 1000) / 1000;

function DiffBadge({ d }) {
  if (d == null || d === '') return <span className="muted">—</span>;
  if (d === 0) return <span className="badge ok">مظبوط</span>;
  return d > 0 ? <span className="badge info">زيادة {fmt(d)} ج</span> : <span className="badge bad">عجز {fmt(-d)} ج</span>;
}

export default function Reps() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sys, setSys] = useState({});
  const busyRef = useRef(false);

  const load = useCallback(async (quiet) => {
    try { setSt(await luApi('state')); setErr(''); }
    catch (e) { if (!quiet) setErr(e.message); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!busyRef.current && !document.hidden) load(true); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (action, data, ok) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try { setSt(await luApi(action, data)); if (ok) toast(ok); return true; }
    catch (e) { toast(e.message, 'err'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };

  if (!st) {
    return (
      <div className="wrap">
        <h1 className="title">المناديب</h1>
        <section className="card">{err ? <div className="spread"><span>{err}</span><button type="button" className="btn sm soft" onClick={() => load()}>حاول تاني</button></div> : <div className="empty">بيحمّل…</div>}</section>
      </div>
    );
  }

  const pend = (st.closings || []).filter((c) => c.status === 'مستني');
  const done = (st.closings || []).filter((c) => c.status !== 'مستني');
  const short = st.short || [];
  const byName = {};
  short.forEach((s) => { byName[s.name] = r3((byName[s.name] || 0) + num(s.amount)); });

  const calc = (c) => {
    const v = sys[c.id] ?? '';
    if (String(v).trim() === '') return { exp: null, diff: null };
    const s = num(v);
    const exp = r3(c.cashIn + s - c.exp);
    return { exp, diff: r3(c.cashOut - exp) };
  };
  const confirm = async (c) => {
    const v = sys[c.id] ?? '';
    if (String(v).trim() === '') { toast('اكتب مبيعات العربية من السيستم الأول', 'err'); return; }
    const { diff } = calc(c);
    if (await run('a_ok', { id: c.id, sys: num(v) }, diff < 0 ? `اتأكد التسليم واتسجل عجز ${fmt(-diff)} ج على ${c.driver}` : 'اتأكد التسليم')) {
      logAct('rep', `أكّد تسليم المندوب ${c.driver}`);
      setSys((o) => { const n = { ...o }; delete n[c.id]; return n; });
    }
  };

  return (
    <div className="wrap">
      <div className="spread">
        <h1 className="title">تسليم المناديب</h1>
        <button type="button" className="btn sm soft" onClick={() => load()} disabled={busy}>تحديث</button>
      </div>
      <span className="sub" style={{ marginTop: -8 }}>المندوب بيسلّم من تطبيق التحميل والتفريغ. اكتب مبيعات العربية من السيستم، والتطبيق يحسب العجز أو الزيادة.</span>

      <h2 className="h2" style={{ marginTop: 8 }}>مستني مراجعة {pend.length ? <span className="badge warn">{pend.length}</span> : null}</h2>
      {pend.length === 0 && <section className="card"><div className="empty">مفيش تسليمات مستنية</div></section>}
      <div className="reps-grid">
        {pend.map((c) => {
          const k = calc(c);
          const rec = c.lines.filter((x) => x.kind === 'استلام');
          const ex = c.lines.filter((x) => x.kind === 'مصروف');
          return (
            <section key={c.id} className="card rep-card">
              <div className="spread">
                <div className="stack" style={{ gap: 0 }}><strong style={{ fontSize: 20 }}>{c.driver}</strong><span className="tiny muted">{c.truck} · {dayTxt(c.date)} · {timeTxt(c.t)}</span></div>
                <span className="badge warn">مستني</span>
              </div>
              <div className="rep-nums">
                <div><span className="tiny muted">استلم</span><strong>{fmt(c.cashIn)}</strong></div>
                <div><span className="tiny muted">مصروفات</span><strong>{fmt(c.exp)}</strong></div>
                <div><span className="tiny muted">سلّم</span><strong>{fmt(c.cashOut)}</strong></div>
              </div>
              {(rec.length > 0 || ex.length > 0) && (
                <details>
                  <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>التفاصيل ({rec.length + ex.length})</summary>
                  <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                    {rec.map((x, i) => <div key={'r' + i} className="spread small"><span>استلام · {x.type}{x.note ? ` · ${x.note}` : ''}</span><strong>{fmt(x.amt)}</strong></div>)}
                    {ex.map((x, i) => <div key={'e' + i} className="spread small"><span>مصروف · {x.type}{x.note ? ` · ${x.note}` : ''}</span><strong>{fmt(x.amt)}</strong></div>)}
                  </div>
                </details>
              )}
              <label className="field">
                <span className="small" style={{ fontWeight: 700 }}>مبيعات العربية من السيستم</span>
                <input className="input" inputMode="decimal" value={sys[c.id] ?? ''} onChange={(e) => setSys((o) => ({ ...o, [c.id]: e.target.value }))} placeholder="اكتب المبيعات" />
              </label>
              <div className="spread small"><span>المفروض يسلّم</span><strong>{k.exp == null ? '—' : `${fmt(k.exp)} ج`}</strong></div>
              <div className="spread small"><span>الفرق</span><DiffBadge d={k.diff} /></div>
              <button type="button" className="btn full" disabled={busy} onClick={() => confirm(c)}>تأكيد التسليم</button>
            </section>
          );
        })}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="h2" style={{ marginTop: 8 }}>اتراجع النهارده</h2>
          <section className="card" style={{ overflowX: 'auto' }}>
            <table className="rep-tbl">
              <thead><tr><th>المندوب</th><th>استلم</th><th>مصروفات</th><th>سلّم</th><th>المبيعات</th><th>النتيجة</th><th>راجعه</th></tr></thead>
              <tbody>{done.map((c) => <tr key={c.id}><td><strong>{c.driver}</strong></td><td>{fmt(c.cashIn)}</td><td>{fmt(c.exp)}</td><td>{fmt(c.cashOut)}</td><td>{fmt(c.sys)}</td><td><DiffBadge d={c.diff} /></td><td className="muted">{c.by}</td></tr>)}</tbody>
            </table>
          </section>
        </>
      )}

      <h2 className="h2" style={{ marginTop: 8 }}>عجز المناديب</h2>
      <section className="card" style={{ overflowX: 'auto' }}>
        {Object.keys(byName).length > 0 && <div className="chips">{Object.entries(byName).map(([n, a]) => <span key={n} className="badge bad">{n}: {fmt(a)} ج</span>)}</div>}
        {short.length === 0 ? <div className="empty">مفيش عجز</div> : (
          <table className="rep-tbl">
            <thead><tr><th>الاسم</th><th>التاريخ</th><th>المبلغ</th><th>البيان</th><th>الحالة</th></tr></thead>
            <tbody>{short.map((s) => (
              <tr key={s.id}><td><strong>{s.name}</strong></td><td>{dayTxt(s.date)}</td><td><strong>{fmt(s.amount)} ج</strong></td><td>{s.note}</td>
                <td>{s.status === 'مؤكد' ? <span className="badge ok">مؤكد</span> : <button type="button" className="btn sm soft" disabled={busy} onClick={() => run('a_shconf', { id: s.id }, 'العجز اتأكد')}>تأكيد العجز</button>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
