import { useEffect, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Avatar, Icon, Modal, NetMeter, WALLET_LOOK, WalletMark, useToast } from '../ui.jsx';
import { ENTRY_TYPES, SRC_LABEL, WALLETS, durationStr, firstName, fmt, liveBalances, machineTotals, num, walletModeOf, registersOf, safeLabel, shopSafes, timeStr } from '../lib';
import { Incoming, SendModal } from './Transfers.jsx';
import EntryModal from './EntryModal.jsx';

export function entryTitle(e) {
  if (e.type === 'expense') return [e.kindLabel || 'مصروف', e.sub, e.kind === 'supplier' ? (e.invoice === 'invoice' ? '(فاتورة)' : '(توريد بدون فاتورة)') : '', e.note].filter(Boolean).join(' · ');
  if (e.type === 'income') return ['إيراد', e.reason, e.note].filter(Boolean).join(' · ');
  if (e.type === 'transfer') return `تحويل ${SRC_LABEL[e.wallet] || ''}`;
  if (e.type === 'topup') return ['شحن رصيد', e.machine].filter(Boolean).join(' · ');
  if (e.type === 'move') return (e.to || 'side') === 'side' ? 'نقل من الدرج للجانبي' : 'نقل من الجانبي للدرج';
  if (e.type === 'withdraw') return ['سحب لصاحب المحل', e.note].filter(Boolean).join(' · ');
  if (e.type === 'liquidate') return [`تسييل/تحويل ${e.fromLabel || ''} ← ${e.toLabel || ''}`, e.note].filter(Boolean).join(' · ');
  if (e.type === 'xfer_out') return [`فلوس لـ ${e.toName || 'كاشير تاني'}`, e.note].filter(Boolean).join(' · ');
  if (e.type === 'xfer_in') return [`استلام من ${e.fromName || 'كاشير تاني'}`, e.diffFromSent ? `(اتبعت ${fmt(e.sentAmount)})` : ''].filter(Boolean).join(' ');
  return e.type;
}

