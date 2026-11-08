import { useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import { WALLETS, computeShift, emptyBills, fmt, lastKey, machineKey, num, openKey, openOf, walletModeOf, walletModesOf } from '../lib';
import { logAct } from '../activity.js';

const r2 = (v) => Math.round(v * 100) / 100;

// "قفل بالنيابة": shows every safe (drawer, side drawer, shop wallets, machines) with the number it
// should hold right now, the accountant types what is really there, and the shift is submitted
// with those numbers as the handover.
export default function ForceClose({ shift, fullShop, shop, entries, profile, onClose }) {
  const toast = useToast();
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);

  const c = computeShift(shift, entries, shop, null);
  const machines = shop?.machines || [];
  const walletKeys = WALLETS.filter((w) => (shop?.wallets || ['insta', 'vf']).includes(w.key) && walletModeOf(shop, w.key) === 'shop');

  const rows = [
    { key: 'drawer', label: 'درج الكاشير', expected: c.drawer.expectedBase, note: 'من العمليات بس، من غير المبيعات · عدّ الدرج واكتب اللي فيه فعلًا' },
    ...(shop?.noSide ? [] : [{ key: 'side', label: 'الدرج الجانبي', expected: c.side.expected }]),
    ...walletKeys.map((w) => ({ key: 'w:' + w.key, label: w.label, expected: c.safes[w.key]?.expected, note: 'محفظة تبع المحل · اكتب الرصيد اللي على شاشتها' })),
    ...machines.map((m) => {
      const s = c.safes[machineKey(m)];
      return {
        key: machineKey(m), label: `${m.machine} · ${m.account}`, expected: s ? r2(s.open + s.inn - s.out) : null,
        note: m.startZero ? 'بدأت الوردية بصفر · الرقم ده اللي دخلها من العمليات، اكتب اللي على شاشة المكنة' : 'الرقم ده من غير مبيعات الكروت · اكتب اللي على شاشة المكنة',
      };
    }),
  ];

  const missing = rows.filter((r) => String(vals[r.key] ?? '').trim() === '');
  const set = (k, v) => setVals((x) => ({ ...x, [k]: v }));
  const typed = (k) => num(vals[k]);

  const go = async () => {
    if (missing.length) { toast(`اكتب رقم ${missing[0].label}`, 'err'); return; }
    if (!window.confirm('هتقفل الوردية بالنيابة عن الكاشير بالأرقام اللي كتبتها. متأكد؟')) return;
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const walletsTyped = Object.fromEntries(walletKeys.map((w) => [w.key, typed('w:' + w.key)]));
      const handover = {
        bills: emptyBills(), drawerTotal: typed('drawer'), side: shop?.noSide ? 0 : typed('side'),
        machines: machines.map((m) => ({ ...m, value: typed(machineKey(m)) })),
        walletsTyped, walletModes: walletModesOf(shop),
        keepDrawer: 'shop', keepSide: 'stay', forcedCount: true,
      };
      const b = writeBatch(db);
      b.update(doc(db, 'shifts', shift.id), { status: 'submitted', submittedAt: serverTimestamp(), submittedAtLocal: nowIso, forced: true, forcedBy: profile.name, handover });
      const reg = shift.register;
      if (openOf(fullShop, reg)?.id === shift.id) {
        b.update(doc(db, 'shops', shift.shopId), {
          [openKey(reg)]: null,
          [lastKey(reg)]: { shiftId: shift.id, cashierName: shift.cashierName, at: nowIso, bills: handover.bills, drawerTotal: handover.drawerTotal, side: handover.side, machines: handover.machines, walletsTyped, wallets: walletsTyped, keepDrawer: 'shop', keepSide: 'stay', forced: true },
        });
      }
      await b.commit();
      logAct('force', `قفل وردية ${shift.cashierName} بالنيابة · درج ${fmt(handover.drawerTotal)} ج`, { shopId: shift.shopId, shiftId: shift.id });
      toast('الوردية اتقفلت ووصلت للمراجعة');
      onClose();
    } catch (e) { console.error(e); toast('حصلت مشكلة', 'err'); setBusy(false); }
  };

  return (
    <Modal title="قفل الوردية بالنيابة" icon="check" color="var(--blue)" onClose={onClose} width={560}>
      <span className="small" style={{ lineHeight: 1.8 }}>
        دي كل الخزن والرقم اللي المفروض يكون فيها دلوقتي. اكتب الرقم الحقيقي لكل واحدة، وهيتسجّل كأنه تسليم {shift.cashierName}.
      </span>
      <div className="stack" style={{ gap: 10, maxHeight: '55vh', overflowY: 'auto' }}>
        {rows.map((r) => (
          <div key={r.key} className="stack" style={{ gap: 6, background: 'var(--bg)', borderRadius: 18, padding: 12 }}>
            <div className="spread">
              <strong>{r.label}</strong>
              <span className="small">المفروض: <b>{r.expected === null || r.expected === undefined ? '—' : fmt(r.expected)}</b> ج</span>
            </div>
            {r.note && <span className="tiny muted">{r.note}</span>}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" inputMode="decimal" style={{ flex: 1, height: 46, fontWeight: 700 }} value={vals[r.key] ?? ''} onChange={(e) => set(r.key, e.target.value)} placeholder="الرقم الفعلي" aria-label={`الرقم الفعلي ${r.label}`} />
              {r.expected !== null && r.expected !== undefined && <button type="button" className="btn soft sm" onClick={() => set(r.key, String(r.expected))}>زي المفروض</button>}
            </div>
          </div>
        ))}
      </div>
      {missing.length > 0 && <span className="badge warn" style={{ whiteSpace: 'normal' }}>فاضل: {missing.slice(0, 3).map((r) => r.label).join(' · ')}{missing.length > 3 ? ` و${missing.length - 3} كمان` : ''}</span>}
      <button type="button" className="btn full" onClick={go} disabled={busy || missing.length > 0}><Icon d="check" />{busy ? 'لحظة…' : 'قفل الوردية'}</button>
    </Modal>
  );
}
