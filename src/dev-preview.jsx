import { createRoot } from 'react-dom/client';
import './index.css';
import { ToastProvider, ZoomImage, PhotoView } from './ui.jsx';
import { Topbar } from './cashier/parts.jsx';
import Dash from './cashier/Dash.jsx';
import Receive from './cashier/Receive.jsx';
import Handover from './cashier/Handover.jsx';
import Statements from './staff/Statements.jsx';
import Login from './staff/StaffLogin.jsx';
import EntryModal from './cashier/EntryModal.jsx';
import { computeShift, shopForRegister } from './lib';
import { SendModal } from './cashier/Transfers.jsx';
import { ShiftDetail } from './staff/Review.jsx';
import { ShopPicker, BranchChooser } from './staff/StaffApp.jsx';
import { AttentionBar } from './cashier/Attention.jsx';
import { NetStrip, Intro } from './theme.jsx';
import { captureDocument } from './DocCamera.jsx';
import ShiftChat from './ShiftChat.jsx';
import { TourHost } from './Tour.jsx';
import { NotifyBell, feed } from './notify.jsx';
window.__feed = feed;

const shop = { id: 's1', name: 'مخبوزات لوفان', posUrl: 'https://x', wallets: ['insta', 'vf'], walletModes: { insta: 'shop', vf: 'owner' }, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', ratePct: 2 }, { machine: 'فوري', account: 'كاش أوت' }, { machine: 'فيزا', account: 'الرصيد', ratePct: 2, rateFrom: 'cashier' }],
  lastHandover: { cashierName: 'محمود سعيد', at: new Date().toISOString(), bills: { 200: 2, 100: 3, 50: 4, 20: 5, 10: 6, 5: 4, 1: 20 }, side: 5000, wallets: { insta: 300, vf: 0 }, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 3250 }] },
  customExpenseTypes: [{ id: 'a', label: 'سحب المالك', q: 'مين سحب؟', subs: ['أ. سامح', 'أ. هشام'] }, { id: 'b', label: 'باقي لعميل', q: '', subs: [], needNote: true }], hiddenExpenseTypes: ['wage'],
  shopExpenses: ['مياه', 'كهربا'], incomeReasons: ['سداد آجل'], staff: ['أحمد'], suppliers: ['مطاحن النيل'] };
const pub = { name: 'مخبوزات لوفان', logo: './levain-logo.png' };
const profile = { id: 'u1', name: 'شوقي محمد', color: '#A07CFF' };
const shift = { id: 'sh1', status: 'open', cashierName: 'شوقي محمد', openedAtLocal: new Date(Date.now() - 4 * 3600e3).toISOString(), receive: { drawerTotal: 1500, side: 5000, wallets: { insta: 300, vf: 0 }, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 3250 }, { machine: 'فوري', account: 'كاش أوت', value: 0 }, { machine: 'فيزا', account: 'الرصيد', value: 0, ratePct: 2, rateFrom: 'cashier' }], prevCashier: 'محمود سعيد' },
  handover: { drawerTotal: 2400, side: 2500, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 2900 }, { machine: 'فوري', account: 'كاش أوت', value: 0 }, { machine: 'فيزا', account: 'الرصيد', value: 700 }] } };
