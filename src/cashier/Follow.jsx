import { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Img, Modal, PhotoView, useToast } from '../ui.jsx';
import ShiftChat from '../ShiftChat.jsx';
import { dateStr, diffText, durationStr, firstName, fmt, num, timeStr, entrySign } from '../lib';
import { logAct } from '../activity.js';
import { photoSrc, pushEvent } from '../cloud.js';
import { ENTRY_TYPES, SRC_LABEL, WALLETS, machineKey } from '../lib';
import { entryTitle } from './Dash.jsx';

// Everything the cashier recorded in this shift, expenses first, with totals and photos — to find a forgotten one.
function ShiftOpsList({ shift }) {
  const [entries, setEntries] = useState(null);
  const [photos, setPhotos] = useState({});
  const [view, setView] = useState(null);
  useEffect(() => onSnapshot(query(collection(db, 'shifts', shift.id, 'entries'), orderBy('createdAt', 'asc')),
    (q) => setEntries(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setEntries([])), [shift.id]);
  useEffect(() => onSnapshot(collection(db, 'shifts', shift.id, 'photos'), (q) => {
    const m = {};
    q.docs.forEach((d) => { const p = { id: d.id, ...d.data() }; const src = photoSrc(shift.id, p); if (p.entryId && src) m[d.id] = src; });
    setPhotos(m);
  }, () => {}), [shift.id]);
  const live = (entries || []).filter((e) => !e.deleted);
  const deleted = (entries || []).filter((e) => e.deleted);
  const groups = [
    { id: 'out', title: 'المصروفات واللي طلع من الدرج', color: 'var(--orange)', list: live.filter((e) => entrySign(e) < 0) },
    { id: 'in', title: 'الإيرادات والتحويلات اللي دخلت', color: '#22B07D', list: live.filter((e) => entrySign(e) > 0) },
    { id: 'mv', title: 'نقل وتسييل', color: 'var(--sky)', list: live.filter((e) => !entrySign(e)) },
  ].filter((g) => g.list.length);
  const total = (l) => l.reduce((a, e) => a + num(e.amount), 0);
  const Row = ({ e, struck }) => (
    <div className="list-row" style={{ gap: 10, opacity: struck ? 0.6 : 1 }}>
      <span className="stack" style={{ gap: 1, minWidth: 0, flex: 1 }}>
        <strong style={{ fontSize: 14, textDecoration: struck ? 'line-through' : 'none' }}>{entryTitle(e)}</strong>
        <span className="tiny muted">{timeStr(e.createdAt || e.createdAtLocal)}{e.src ? ` · من ${SRC_LABEL[e.src] || e.src}` : ''}{struck && e.deleteReason ? ` · اتمسح: ${e.deleteReason}` : ''}{e.byAccountant ? ' · من المحاسب' : ''}</span>
      </span>
      {e.photoId && photos[e.photoId] && <Img className="thumb" style={{ width: 42, height: 42 }} src={photos[e.photoId]} alt="صورة" onClick={() => setView(photos[e.photoId])} />}
      <strong style={{ whiteSpace: 'nowrap' }}>{fmt(e.amount)} ج</strong>
    </div>
  );
  return (
    <>
      {entries === null && <span className="muted">بنحمّل…</span>}
      {entries && live.length === 0 && <div className="empty">مسجّلتش أي عمليات في الوردية دي</div>}
      {groups.map((g) => (
        <div key={g.id} className="stack" style={{ gap: 0 }}>
          <div className="spread" style={{ padding: '6px 0', borderBottom: `3px solid ${g.color}` }}>
            <strong>{g.title} <span className="tiny muted">({g.list.length})</span></strong>
            <strong>{fmt(total(g.list))} ج</strong>
          </div>
          {g.list.map((e) => <Row key={e.id} e={e} />)}
        </div>
      ))}
      {deleted.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '6px 0' }}>عمليات اتمسحت ({deleted.length})</summary>
          {deleted.map((e) => <Row key={e.id} e={e} struck />)}
        </details>
      )}
      {view && <PhotoView src={view} onClose={() => setView(null)} />}
    </>
  );
}

