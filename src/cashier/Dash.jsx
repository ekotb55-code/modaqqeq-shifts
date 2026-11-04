import { useEffect, useState } from 'react';
import { Avatar, Icon, NetMeter } from '../ui.jsx';
import { ENTRY_TYPES, SRC_LABEL, durationStr, firstName, fmt, liveBalances, num, safeLabel, shopSafes, timeStr } from '../lib';
import EntryModal from './EntryModal.jsx';

export function entryTitle(e) {
  if (e.type === 'expense') return [e.kindLabel || 'مصروف', e.sub, e.kind === 'supplier' ? (e.invoice === 'invoice' ? '(فاتورة)' : '(توريد بدون فاتورة)') : '', e.note].filter(Boolean).join(' · ');
  if (e.type === 'income') return ['إيراد', e.reason, e.note].filter(Boolean).join(' · ');
  if (e.type === 'transfer') return `تحويل ${SRC_LABEL[e.wallet] || ''}`;
  if (e.type === 'topup') return ['شحن رصيد', e.machine].filter(Boolean).join(' · ');
  if (e.type === 'move') return (e.to || 'side') === 'side' ? 'نقل من الدرج للجانبي' : 'نقل من الجانبي للدرج';
  if (e.type === 'withdraw') return ['سحب لصاحب المحل', e.note].filter(Boolean).join(' · ');
  if (e.type === 'liquidate') return [`تسييل/تحويل ${e.fromLabel || ''} ← ${e.toLabel || ''}`, e.note].filter(Boolean).join(' · ');
  return e.type;
}