export default function Dash({ shop, shift, entries, deleted = [], incoming = [], outgoing = [], profile, onHandover, onReceive }) {
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(id); }, []);

  const sum = (f) => entries.filter(f).reduce((a, e) => a + num(e.amount), 0);
  const balances = liveBalances(shift, entries, shop);
  const byType = (t) => entries.filter((e) => e.type === t);
  const subOf = (arr) => (arr.length ? `${arr.length} عمليات · ${fmt(arr.reduce((a, e) => a + num(e.amount), 0))} ج` : 'لسه مفيش النهارده');
  const out = (src) => sum((e) => (['expense', 'topup', 'withdraw', 'xfer_out'].includes(e.type) || (e.type === 'liquidate' && e.to !== 'drawer' && e.to !== 'side')) && e.src === src);

  const wallets = WALLETS.filter((w) => (shop.wallets || ['insta', 'vf']).includes(w.key) && walletModeOf(shop, w.key) === 'owner').map((w) => w.key);
  const ops = !shop.noOps;
  const counters = [
    { label: 'طالع من الدرج', value: out('drawer'), dot: '#fff', cls: 'c-orange' },
    !shop.noSide && { label: 'طالع من الجانبي', value: out('side'), dot: '#fff', cls: 'c-yellow' },
    wallets.includes('insta') && { label: 'انستاباي', value: sum((e) => e.type === 'transfer' && e.wallet === 'insta'), dot: '#fff', cls: 'c-violet', w: 'insta' },
    wallets.includes('vf') && { label: 'فودافون كاش', value: sum((e) => e.type === 'transfer' && e.wallet === 'vf'), dot: '#fff', cls: 'c-pink', w: 'vf' },
  ].filter(Boolean);
  const tiles = [
    ops && { t: 'expense', label: 'مصروف', icon: 'up' },
    ops && { t: 'income', label: 'إيراد', icon: 'down' },
    wallets.length > 0 && { t: 'transfer', label: 'تحويل محفظة', icon: 'phone' },
  ].filter(Boolean);
  const extras = [
    registersOf(shop).length > 0 && { t: 'xfer', label: 'فلوس / فكة لكاشير تاني', icon: 'swap', color: '#4CC3FF' },
    ops && (shop.machines || []).length > 0 && { t: 'topup', label: 'شحن رصيد مكنة', icon: 'bolt' },
    ops && { t: 'liquidate', label: 'تسييل وتحويل بين الخزن', icon: 'swap' },
    !shop.noSide && { t: 'move', label: 'نقل بين الدرجين', icon: 'swap' },
  ].filter(Boolean);
  const pendingIds = new Set(outgoing.map((t) => t.id));
  const opened = shift.openedAt || shift.openedAtLocal;

  return (
    <div className="wrap dash">
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
            <div key={c.label} className={'counter ' + c.cls + (c.w ? ' brand' : '')} style={c.w ? { background: WALLET_LOOK[c.w].bg, color: '#fff' } : undefined}>
              <span className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot" style={{ background: c.dot, width: 10, height: 10 }} />{c.label}</span>
              <span className="v">{fmt(c.value)}<span className="small muted" style={{ fontWeight: 500 }}> ج</span></span>
            </div>
          ))}
        </div>
      </div>

      <Incoming list={incoming} shop={shop} shift={shift} profile={profile} />

      {tiles.length > 0 && <div className="tiles" style={tiles.length < 3 ? { gridTemplateColumns: `repeat(${tiles.length}, 1fr)` } : undefined}>
        {tiles.map((x) => (
          <button key={x.t} type="button" className="tile" style={{ background: ENTRY_TYPES[x.t].color }} onClick={() => setModal(x.t)}>
            <span className="spread">
              <span className="circle"><Icon d={x.icon} size={28} /></span>
              <span className="plus" style={{ color: ENTRY_TYPES[x.t].color }}><Icon d="plus" size={20} stroke={2.6} /></span>
            </span>
            <span className="stack" style={{ gap: 2 }}><span className="t">{x.label}</span><span style={{ fontSize: 15, fontWeight: 500 }}>{subOf(byType(x.t))}</span></span>
          </button>
        ))}
      </div>}

      <div className="row">
        {extras.length > 0 && <section className="card tint-blue" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>حاجات تانية</h2>
          {extras.map((x) => (
            <button key={x.t} type="button" className="extra" onClick={() => setModal(x.t)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="circ" style={{ background: x.color || ENTRY_TYPES[x.t].color }}><Icon d={x.icon} /></span>{x.label}</span>
              <Icon d="chevron" size={18} />
            </button>
          ))}
        </section>}
        <section className="card" style={{ flex: '2 1 460px', gap: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>عمليات النهارده</h2>
          {entries.length === 0 && <div className="empty">لسه مسجلتش أي عملية</div>}
          {entries.map((e) => (
            <div key={e.id} className="feed-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span className="feed-ic" style={{ background: ENTRY_TYPES[e.type]?.color }}><Icon d={{ expense: 'up', income: 'down', transfer: 'phone', topup: 'bolt', move: 'swap', withdraw: 'person', liquidate: 'swap', xfer_out: 'swap', xfer_in: 'down' }[e.type]} size={18} /></span>
                <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{entryTitle(e)}</span>
                  <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || SRC_LABEL[e.wallet] || safeLabel(e.src, shop)}{e.hasPendingWrites ? ' · لسه بيترفع' : ''}{e.type === 'xfer_out' ? (pendingIds.has(e.transferId) ? ' · مستني تأكيد' : ' · ✓ اتأكد') : ''}</span>
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap' }}>{ENTRY_TYPES[e.type]?.sign < 0 ? '−' : ENTRY_TYPES[e.type]?.sign > 0 ? '+' : ''}{fmt(e.amount)}</span>
                {shift.status === 'open' && e.type !== 'xfer_in' && (e.type !== 'xfer_out' || pendingIds.has(e.transferId)) && <button type="button" className="icon-btn del-btn" aria-label={`امسح ${entryTitle(e)}`} title="امسح العملية" onClick={() => setDel(e)}><Icon d="trash" size={17} /></button>}
              </span>
            </div>
          ))}
          {deleted.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="extra" style={{ background: 'var(--bad-soft, #FFE4E4)' }} onClick={() => setShowDeleted(!showDeleted)} aria-expanded={showDeleted}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="circ" style={{ background: '#FF8A8A' }}><Icon d="trash" /></span>المحذوفات ({deleted.length})</span>
                <Icon d="chevron" size={18} />
              </button>
              {showDeleted && <DeletedList items={deleted} shop={shop} />}
            </div>
          )}
        </section>
      </div>

      {shopSafes(shop).some((x) => x.key !== 'drawer') && <section className="card">
        <div className="spread"><h2 style={{ fontSize: 17, fontWeight: 700 }}>أرصدة الخزن دلوقتي</h2><span className="tiny muted">بتتحدث مع كل عملية</span></div>
        <div className="safes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {shopSafes(shop).filter((x) => x.key !== 'drawer').flatMap((x) => {
            const card = (
              x.kind === 'wallet' ? (
                <div key={x.key} style={{ background: WALLET_LOOK[x.key]?.bg || x.color, color: '#fff', borderRadius: 20, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <WalletMark k={x.key} size={40} />
                  <span className="stack" style={{ gap: 0 }}>
                    <span className="small" style={{ fontWeight: 700 }}>{x.label} <span className="tiny" style={{ fontWeight: 500, opacity: 0.9 }}>· {x.mode === 'owner' ? 'تحويلات لصاحب المحل' : 'رصيد'}</span></span>
                    <span style={{ fontSize: 24, fontWeight: 800 }}>{fmt(balances[x.key] ?? 0)}<span className="small" style={{ fontWeight: 500 }}> ج</span></span>
                  </span>
                </div>
              ) : (
                <div key={x.key} style={{ background: x.color, borderRadius: 20, padding: '12px 14px' }}>
                  <div className="small" style={{ fontWeight: 600 }}>{x.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(balances[x.key] ?? 0)}<span className="small" style={{ fontWeight: 500 }}> ج</span></div>
                </div>
              )
            );
            const t = machineTotals(shop, balances).find((g) => g.after === x.key);
            return t ? [card, (
              <div key={t.key} style={{ background: '#FFE27A', border: '2px solid #E5B800', borderRadius: 20, padding: '12px 14px' }}>
                <div className="small" style={{ fontWeight: 700 }}>{t.label} <span className="tiny muted">({t.accounts} حسابات)</span></div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(t.value ?? 0)}<span className="small" style={{ fontWeight: 500 }}> ج</span></div>
              </div>
            )] : [card];
          })}
        </div>
      </section>}

      {del && <DeleteModal entry={del} shift={shift} profile={profile} onClose={() => setDel(null)} />}
      {modal === 'xfer' && <SendModal shop={shop} shift={shift} profile={profile} balances={balances} onClose={() => setModal(null)} />}
      {modal && modal !== 'xfer' && <EntryModal type={modal} shop={shop} shift={shift} profile={profile} balances={balances} onClose={() => setModal(null)} />}
    </div>
  );
}