// What the cashier counted when he took the shift and when he handed it over: drawers, wallets, machines.
// Only his own numbers — no expected amounts or results.
const KEEP = { stay: 'فضل في الدرج', shop: 'اتسلّم للمحل', main: 'اتسلّم للكاشير الأساسي' };
function countRows(shift) {
  const r = shift.receive || {};
  const h = shift.handover || null;
  const has = (v) => v !== undefined && v !== null && v !== '';
  const rows = [];
  rows.push({ label: 'درج الكاشير', a: r.drawerTotal, b: h?.drawerTotal, note: h?.keepDrawer ? KEEP[h.keepDrawer] : '' });
  if (has(r.side) || has(h?.side)) rows.push({ label: 'الدرج الجانبي', a: r.side, b: h?.side, note: h?.keepSide ? KEEP[h.keepSide] : '' });
  const modes = h?.walletModes || r.walletModes || {};
  WALLETS.forEach((w) => {
    const a = r.wallets?.[w.key];
    const b = h?.walletsTyped?.[w.key];
    if ((modes[w.key] || 'owner') === 'owner') return; // goes to the owner: no balance to count
    if (!has(a) && !has(b)) return;
    rows.push({ label: w.label, a, b });
  });
  const mkeys = [];
  [...(r.machines || []), ...(h?.machines || [])].forEach((m) => { const k = machineKey(m); if (!mkeys.some((x) => x.k === k)) mkeys.push({ k, m }); });
  const mrows = mkeys.map(({ k, m }) => ({
    label: `${m.machine}${m.account && m.account !== 'الرصيد' ? ` · ${m.account}` : ''}`,
    a: (r.machines || []).find((x) => machineKey(x) === k)?.value,
    b: (h?.machines || []).find((x) => machineKey(x) === k)?.value,
  }));
  return { r, h, rows, mrows, has };
}

function ShiftCounts({ shift }) {
  const { r, h, rows, mrows, has } = countRows(shift);
  const cell = (v) => (has(v) ? `${fmt(v)} ج` : '—');
  const Table = ({ title, list }) => (
    <div className="stack" style={{ gap: 0 }}>
      <div className="spread" style={{ padding: '6px 0', borderBottom: '3px solid var(--blue)', gap: 10 }}>
        <strong style={{ flex: 1 }}>{title}</strong>
        <strong className="small" style={{ width: 96, textAlign: 'end' }}>استلمت</strong>
        <strong className="small" style={{ width: 96, textAlign: 'end' }}>سلّمت</strong>
      </div>
      {list.map((x) => (
        <div key={x.label} className="list-row" style={{ gap: 10 }}>
          <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{x.label}</strong>
            {x.note && <span className="tiny muted">{x.note}</span>}
          </span>
          <strong style={{ width: 96, textAlign: 'end', whiteSpace: 'nowrap' }}>{cell(x.a)}</strong>
          <strong style={{ width: 96, textAlign: 'end', whiteSpace: 'nowrap' }}>{h ? cell(x.b) : 'لسه'}</strong>
        </div>
      ))}
    </div>
  );
  const Bills = ({ title, bills }) => {
    const l = Object.entries(bills || {}).filter(([, n]) => num(n) > 0).sort((x, y) => Number(y[0]) - Number(x[0]));
    if (!l.length) return null;
    return (
      <div className="stack" style={{ gap: 4 }}>
        <span className="tiny muted" style={{ fontWeight: 700 }}>{title}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {l.map(([v, n]) => <span key={v} className="chip sm" style={{ cursor: 'default' }}>{v} × {num(n)}</span>)}
        </div>
      </div>
    );
  };
  return (
    <>
      <Table title="الفلوس والخزن" list={rows} />
      {mrows.length > 0 && <Table title="المكن" list={mrows} />}
      {(Object.keys(r.bills || {}).length > 0 || Object.keys(h?.bills || {}).length > 0) && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '6px 0' }}>فئات الفلوس في الدرج</summary>
          <div className="stack" style={{ gap: 10, paddingTop: 6 }}>
            <Bills title="وقت الاستلام" bills={r.bills} />
            <Bills title="وقت التسليم" bills={h?.bills} />
          </div>
        </details>
      )}
      {r.prevCashier && <span className="tiny muted">استلمت من: {r.prevCashier}</span>}
    </>
  );
}

