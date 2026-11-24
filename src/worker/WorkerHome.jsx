import { logout } from '../activity.js';
import { Avatar } from '../ui.jsx';

// شاشة العامل: من غير فلوس ولا ورديات. الجرد اليومي بتاعه هيتضاف هنا في الخطوة الجاية.
export default function WorkerHome({ profile }) {
  const quota = Number(profile.quota) || 0;
  return (
    <div className="login">
      <section className="login-main">
        <img className="logo-mdq" style={{ height: 72, alignSelf: 'flex-start' }} src="./modaqqeq-logo.png" alt="مدقق" />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card card-lg stack" style={{ alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <Avatar name={profile.name} photo={profile.photo} color={profile.color} size={72} />
            <h1 className="h2">أهلاً يا {profile.name}</h1>
            {profile.shopName && <span className="muted">{profile.shopName}</span>}
            {profile.canCount && quota > 0 ? (
              <span className="badge">حصتك في الجرد: {quota} صنف في اليوم</span>
            ) : null}
            <span className="muted small">الجرد اليومي هيظهر هنا قريب.</span>
            <button type="button" className="btn soft sm" onClick={() => logout()}>خروج</button>
          </div>
        </div>
      </section>
    </div>
  );
}