export function DeletedList({ items, shop }) {
  return (
    <div className="stack" style={{ gap: 0, marginTop: 6 }}>
      {items.map((e) => (
        <div key={e.id} className="feed-row" style={{ opacity: 0.85 }}>
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, textDecoration: 'line-through' }}>{entryTitle(e)}</span>
            <span className="tiny muted">اتسجلت {timeStr(e.createdAt || e.createdAtLocal)} · {SRC_LABEL[e.src] || SRC_LABEL[e.wallet] || safeLabel(e.src, shop)} · اتمسحت {timeStr(e.deletedAt || e.deletedAtLocal)}{e.deletedByName ? ` بواسطة ${e.deletedByName}` : ''}</span>
            {e.deleteReason && <span className="tiny" style={{ fontWeight: 600 }}>السبب: {e.deleteReason}</span>}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', textDecoration: 'line-through', color: 'var(--muted)' }}>{fmt(e.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function DeleteModal({ entry, shift, profile, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const go = () => {
    const b = writeBatch(db);
    b.update(doc(db, 'shifts', shift.id, 'entries', entry.id), {
      deleted: true, deletedAt: serverTimestamp(), deletedAtLocal: Date.now(),
      deletedBy: profile.id, deletedByName: profile.name, deleteReason: reason.trim(),
    });
    if (entry.type === 'xfer_out' && entry.transferId) b.update(doc(db, 'transfers', entry.transferId), { status: 'cancelled', cancelledAt: serverTimestamp() });
    b.commit().catch((err) => { console.error(err); toast('مش قادرين نمسحها، جرّب تاني', 'err'); });
    toast('العملية اتمسحت واتحطت في المحذوفات');
    onClose();
  };
  return (
    <Modal title="تمسح العملية دي؟" icon="trash" color="#FF8A8A" onClose={onClose} width={440}>
      <div className="m-row" style={{ padding: 12 }}>
        <span className="stack" style={{ gap: 0, flexGrow: 1 }}><strong>{entryTitle(entry)}</strong><span className="small muted">{timeStr(entry.createdAt || entry.createdAtLocal)}</span></span>
        <strong style={{ fontSize: 18 }}>{fmt(entry.amount)} ج</strong>
      </div>
      <span className="small muted" style={{ lineHeight: 1.7 }}>هتتشال من الحساب، بس هتفضل باينة في «المحذوفات» والمحاسب هيشوفها.</span>
      <label className="field">ليه بتمسحها؟ (اختياري)<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: اتسجلت مرتين" /></label>
      <button type="button" className="btn full" style={{ background: '#E5484D' }} onClick={go}>امسحها</button>
      <button type="button" className="link" onClick={onClose}>رجوع</button>
    </Modal>
  );
}