// The whole shift as text, to send on WhatsApp or anywhere.
async function shareShift(shift, toast) {
  let entries = [];
  try {
    const q = await getDocs(query(collection(db, 'shifts', shift.id, 'entries'), orderBy('createdAt', 'asc')));
    entries = q.docs.map((d) => d.data()).filter((e) => !e.deleted);
  } catch { /* share what we have */ }
  let shopName = '';
  try { shopName = JSON.parse(localStorage.getItem('mdq-device-shop') || '{}').name || ''; } catch { /* ignore */ }
  const { h, rows, mrows, has } = countRows(shift);
  const c = (v) => (has(v) ? `${fmt(v)} ج` : '—');
  const L = [];
  L.push(`📋 وردية ${dateStr(shift.openedAt || shift.openedAtLocal)}${shopName ? ` · ${shopName}` : ''}${shift.registerName && shift.register !== 'main' ? ` · ${shift.registerName}` : ''}`);
  L.push(`الكاشير: ${shift.cashierName || ''} · ${timeStr(shift.openedAt || shift.openedAtLocal)} ← ${shift.submittedAt ? timeStr(shift.submittedAt) : '—'}`);
  const st = statusOf(shift);
  L.push(`الحالة: ${st.label}${shift.status === 'closed' && typeof shift.diff === 'number' ? ` · النتيجة: ${diffText(shift.diff)}` : ''}`);
  L.push('', '💵 الفلوس والخزن (استلمت ← سلّمت)');
  rows.forEach((x) => L.push(`• ${x.label}: ${c(x.a)} ← ${h ? c(x.b) : 'لسه'}${x.note ? ` (${x.note})` : ''}`));
  if (mrows.length) { L.push('', '🏧 المكن (استلمت ← سلّمت)'); mrows.forEach((x) => L.push(`• ${x.label}: ${c(x.a)} ← ${h ? c(x.b) : 'لسه'}`)); }
  const groups = [
    ['📤 المصروفات واللي طلع من الدرج', entries.filter((e) => entrySign(e) < 0)],
    ['📥 الإيرادات والتحويلات', entries.filter((e) => entrySign(e) > 0)],
    ['🔁 نقل وتسييل', entries.filter((e) => !entrySign(e))],
  ].filter(([, l]) => l.length);
  groups.forEach(([t, l]) => {
    L.push('', `${t} · ${fmt(l.reduce((a, e) => a + num(e.amount), 0))} ج`);
    l.forEach((e) => L.push(`- ${entryTitle(e)}: ${fmt(e.amount)} ج`));
  });
  if (!entries.length) L.push('', 'مفيش عمليات متسجلة');
  L.push('', '— من تطبيق مدقق للورديات');
  const text = L.join('\n');
  try {
    if (navigator.share) { await navigator.share({ title: 'تفاصيل الوردية', text }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('اتنسخت التفاصيل · الصقها في واتساب'); } catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); }
}

function ShiftOps({ shift, onClose }) {
  return (
    <Modal title={`عمليات ورديتك · ${dateStr(shift.openedAt || shift.openedAtLocal)}`} icon="eye" color="var(--blue)" onClose={onClose} width={620}>
      <span className="small muted">راجع كل اللي سجّلته في الوردية. لو في مصروف ناقص أو مبلغ غلط، ارجع ودوس «أضف مصروف نسيته».</span>
      <ShiftOpsList shift={shift} />
    </Modal>
  );
}