export default function Dash({ shop, shift, entries, profile, onHandover, onReceive }) {
  const [modal, setModal] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(id); }, []);

  const sum = (f) => entries.filter(f).reduce((a, e) => a + num(e.amount), 0);
  const balances = liveBalances(shift, entries, shop);
  const byType = (t) => entries.filter((e) => e.type === t);
  const subOf = (arr) => (arr.length ? `${arr.length} عمليات · ${fmt(arr.reduce((a, e) => a + num(e.amount), 0))} ج` : 'لسه مفيش النهارده');
  const out = (src) => sum((e) => (['expense', 'topup', 'withdraw'].includes(e.type) || (e.type === 'liquidate' && e.to !== 'drawer' && e.to !== 'side')) && e.src === src);

  const counters = [
    { label: 'طالع من الدرج', value: out('drawer'), dot: '#fff', cls: 'c-orange' },
    { label: 'طالع من الجانبي', value: out('side'), dot: '#fff', cls: 'c-yellow' },
    { label: 'انستاباي', value: sum((e) => e.type === 'transfer' && e.wallet === 'insta'), dot: '#fff', cls: 'c-violet' },
    { label: 'فودافون كاش', value: sum((e) => e.type === 'transfer' && e.wallet === 'vf'), dot: '#fff', cls: 'c-pink' },
  ];
  const tiles = [
    { t: 'expense', label: 'مصروف', icon: 'up' },
    { t: 'income', label: 'إيراد', icon: 'down' },
    { t: 'transfer', label: 'تحويل محفظة', icon: 'phone' },
  ];
  const extras = [
    { t: 'topup', label: 'شحن رصيد مكنة', icon: 'bolt' },
    { t: 'liquidate', label: 'تسييل وتحويل بين الخزن', icon: 'swap' },
    { t: 'move', label: 'نقل بين الدرجين', icon: 'swap' },
  ];
  const opened = shift.openedAt || shift.openedAtLocal;

  return (
    <div className="wrap">
      <div className="row" style={{ alignItems: 'stretch' }}>
        <section className="hero">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={76} />
              <span className="stack" style={{ gap: 2 }}>
                <h1>{new Date().getHours() < 12 ? 'صباح الفل' : 'مساء الفل'} يا {firstName(profile.name)}</h1>
                <span className="soft" style={{ fontSize: 15 }}>شغّال من {timeStr(opened)} · بقالك {durationStr(opened)}</span>
              </span>
            </div>
            <NetMeter />
          </div>
          <div className="spread" style={{ alignItems: 'flex-end' }}>
            <span className="stack" style={{ gap: 0 }}><span className="small soft">عملياتك النهارده</span><span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.1 }}>{entries.length}</span></span>
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" style={{ height: 58, background: 'rgba(255,255,255,.18)', fontSize: 16 }} onClick={onReceive}>تعديل الاستلام</button>
            <button type="button" className="btn lime" style={{ paddingInline: '26px 10px', height: 58 }} onClick={onHandover}>
              سلّم الوردية<span className="ic" style={{ background: 'var(--ink)', color: 'var(--lime)', width: 40, height: 40 }}><Icon d="down" size={20} stroke={2.6} /></span>
            </button>
            </span>
          </div>
        </section>
        <div className="counters">
          {counters.map((c) => (
            <div key={c.label} className={'counter ' + c.cls}>
              <span className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot" style={{ background: c.dot, width: 10, height: 10 }} />{c.label}</span>
              <span className="v">{fmt(c.value)}<span className="small muted" style={{ fontWeight: 500 }}> ج</span></span>
            </div>
          ))}
        </div>
      </div>

      <div className="tiles">
        {tiles.map((x) => (
          <button key={x.t} type="button" className="tile" style={{ background: ENTRY_TYPES[x.t].color }} onClick={() => setModal(x.t)}>
            <span className="spread">
              <span className="circle"><Icon d={x.icon} size={28} /></span>
              <span className="plus" style={{ color: ENTRY_TYPES[x.t].color }}><Icon d="plus" size={20} stroke={2.6} /></span>
            </span>
            <span className="stack" style={{ gap: 2 }}><span className="t">{x.label}</span><span style={{ fontSize: 15, fontWeight: 500 }}>{subOf(byType(x.t))}</span></span>
          </button>
        ))}
      </div>

      <div className="row">
        <section className="card tint-blue" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>حاجات تانية</h2>
          {extras.map((x) => (
            <button key={x.t} type="button" className="extra" onClick={() => setModal(x.t)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="circ" style={{ background: ENTRY_TYPES[x.t].color }}><Icon d={x.icon} /></span>{x.label}</span>
              <Icon d="chevron" size={18} />
            </button>
          ))}
        </section>
        <section className="card" style={{ flex: '2 1 460px', gap: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>عمليات النهارده</h2>
          {entries.length === 0 && <div className="empty">لسه مسجلتش أي عملية</div>}
          {entries.map((e) => (
            <div key={e.id} className="feed-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span className="feed-ic" style={{ background: ENTRY_TYPES[e.type]?.color }}><Icon d={{ expense: 'up', income: 'down', transfer: 'phone', topup: 'bolt', move: 'swap', withdraw: 'person', liquidate: 'swap' }[e.type]} size={18} /></span>
                <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{entryTitle(e)}</span>
                  <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || SRC_LABEL[e.wallet] || safeLabel(e.src, shop)}{e.hasPendingWrites ? ' · لسه بيترفع' : ''}</span>
                </span>
              </span>
              <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap' }}>{ENTRY_TYPES[e.type]?.sign < 0 ? '−' : ENTRY_TYPES[e.type]?.sign > 0 ? '+' : ''}{fmt(e.amount)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <div className="spread"><h2 style={{ fontSize: 17, fontWeight: 700 }}>أرصدة الخزن دلوقتي</h2><span className="tiny muted">بتتحدث مع كل عملية</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {shopSafes(shop).filter((x) => x.key !== 'drawer').map((x) => (
            <div key={x.key} style={{ background: x.color, borderRadius: 20, padding: '12px 14px' }}>
              <div className="small" style={{ fontWeight: 600 }}>{x.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(balances[x.key] ?? 0)}<span className="small" style={{ fontWeight: 500 }}> ج</span></div>
            </div>
          ))}
        </div>
      </section>

      {modal && <EntryModal type={modal} shop={shop} shift={shift} profile={profile} balances={balances} onClose={() => setModal(null)} />}
    </div>
  );
}
