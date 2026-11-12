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
const r2s = (x) => Math.round(x * 100) / 100;

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
            {c.transfers > 0 && <Line label="تحويلات محافظ (بتروح لصاحب المحل)" amount={-c.transfers} />}
            {(c.walletInfo || []).filter((x) => x.mode === 'shop' && x.sales).map((x) => (
              <Line key={x.key} label={`مبيعات اتدفعت على ${x.label} (الفرق)`} amount={-x.sales} />
            ))}
            {c.machines.filter((m) => m.svc).map((m) => (
              <Line key={m.key + 's'} label={`مقابل خدمة ${m.machine} (${fmt(m.svcPct)}%)`} amount={m.svc} />
            ))}
            {c.machines.filter((m) => m.affects && m.sales).map((m) => (m.rateFrom === 'cashier' ? [
              <Line key={m.key} label={`${m.label} · ${m.sales > 0 ? 'مبيعات على المكنة' : 'خدمات اتدفعت كاش'}`} amount={m.effect} />,
              m.fee ? <Line key={m.key + 'f'} label={`مصاريف ${m.machine} (${fmt(m.rate)}%)`} amount={m.feeEffect} tone="bad" /> : null,
            ] : (
              <Line key={m.key} label={`${m.label} · ${m.sales > 0 ? 'مبيعات على المكنة' : 'خدمات اتدفعت كاش'}${m.fee ? ` (شامل نسبة ${fmt(m.rate)}%)` : ''}`} amount={r2s(m.total - (m.svc || 0))} />
            )))}
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
            <SafeCard key={w.key} title={s.mode === 'owner' ? `تحويلات ${w.label} · لصاحب المحل` : `خزنة ${w.label}${s.mode === 'shop' ? ' · تبع المحل' : ''}`} tint="tint-violet"
              badge={s.mode === 'shop' && s.sales !== null && <span className="badge info">الفرق {fmt(s.sales)}</span>}>
              {s.mode !== 'owner' && <Line label="بداية المدة" amount={s.open} />}
              {s.lines.map((l, i) => <Line key={i} {...l} />)}
              {s.mode === 'owner' ? <Line label="إجمالي التحويلات" amount={s.inn} strong /> : s.mode === 'shop' ? (
                <>
                  <Line label="آخر المدة (الكاشير كتبه)" amount={s.close} strong />
                  <Line label="الفرق · اتدفع على المحفظة" amount={s.sales} strong tone={s.sales < 0 ? 'bad' : null} />
                </>
              ) : <Line label="الرصيد آخر الوردية" amount={s.expected} strong />}
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
                {c.machineGroups.map((g) => [
                  ...g.accounts.map((m) => (
                    <tr key={m.key}>
                      <td><b>{g.accounts.length > 1 ? `↳ ${m.account || m.label}` : m.label}</b></td><td>{fmt(m.open)}</td><td>{fmt(m.inn)}</td><td>{fmt(m.out)}</td>
                      <td>{m.close === null ? '—' : fmt(m.close)}</td>
                      <td>{m.sales === null ? '—' : fmt(m.sales)}<CopyBtn value={m.sales === null ? 0 : fmt(Math.abs(m.sales))} /></td>
                      <td>{[m.rate ? `${fmt(m.rate)}% · ${fmt(m.fee)}` : '', m.svc ? `خدمة ${fmt(m.svcPct)}% · +${fmt(m.svc)}` : ''].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{m.affects ? fmt(m.total) : 'مش بتأثر'}</td>
                    </tr>
                  )),
                  g.accounts.length > 1 && (
                    <tr key={g.machine + ':t'} style={{ background: 'rgba(255,200,0,.25)', fontWeight: 800 }}>
                      <td>إجمالي {g.machine}</td><td>{fmt(g.open)}</td><td></td><td></td>
                      <td>{g.close === null ? '—' : fmt(g.close)}</td>
                      <td>{g.sales === null ? '—' : fmt(g.sales)}</td>
                      <td>{g.rate ? fmt(g.fee) : '—'}</td>
                      <td>{g.affects ? fmt(g.effect + g.feeEffect + (g.svc || 0)) : '—'}</td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
          {c.machineGroups.map((g) => (
            <span key={g.machine} className="tiny"><b>{g.machine}</b> · {g.rate ? `نسبة ${fmt(g.rate)}% ${RATE_FROM[g.rateFrom] || ''}` : 'من غير نسبة'}{g.svcPct ? ` · مقابل خدمة ${fmt(g.svcPct)}% على العميل` : ''} · {SETTLE[g.settle] || ''}</span>
          ))}
          {c.liqFees > 0 && <span className="tiny" style={{ fontWeight: 700 }}>مصاريف تسييل في الوردية: {fmt(c.liqFees)} ج</span>}
        </section>
      )}
    </div>
  );
}