const BASE = {
  submitted: { label: 'اتسلّمت · مستنية المحاسب', cls: 'warn', text: 'الوردية وصلت للمحاسب وهيراجعها في أقرب وقت. لو في حاجة تقولها له، اكتبها في الشات تحت.' },
  reviewing: { label: 'المحاسب بيراجعها دلوقتي', cls: 'dark', text: 'المحاسب بدأ يراجع ورديتك. ممكن يسألك عن حاجة في الشات، فخلّي بالك.' },
  reopened: { label: 'المحاسب فتحها لك تعدّلها', cls: 'info', text: 'المحاسب محتاج منك تعديل في الوردية. دوس «عدّل الوردية»، وأول ما تخلّص هترجع له تاني.' },
  closed: { label: 'اتقفلت', cls: 'ok', text: 'المحاسب راجع الوردية وقفلها.' },
};

// One place that decides how a shift looks to the cashier (used by the follow page, the strip and the history).
export function statusOf(s) {
  const diff = typeof s.diff === 'number' ? s.diff : null;
  if (s.status === 'closed' && diff !== null && diff < 0 && s.shortageState === 'review') {
    return { key: 'shortage', label: 'عجز · محتاج ردّك', cls: 'bad', text: 'في عجز في ورديتك. راجع مصروفاتك وتسليمك: لو نسيت تسجّل مصروف أو في غلطة في الاستلام ابعتها للمحاسب، ولو مفيش عندك سبب أقرّ بالعجز وهيظهرلك الرقم.' };
  }
  if (s.status === 'disputed') return { key: 'disputed', label: 'طلبك عند المحاسب', cls: 'info', text: 'طلبك وصل للمحاسب وهيراجعه، وهيوصلك الرد هنا.' };
  if (s.status === 'closed' && s.shortageState === 'acked') return { key: 'acked', label: 'اتقفلت · أقررت بالعجز', cls: 'ok', text: 'أقررت بالعجز، ونتيجة الوردية اتسجّلت في سجلك.' };
  const b = BASE[s.status] || BASE.submitted;
  return { key: BASE[s.status] ? s.status : 'submitted', ...b };
}

const REQ_STATE = { pending: { label: 'مستني المحاسب', cls: 'warn' }, added: { label: 'اتنفّذ', cls: 'ok' }, done: { label: 'اتنفّذ', cls: 'ok' }, rejected: { label: 'اترفض', cls: 'bad' } };

