import { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Icon, Modal, useToast } from '../ui.jsx';
import ShiftChat from '../ShiftChat.jsx';
import { dateStr, diffText, durationStr, firstName, fmt, num, timeStr } from '../lib';
import { logAct } from '../activity.js';

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

export default function Follow({ shift, profile, onNew, onEdit, newLabel = 'ابدأ استلام جديد' }) {
  const toast = useToast();
  const info = statusOf(shift);
  const raw = shift.status;
  const diff = typeof shift.diff === 'number' ? shift.diff : null;
  const closed = raw === 'closed';
  const needsReply = info.key === 'shortage';
  const reviewer = shift.closedBy || shift.reviewer || null;
  const requests = shift.cashierRequests || [];
  const [form, setForm] = useState(null); // 'expense' | 'receive'
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
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

  const sendRequest = async () => {
    if (form === 'expense' && num(amount) <= 0) { toast('اكتب المبلغ', 'err'); return; }
    if (!note.trim()) { toast(form === 'expense' ? 'اكتب المصروف ده إيه' : 'اكتب إيه اللي محتاج يتعدّل', 'err'); return; }
    setBusy(true);
    try {
      const at = new Date().toISOString();
      const req = { type: form, ...(form === 'expense' ? { amount: num(amount) } : {}), note: note.trim(), state: 'pending', at };
      await updateDoc(doc(db, 'shifts', shift.id), {
        status: 'disputed', shortageState: 'disputed', cashierRequests: [...requests, req],
        staffUnread: true, cashierAttention: false,
        lastMsg: { text: form === 'expense' ? `الكاشير بيطلب إضافة مصروف ${fmt(num(amount))} ج · ${note.trim()}` : `الكاشير بيطلب تعديل في الاستلام · ${note.trim()}`, side: 'cashier', byName: profile.name, at },
      });
      logAct('dispute', form === 'expense' ? `طلب إضافة مصروف ${fmt(num(amount))} ج على وردية فيها عجز` : 'طلب تعديل الاستلام على وردية فيها عجز', { shopId: shift.shopId, shiftId: shift.id });
      toast('طلبك اتبعت للمحاسب');
      setForm(null); setAmount(''); setNote('');
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
              <button type="button" className="btn soft sm" onClick={() => setForm('expense')}><Icon d="plus" size={16} />أضف مصروف نسيته</button>
              <button type="button" className="btn soft sm" onClick={() => setForm('receive')}><Icon d="undo" size={16} />اطلب تعديل في الاستلام</button>
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
          <button type="button" className={'btn' + (closed && !needsReply ? '' : ' soft')} onClick={onNew}>{newLabel}</button>
        </div>
      </section>

      <section className="card" style={{ gap: 10 }}>
        <h2 className="h2">💬 شات المحاسب <span className="tiny muted" style={{ fontWeight: 500 }}>· بينك وبين {shift.reviewer || 'المحاسب'}</span></h2>
        <ShiftChat shift={shift} profile={profile} side="cashier" />
      </section>

      {form && (
        <Modal title={form === 'expense' ? 'أضف مصروف نسيته' : 'اطلب تعديل في الاستلام'} icon="plus" color="var(--blue)" onClose={() => setForm(null)} width={460}>
          {form === 'expense' && <label className="field">المبلغ<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>}
          <label className="field">{form === 'expense' ? 'المصروف ده إيه؟' : 'إيه اللي محتاج يتعدّل؟ (اكتب الرقم الصح)'}
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={form === 'expense' ? 'مثلًا: مواصلات توريد' : 'مثلًا: درج الاستلام كان أقل بـ 50'} />
          </label>
          <button type="button" className="btn full" onClick={sendRequest} disabled={busy}>{busy ? 'لحظة…' : 'ابعت للمحاسب'}</button>
        </Modal>
      )}
    </div>
  );
}
