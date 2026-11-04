import { CopyBtn } from '../ui.jsx';
import { RATE_FROM, SETTLE, WALLETS, fmt, timeStr } from '../lib';

function Line({ label, amount, t, strong, tone }) {
  const color = tone === 'bad' ? '#9B1C1C' : tone === 'ok' ? 'var(--lime-ink)' : undefined;
  return (
    <div className="spread" style={{ padding: '7px 0', borderBottom: '1px dashed rgba(21,20,42,.12)', gap: 8, flexWrap: 'nowrap' }}>
      <span className="small" style={{ minWidth: 0, fontWeight: strong ? 700 : 500 }}>
        {t && <span className="tiny muted" style={{ marginInlineEnd: 6 }}>{timeStr(t)}</span>}{label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', fontWeight: strong ? 800 : 600, whiteSpace: 'nowrap', color }}>
        {amount === null || amount === undefined ? '—' : `${amount > 0 && !strong ? '+' : ''}${fmt(amount)}`}
        {amount !== null && amount !== undefined && <CopyBtn value={fmt(Math.abs(amount))} />}
      </span>
    </div>
  );
}

function SafeCard({ title, tint, children, badge }) {
  return (
    <section className={'card ' + tint} style={{ flex: '1 1 320px', gap: 2 }}>
      <div className="spread" style={{ marginBottom: 6 }}><h2 className="h2">{title}</h2>{badge}</div>
      {children}
    </section>
  );
}

// Statement of every safe for one shift. `c` comes from computeShift().
export default function Statements({ c, shift, shop, showDrawer = true }) {
  const rcv = shift.receive || {};
  const d = c.drawer;
  const resultTone = c.drawerDiff === null ? null : c.drawerDiff < 0 ? 'bad' : c.drawerDiff > 0 ? 'ok' : null;
  const wallets = WALLETS.filter((w) => c.safes[w.key] && (c.safes[w.key].open || c.safes[w.key].lines.length || (shop?.wallets || ['insta', 'vf']).includes(w.key)));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 16 }}>
        {showDrawer && (
          <SafeCard title={`خزنة ${shift.cashierName}`} tint="tint-orange" badge={c.drawerDiff !== null && <span className={'badge ' + (c.drawerDiff < 0 ? 'bad' : c.drawerDiff > 0 ? 'ok' : 'info')}>{c.drawerDiff < 0 ? `عجز ${fmt(-c.drawerDiff)}` : c.drawerDiff > 0 ? `زيادة ${fmt(c.drawerDiff)}` : 'مضبوط'}</span>}>
            <Line label="بداية المدة" amount={0} />
            <Line label={`استلام نقدي${rcv.prevCashier ? ` من درج ${rcv.prevCashier}` : ''}`} amount={d.open} t={shift.openedAt || shift.openedAtLocal} />
            {d.lines.map((l, i) => <Line key={i} {...l} />)}
            <Line label="المبيعات (من السيستم)" amount={c.hasSales ? c.sales : null} />
            {c.transfers > 0 && <Line label="مبيعات اتدفعت انستاباي / فودافون" amount={-c.transfers} />}
            {c.machines.filter((m) => m.affects && m.sales).map((m) => (
              <Line key={m.key} label={`${m.label} · ${m.sales > 0 ? 'مبيعات على المكنة' : 'خدمات اتدفعت كاش'}${m.fee && m.rateFrom !== 'cashier' ? ` (شامل نسبة ${fmt(m.rate)}%)` : ''}`} amount={m.effect} />
            ))}
            <Line label="المفروض يتسلّم" amount={d.expected} strong />
            <Line label="اتسلّم فعلًا" amount={d.close} strong />
            <Line label="النتيجة" amount={c.drawerDiff} strong tone={resultTone} />
            {!c.hasSales && <span className="tiny muted" style={{ marginTop: 6 }}>اكتب رقم المبيعات علشان الخزنة تتقفل.</span>}
          </SafeCard>
        )}
        {!shop?.noSide && <SafeCard title="خزنة الجانبي" tint="tint-lime" badge={c.sideDiff !== null && <span className={'badge ' + (Math.abs(c.sideDiff) > 0.009 ? 'bad' : 'ok')}>{Math.abs(c.sideDiff) > 0.009 ? `فرق ${fmt(c.sideDiff)}` : '✓ مظبوط'}</span>}>
          <Line label="بداية المدة (الاستلام)" amount={c.side.open} />
          {c.side.lines.map((l, i) => <Line key={i} {...l} />)}
          <Line label="المفروض يتسلّم" amount={c.side.expected} strong />
          <Line label="اتسلّم فعلًا" amount={c.side.close} strong />
          {shift.handover?.sideFix && <span className="badge bad" style={{ whiteSpace: 'normal', marginTop: 6 }}>كان {shift.handover.sideFix.diff < 0 ? 'ناقص' : 'زيادة'} {fmt(Math.abs(shift.handover.sideFix.diff))} ج واتظبط من درج الكاشير</span>}
        </SafeCard>}
      </div>

      <div className="row" style={{ gap: 16 }}>
        {wallets.map((w) => {
          const s = c.safes[w.key];
          return (
            <SafeCard key={w.key} title={`خزنة ${w.label}`} tint="tint-violet">
              <Line label="بداية المدة" amount={s.open} />
              {s.lines.map((l, i) => <Line key={i} {...l} />)}
              <Line label="الرصيد آخر الوردية" amount={s.expected} strong />
              {w.key === 'insta' && shop?.walletName && <span className="tiny muted" style={{ marginTop: 6 }}>الحساب باسم: {shop.walletName}</span>}
            </SafeCard>
          );
        })}
      </div>

      {c.machines.length > 0 && (
        <section className="card tint-yellow">
          <h2 className="h2">خزن المكن <span className="tiny muted" style={{ fontWeight: 500 }}>· رصيد تراكمي</span></h2>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>المكنة</th><th>استلام</th><th>دخل</th><th>طلع</th><th>تسليم</th><th>حركة المكنة</th><th>النسبة</th><th>أثرها على الدرج</th></tr></thead>
              <tbody>
                {c.machines.map((m) => (
                  <tr key={m.key}>
                    <td><b>{m.label}</b></td><td>{fmt(m.open)}</td><td>{fmt(m.inn)}</td><td>{fmt(m.out)}</td>
                    <td>{m.close === null ? '—' : fmt(m.close)}</td>
                    <td>{m.sales === null ? '—' : fmt(m.sales)}<CopyBtn value={m.sales === null ? 0 : fmt(Math.abs(m.sales))} /></td>
                    <td>{m.rate ? `${fmt(m.rate)}% · ${fmt(m.fee)}` : '—'}</td>
                    <td>{m.affects ? fmt(m.effect) : 'مش بتأثر'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {[...new Map(c.machines.filter((m) => m.rate || m.settle).map((m) => [m.label.split(' · ')[0], m])).entries()].map(([name, m]) => (
            <span key={name} className="tiny"><b>{name}</b> · {m.rate ? `نسبة ${fmt(m.rate)}% ${RATE_FROM[m.rateFrom] || ''}` : 'من غير نسبة'} · {SETTLE[m.settle] || ''}</span>
          ))}
        </section>
      )}
    </div>
  );
}