export default function Follow({ shift, profile, onNew, onEdit, newLabel = 'ابدأ استلام جديد', canStartNew = true }) {
  const toast = useToast();
  const info = statusOf(shift);
  const raw = shift.status;
  const diff = typeof shift.diff === 'number' ? shift.diff : null;
  const closed = raw === 'closed';
  const needsReply = info.key === 'shortage';
  const reviewer = shift.closedBy || shift.reviewer || null;
  const requests = shift.cashierRequests || [];
  const [form, setForm] = useState(null); // 'expense' | 'receive'
  const [opsOpen, setOpsOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [expenseList, setExpenseList] = useState([]); // قايمة المصروفات المتعددة
  const [busy, setBusy] = useState(false);

  const steps = [
    { title: 'سلّمت', done: true, on: false },
    { title: 'المراجعة', done: closed, on: ['reviewing', 'reopened', 'disputed'].includes(raw) },
    { title: 'التقفيل', done: closed, on: false },
  ];

  const resultStyle = diff === null ? null
    : diff < 0 ? { background: 'var(--red-soft)', color: '#9B1C1C' }
      : diff > 0 ? { background: 'var(--lime-soft)', color: 'var(--lime-ink)' }
        : { background: 'var(--blue-soft)', color: '#144F86' };

  // دالة لإضافة مصروف للقائمة المحلية قبل الإرسال
  const addExpenseToList = () => {
    if (num(amount) <= 0) { toast('اكتب المبلغ', 'err'); return; }
    if (!note.trim()) { toast('اكتب المصروف ده إيه', 'err'); return; }
    setExpenseList([...expenseList, { amount: num(amount), note: note.trim() }]);
    setAmount('');
    setNote('');
  };

  const sendRequest = async () => {
    let reqsToAdd = [];
    if (form === 'expense') {
      const currentAmount = num(amount);
      const currentNote = note.trim();
      const list = [...expenseList];

      // لو الكاشير كتب حاجة ونسي يدوس "إضافة للقائمة"، بنضيفها تلقائي
      if (currentAmount > 0 && currentNote) {
        list.push({ amount: currentAmount, note: currentNote });
      }

      if (list.length === 0) {
        toast('اكتب المبلغ وسبب المصروف الأول', 'err'); return;
      }

      const at = new Date().toISOString();
      reqsToAdd = list.map(item => ({
        type: 'expense',
        amount: item.amount,
        note: item.note,
        state: 'pending',
        at
      }));

    } else {
      if (!note.trim()) { toast('اكتب إيه اللي محتاج يتعدّل', 'err'); return; }
      reqsToAdd = [{ type: 'receive', note: note.trim(), state: 'pending', at: new Date().toISOString() }];
    }

    setBusy(true);
    try {
      const at = new Date().toISOString();
      const newRequests = [...requests, ...reqsToAdd];

      let msgText = '';
      if (form === 'expense') {
        const totalAmt = reqsToAdd.reduce((sum, r) => sum + r.amount, 0);
        msgText = reqsToAdd.length === 1 
          ? `الكاشير بيطلب إضافة مصروف ${fmt(totalAmt)} ج · ${reqsToAdd[0].note}` 
          : `الكاشير بيطلب إضافة ${reqsToAdd.length} مصروفات بإجمالي ${fmt(totalAmt)} ج`;
      } else {
        msgText = `الكاشير بيطلب تعديل في الاستلام · ${note.trim()}`;
      }

      await updateDoc(doc(db, 'shifts', shift.id), {
        status: 'disputed', shortageState: 'disputed', cashierRequests: newRequests,
        staffUnread: true, cashierAttention: false,
        lastMsg: { text: msgText, side: 'cashier', byName: profile.name, at },
      });
      logAct('dispute', form === 'expense' ? `طلب إضافة ${reqsToAdd.length} مصروف على وردية فيها عجز` : 'طلب تعديل الاستلام على وردية فيها عجز', { shopId: shift.shopId, shiftId: shift.id });
      pushEvent({ type: 'dispute', shopId: shift.shopId, shiftId: shift.id, to: 'staff', title: `${profile.name} عنده طلب على الوردية`, body: msgText });
      toast('طلباتك اتبعتت للمحاسب');
      setForm(null); setAmount(''); setNote(''); setExpenseList([]);
    } catch (e) { console.error(e); toast('مش قادرين نبعت، اتأكد من النت', 'err'); }
    setBusy(false);
  };

  const acknowledge = async () => {
    if (!window.confirm('هتقر إن عليك عجز في الوردية دي، والنتيجة هتظهرلك وتتسجل في سجلك. متأكد؟')) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'shifts', shift.id), {
        shortageState: 'acked', shortageAck: true, shortageAckAt: new Date().toISOString(),
        cashierAttention: false, staffUnread: true,
        lastMsg: { text: 'الكاشير أقرّ بالعجز', side: 'cashier', byName: profile.name, at: new Date().toISOString() },
      });
      try { await updateDoc(doc(db, 'ledger', shift.id), { acknowledged: true, acknowledgedAt: serverTimestamp() }); } catch (e) { console.warn('ledger ack', e.code); }
      logAct('shortage_ack', 'أقرّ بالعجز في الوردية', { shopId: shift.shopId, shiftId: shift.id });
      pushEvent({ type: 'ack', shopId: shift.shopId, shiftId: shift.id, to: 'staff', title: `${profile.name} أقرّ بالعجز`, body: 'في الوردية اللي اتقفلت' });
      toast('اتسجّل إقرارك');
    } catch (e) { console.error(e); toast('مش قادرين نسجّل، اتأكد من النت', 'err'); }
    setBusy(false);
  };

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="title">أهلًا يا {firstName(profile.name)}</h1>
        <span className="sub">تابع حالة الوردية وكلّم المحاسب من هنا.</span>
      </div>

      <section className="card" style={{ gap: 14 }}>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="stack" style={{ gap: 2 }}>
            <strong style={{ fontSize: 20 }}>وردية {dateStr(shift.openedAt || shift.openedAtLocal)}{shift.registerName && shift.register !== 'main' ? ` · ${shift.registerName}` : ''}</strong>
            <span className="small muted">{timeStr(shift.openedAt || shift.openedAtLocal)} ← {shift.submittedAt ? timeStr(shift.submittedAt) : '—'} · {durationStr(shift.openedAt || shift.openedAtLocal, shift.submittedAt)}</span>
          </span>
          <span className={'badge ' + info.cls} style={{ fontSize: 15, padding: '8px 16px' }}>{info.label}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {steps.map((s, i) => (
            <span key={s.title} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? '1 1 0' : '0 0 auto' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, background: s.done ? 'var(--lime)' : s.on ? 'var(--blue)' : 'var(--chip)', color: s.on ? '#fff' : 'var(--ink)' }}>
                  {s.done ? <Icon d="check" size={16} stroke={3} /> : i + 1}
                </span>
                <span style={{ fontWeight: s.on || s.done ? 700 : 500, opacity: s.on || s.done ? 1 : 0.6 }}>{s.title}</span>
              </span>
              {i < steps.length - 1 && <span style={{ flex: 1, height: 3, borderRadius: 3, background: s.done ? 'var(--lime)' : 'var(--chip)' }} />}
            </span>
          ))}
        </div>

        <span style={{ lineHeight: 1.8 }}>{info.text}{raw === 'reopened' && shift.reopenNote ? <b> · {shift.reopenNote}</b> : null}</span>

        {closed && resultStyle && !needsReply && (
          <div style={{ ...resultStyle, borderRadius: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="small" style={{ fontWeight: 600 }}>نتيجة الوردية</span>
            <span style={{ fontSize: 26, fontWeight: 800 }}>{diffText(diff)}</span>
          </div>
        )}

        {needsReply && (
          <div className="stack" style={{ gap: 10, background: 'var(--red-soft)', borderRadius: 18, padding: 14 }}>
            <strong style={{ color: '#9B1C1C' }}>اختار إيه اللي يناسبك:</strong>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" onClick={() => setOpsOpen(true)}><Icon d="eye" size={16} />راجع ورديتك</button>
              <button type="button" className="btn soft sm" onClick={() => { setForm('expense'); setExpenseList([]); setAmount(''); setNote(''); }}><Icon d="plus" size={16} />أضف مصروف نسيته</button>
              <button type="button" className="btn soft sm" onClick={() => { setForm('receive'); setNote(''); }}><Icon d="undo" size={16} />اطلب تعديل في الاستلام</button>
              <button type="button" className="btn sm" style={{ background: '#E5484D' }} onClick={acknowledge} disabled={busy}>مفيش عندي سبب · أقرّ بالعجز</button>
            </div>
            <span className="tiny muted">الطلب بيروح للمحاسب، وهو اللي بيضيف أو يعدّل ويقفل الوردية تاني.</span>
          </div>
        )}

        {requests.length > 0 && (
          <div className="stack" style={{ gap: 0 }}>
            <span className="tiny muted" style={{ fontWeight: 700, paddingBottom: 4 }}>طلباتك للمحاسب</span>
            {requests.map((r, i) => {
              const st = REQ_STATE[r.state] || REQ_STATE.pending;
              return (
                <div key={i} className="list-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <span className="stack" style={{ gap: 1, flex: '1 1 220px' }}>
                    <strong>{r.type === 'expense' ? `مصروف نسيته · ${fmt(r.amount)} ج` : 'تعديل في الاستلام'}</strong>
                    <span className="tiny muted">{r.note}</span>
                  </span>
                  <span className={'badge ' + st.cls}>{st.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {(reviewer || shift.reviewStartedAt || shift.closedAt) && (
          <div className="stack" style={{ gap: 2 }}>
            {reviewer && <span className="small muted">المحاسب: <b>{reviewer}</b></span>}
            {shift.reviewStartedAt && <span className="small muted">بدأ المراجعة الساعة {timeStr(shift.reviewStartedAt)}</span>}
            {shift.closedAt && <span className="small muted">اتقفلت الساعة {timeStr(shift.closedAt)}</span>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {raw === 'reopened' && <button type="button" className="btn" onClick={onEdit}>عدّل الوردية</button>}
          <button type="button" className={'btn' + (closed && !needsReply ? '' : ' soft')} onClick={onNew} disabled={!canStartNew} style={!canStartNew ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>{newLabel}</button>
          {!canStartNew && <span className="tiny muted" style={{ alignSelf: 'center' }}>اختار واحد من الاختيارات اللي فوق الأول علشان تقدر تبدأ استلام جديد.</span>}
        </div>
      </section>

      <section className="card" style={{ gap: 10 }} data-tour="follow-ops">
        <div className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <h2 className="h2" style={{ flex: '1 1 200px' }}>📋 تفاصيل الوردية <span className="tiny muted" style={{ fontWeight: 500 }}>· استلمت إيه وسلّمت إيه وكل اللي سجّلته</span></h2>
          <button type="button" className="btn sm soft" style={{ height: 44 }} onClick={() => shareShift(shift, toast)}><Icon d="share" size={16} />شارك</button>
        </div>
        <ShiftCounts shift={shift} />
        <ShiftOpsList shift={shift} />
      </section>

      <section className="card" style={{ gap: 10 }}>
        <h2 className="h2">💬 شات المحاسب <span className="tiny muted" style={{ fontWeight: 500 }}>· بينك وبين {shift.reviewer || 'المحاسب'}</span></h2>
        <ShiftChat shift={shift} profile={profile} side="cashier" />
      </section>

      {opsOpen && <ShiftOps shift={shift} onClose={() => setOpsOpen(false)} />}
      {form && (
        <Modal title={form === 'expense' ? 'أضف مصروفات نسيتها' : 'اطلب تعديل في الاستلام'} icon={form === 'expense' ? "plus" : "undo"} color="var(--blue)" onClose={() => setForm(null)} width={460}>
          
          {form === 'expense' && expenseList.length > 0 && (
            <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
              <span className="small muted" style={{ fontWeight: 700 }}>المصروفات اللي هتتضاف ({expenseList.length}):</span>
              {expenseList.map((ex, idx) => (
                <div key={idx} className="spread" style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                  <span style={{ fontWeight: 600 }}>{ex.note}</span>
                  <strong style={{ color: 'var(--blue)' }}>{fmt(ex.amount)} ج</strong>
                </div>
              ))}
            </div>
          )}

          {form === 'expense' && (
            <div className="row" style={{ gap: 10 }}>
              <label className="field" style={{ flex: '1 1 120px' }}>
                المبلغ
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </label>
              <label className="field" style={{ flex: '1 1 200px' }}>
                المصروف ده إيه؟
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: مواصلات توريد" />
              </label>
            </div>
          )}

          {form === 'receive' && (
            <label className="field">إيه اللي محتاج يتعدّل؟ (اكتب الرقم الصح)
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: درج الاستلام كان أقل بـ 50" autoFocus />
            </label>
          )}

          {form === 'expense' ? (
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button type="button" className="btn soft" style={{ flex: 1 }} onClick={addExpenseToList}>
                <Icon d="plus" size={16} /> ضيف مصروف كمان
              </button>
              <button type="button" className="btn" style={{ flex: 1 }} onClick={sendRequest} disabled={busy || (expenseList.length === 0 && (!amount || !note))}>
                {busy ? 'لحظة…' : 'ابعت للمحاسب'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn full" style={{ marginTop: 12 }} onClick={sendRequest} disabled={busy}>
              {busy ? 'لحظة…' : 'ابعت للمحاسب'}
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}