const entries = [
  { id: 'e1', type: 'expense', src: 'side', amount: 2500, kindLabel: 'مورد', sub: 'مطاحن النيل', kind: 'supplier', invoice: 'invoice', createdAtLocal: new Date().toISOString() },
  { id: 'e2', type: 'transfer', wallet: 'vf', src: 'vf', amount: 240, createdAtLocal: new Date().toISOString() },
  { id: 'e3', type: 'liquidate', src: 'insta', to: 'out:owner', amount: 300, fromLabel: 'انستاباي', toLabel: 'صاحب المحل', createdAtLocal: new Date().toISOString() },
];
const v = new URLSearchParams(location.search).get('v') || 'dash';
const steps = [{ title: 'الاستلام', n: 1, state: 'done', go: () => {} }, { title: 'العمليات', n: 2, state: 'on' }, { title: 'التسليم', n: 3, state: '', go: () => {} }];
shop.registers = [{ id: 'r1', kind: 'delivery', name: 'درج الدليفري', active: true, hasSide: false, ops: false, wallets: [], machineIds: [] }, { id: 'r2', kind: 'sub', name: 'كاشير 2', active: true, hasSide: true, ops: true, wallets: ['insta'], machineIds: [] }];
shop.openShift = { id: 'sh1', cashierUid: 'u1', cashierName: 'شوقي محمد', openedAt: new Date().toISOString() };
shop.openShifts = { r1: { id: 'sh2', cashierUid: 'u2', cashierName: 'كريم الدليفري', openedAt: new Date().toISOString() } };
const dshop = shopForRegister(shop, 'r1');
const dshift = { ...shift, id: 'sh2', register: 'r1', registerName: 'درج الدليفري', receive: { drawerTotal: 300, side: 0, wallets: {}, machines: [] }, handover: null };
const inc = [{ id: 't1', fromName: 'كريم الدليفري', fromRegName: 'درج الدليفري', kind: 'handover', amount: 1850, createdAtLocal: new Date().toISOString() }];
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'mdq';
let body;
if (v === 'login') body = <Login />;
else if (v === 'bell') body = <div style={{ padding: 40, display: 'flex', justifyContent: 'flex-end' }}><NotifyBell uid="t1" onOpen={() => {}} alarmable /></div>;
else if (v === 'ddash') body = <Dash shop={dshop} shift={dshift} entries={[{ id: 'x1', type: 'xfer_in', src: 'drawer', amount: 300, fromName: 'شوقي محمد (الكاشير الأساسي)', createdAtLocal: new Date().toISOString() }]} profile={{ ...profile, name: 'كريم الدليفري' }} onHandover={() => {}} onReceive={() => {}} />;
else if (v === 'dhand') body = <Handover shop={dshop} shift={dshift} entries={[]} profile={profile} onBack={() => {}} onDone={() => {}} />;
else if (v === 'send') body = <SendModal shop={shopForRegister(shop, 'main')} shift={shift} profile={profile} balances={{ side: 5000 }} onClose={() => {}} />;
else if (v === 'expense') body = <EntryModal type="expense" shop={shop} shift={shift} profile={profile} balances={{ side: 5000 }} onClose={() => {}} />;
else if (v === 'receive') body = <Receive shop={shop} profile={profile} onStarted={() => {}} />;
else if (v === 'handover') body = <Handover shop={shop} shift={{ ...shift, handover: null }} entries={entries} profile={profile} onBack={() => {}} onDone={() => {}} />;
else if (v === 'review') body = <div className="wrap"><ShiftDetail shift={{ ...shift, status: 'submitted', shopId: 's1', handover: { ...(shift.handover || {}), keepDrawer: 'stay', drawerTotal: 2400, bills: { 200: 10, 100: 4 }, walletsTyped: { insta: 100 }, walletModes: { insta: 'shop', vf: 'owner' } } }} shop={shop} profile={{ ...profile, role: 'accountant' }} canReview /></div>;
else if (v === 'picker') body = <header className="topbar"><div className="topbar-in"><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><img className="logo-mdq" src="./modaqqeq-logo.png" alt="" /><ShopPicker shops={[{ id: 'a', name: 'فرع مايو', openShift: { cashierName: 'ابراهيم' } }, { id: 'b', name: 'الدواجن' }]} value={location.hash ? 'a' : null} onChange={() => {}} onNew={() => {}} /></div><nav className="tabs"><button className="on">الإعداد</button></nav><span /></div></header>;
else if (v === 'branch') body = <BranchChooser shops={[{ id: 'a', name: 'فرع مايو', openShift: { cashierName: 'ابراهيم' } }, { id: 'b', name: 'الدواجن' }]} onPick={() => {}} onNew={() => {}} />;
else if (v === 'attn') body = <><AttentionBar list={[{ id: 'x', status: 'reopened', openedAtLocal: new Date().toISOString(), reopenNote: 'سجّل مصروف المواصلات' }, { id: 'y', status: 'submitted', cashierUnread: true, openedAtLocal: new Date().toISOString(), lastMsg: { text: 'التحويل 67 صورته مش واضحة' } }]} onOpen={() => {}} /><div className="wrap"><section className="card"><ShiftChat shift={{ id: 'sh1' }} profile={profile} side="staff" /></section></div></>;
else if (v === 'intro') body = <Intro onDone={() => {}} />;
else if (v === 'cam') body = <div className="wrap"><button id="go" className="btn" onClick={async () => { const d = await captureDocument({ title: 'تجربة', kind: new URLSearchParams(location.search).get('kind') || 'paper' }); window.__shot = d; const i = document.createElement('img'); i.id = 'res'; i.src = d || ''; i.style.maxWidth = '300px'; document.body.appendChild(i); }}>صوّر</button></div>;
else if (v === 'zoom') body = <div className="wrap"><div style={{ width: 320 }}><ZoomImage src="./modaqqeq-logo.png" height={340} /></div><PhotoView src={location.hash ? './modaqqeq-logo.png' : null} onClose={() => {}} /></div>;
else if (v === 'statements') body = <div className="wrap"><Statements c={computeShift(shift, entries, shop, 4000)} shift={shift} shop={shop} /></div>;
else body = <Dash shop={shop} shift={shift} entries={entries} incoming={v === 'inc' ? inc : []} deleted={[{ id: 'd1', type: 'expense', kind: 'delivery', kindLabel: 'قبض دليفري', sub: 'أحمد', src: 'drawer', amount: 50, deleted: true, deletedByName: 'شوقي محمد', deleteReason: 'اتسجلت مرتين', createdAtLocal: new Date().toISOString(), deletedAtLocal: Date.now() }]} profile={profile} onHandover={() => {}} onReceive={() => {}} />;
createRoot(document.getElementById("root")).render(<ToastProvider><TourHost />{v !== 'login' && <NetStrip />}{v !== 'login' && <Topbar shopPub={pub} profile={profile} steps={steps} onLogout={() => {}} posUrl={shop.posUrl} onPin={() => {}} onPhoto={() => {}} onTheme={() => {}} />}{body}</ToastProvider>);
