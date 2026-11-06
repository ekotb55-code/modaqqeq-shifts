import { Icon } from '../ui.jsx';
import ShiftChat from '../ShiftChat.jsx';
import { dateStr, diffText, durationStr, firstName, fmt, timeStr } from '../lib';

const INFO = {
  submitted: { label: 'اتسلّمت · مستنية المحاسب', cls: 'warn', text: 'الوردية وصلت للمحاسب وهيراجعها في أقرب وقت. لو في حاجة تقولها له، اكتبها في الشات تحت.' },
  reviewing: { label: 'المحاسب بيراجعها دلوقتي', cls: 'dark', text: 'المحاسب بدأ يراجع ورديتك. ممكن يسألك عن حاجة في الشات، فخلّي بالك.' },
  reopened: { label: 'المحاسب فتحها لك تعدّلها', cls: 'info', text: 'المحاسب محتاج منك تعديل في الوردية. دوس «عدّل الوردية»، وأول ما تخلّص هترجع له تاني.' },
  closed: { label: 'اتقفلت', cls: 'ok', text: 'المحاسب راجع الوردية وقفلها.' },
};

export default function Follow({ shift, profile, onNew, onEdit }) {
  const status = INFO[shift.status] ? shift.status : 'submitted';
  const info = INFO[status];
  const diff = typeof shift.diff === 'number' ? shift.diff : null;
  const closed = status === 'closed';
  const reviewer = shift.closedBy || shift.reviewer || null;

  const steps = [
    { title: 'سلّمت', done: true, on: false },
    { title: 'المراجعة', done: status === 'closed', on: status === 'reviewing' || status === 'reopened' },
    { title: 'التقفيل', done: closed, on: false },
  ];

  const resultStyle = diff === null ? null
    : diff < 0 ? { background: 'var(--red-soft)', color: '#9B1C1C' }
      : diff > 0 ? { background: 'var(--lime-soft)', color: 'var(--lime-ink)' }
        : { background: 'var(--blue-soft)', color: '#144F86' };

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="title">أهلًا يا {firstName(profile.name)}</h1>
        <span className="sub">دي آخر وردية سلّمتها. تابع حالتها وكلّم المحاسب من هنا.</span>
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

        <span style={{ lineHeight: 1.8 }}>{info.text}{status === 'reopened' && shift.reopenNote ? <b> · {shift.reopenNote}</b> : null}</span>

        {closed && resultStyle && (
          <div style={{ ...resultStyle, borderRadius: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="small" style={{ fontWeight: 600 }}>نتيجة الوردية</span>
            <span style={{ fontSize: 26, fontWeight: 800 }}>{diffText(diff)}</span>
          </div>
        )}

        {(reviewer || shift.reviewStartedAt || shift.closedAt) && (
          <div className="stack" style={{ gap: 2 }}>
            {reviewer && <span className="small muted">المحاسب: <b>{reviewer}</b></span>}
            {shift.reviewStartedAt && <span className="small muted">بدأ المراجعة الساعة {timeStr(shift.reviewStartedAt)}</span>}
            {shift.closedAt && <span className="small muted">اتقفلت الساعة {timeStr(shift.closedAt)}</span>}
            {typeof shift.receive?.drawerTotal === 'number' && <span className="small muted">درج الاستلام: {fmt(shift.receive.drawerTotal)} ج</span>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {status === 'reopened' && <button type="button" className="btn" onClick={onEdit}>عدّل الوردية</button>}
          <button type="button" className={'btn' + (closed ? '' : ' soft')} onClick={onNew}>ابدأ استلام جديد</button>
        </div>
      </section>

      <section className="card" style={{ gap: 10 }}>
        <h2 className="h2">💬 شات المحاسب <span className="tiny muted" style={{ fontWeight: 500 }}>· بينك وبين {shift.reviewer || 'المحاسب'}</span></h2>
        <ShiftChat shift={shift} profile={profile} side="cashier" />
      </section>
    </div>
  );
}
