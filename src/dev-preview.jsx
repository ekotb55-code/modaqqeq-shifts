import { createRoot } from 'react-dom/client';
import './index.css';
import { ToastProvider } from './ui.jsx';
import { Topbar } from './cashier/parts.jsx';
import Dash from './cashier/Dash.jsx';
import Receive from './cashier/Receive.jsx';
import Handover from './cashier/Handover.jsx';
import Statements from './staff/Statements.jsx';
import Login from './staff/StaffLogin.jsx';
import EntryModal from './cashier/EntryModal.jsx';
import { computeShift, shopForRegister } from './lib';
import { SendModal } from './cashier/Transfers.jsx';

const shop = { id: 's1', name: 'مخبوزات لوفان', posUrl: 'https://x', wallets: ['insta', 'vf'], machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', ratePct: 2 }, { machine: 'فوري', account: 'كاش أوت' }, { machine: 'فيزا', account: 'الرصيد' }],
  lastHandover: { cashierName: 'محمود سعيد', at: new Date().toISOString(), bills: { 200: 2, 100: 3, 50: 4, 20: 5, 10: 6, 5: 4, 1: 20 }, side: 5000, wallets: { insta: 300, vf: 0 }, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 3250 }] },
  customExpenseTypes: [{ id: 'a', label: 'سحب المالك', q: 'مين سحب؟', subs: ['أ. سامح', 'أ. هشام'] }, { id: 'b', label: 'باقي لعميل', q: '', subs: [], needNote: true }], hiddenExpenseTypes: ['wage'],
  shopExpenses: ['مياه', 'كهربا'], incomeReasons: ['سداد آجل'], staff: ['أحمد'], suppliers: ['مطاحن النيل'] };
const pub = { name: 'مخبوزات لوفان', logo: './levain-logo.png' };
const profile = { id: 'u1', name: 'شوقي محمد', color: '#A07CFF' };
const shift = { id: 'sh1', status: 'open', cashierName: 'شوقي محمد', openedAtLocal: new Date(Date.now() - 4 * 3600e3).toISOString(), receive: { drawerTotal: 1500, side: 5000, wallets: { insta: 300, vf: 0 }, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 3250 }, { machine: 'فوري', account: 'كاش أوت', value: 0 }, { machine: 'فيزا', account: 'الرصيد', value: 0 }], prevCashier: 'محمود سعيد' },
  handover: { drawerTotal: 2400, side: 2500, machines: [{ machine: 'فوري', account: 'الحساب الرئيسي', value: 2900 }, { machine: 'فوري', account: 'كاش أوت', value: 0 }, { machine: 'فيزا', account: 'الرصيد', value: 700 }] } };
const entries = [
  { id: 'e1', type: 'expense', src: 'side', amount: 2500, kindLabel: 'مورد', sub: 'مطاحن النيل', kind: 'supplier', invoice: 'invoice', createdAtLocal: new Date().toISOString() },
  { id: 'e2', type: 'transfer', wallet: 'insta', src: 'insta', amount: 240, createdAtLocal: new Date().toISOString() },
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
let body;
if (v === 'login') body = <Login />;
else if (v === 'ddash') body = <Dash shop={dshop} shift={dshift} entries={[{ id: 'x1', type: 'xfer_in', src: 'drawer', amount: 300, fromName: 'شوقي محمد (الكاشير الأساسي)', createdAtLocal: new Date().toISOString() }]} profile={{ ...profile, name: 'كريم الدليفري' }} onHandover={() => {}} onReceive={() => {}} />;
else if (v === 'dhand') body = <Handover shop={dshop} shift={dshift} entries={[]} profile={profile} onBack={() => {}} onDone={() => {}} />;
else if (v === 'send') body = <SendModal shop={shopForRegister(shop, 'main')} shift={shift} profile={profile} balances={{ side: 5000 }} onClose={() => {}} />;
else if (v === 'expense') body = <EntryModal type="expense" shop={shop} shift={shift} profile={profile} balances={{ side: 5000 }} onClose={() => {}} />;
else if (v === 'receive') body = <Receive shop={shop} profile={profile} onStarted={() => {}} />;
else if (v === 'handover') body = <Handover shop={shop} shift={{ ...shift, handover: null }} entries={entries} profile={profile} onBack={() => {}} onDone={() => {}} />;
else if (v === 'statements') body = <div className="wrap"><Statements c={computeShift(shift, entries, shop, 4000)} shift={shift} shop={shop} /></div>;
else body = <Dash shop={shop} shift={shift} entries={entries} incoming={v === 'inc' ? inc : []} deleted={[{ id: 'd1', type: 'expense', kind: 'delivery', kindLabel: 'قبض دليفري', sub: 'أحمد', src: 'drawer', amount: 50, deleted: true, deletedByName: 'شوقي محمد', deleteReason: 'اتسجلت مرتين', createdAtLocal: new Date().toISOString(), deletedAtLocal: Date.now() }]} profile={profile} onHandover={() => {}} onReceive={() => {}} />;
createRoot(document.getElementById('root')).render(<ToastProvider>{v !== 'login' && <Topbar shopPub={pub} profile={profile} steps={steps} onLogout={() => {}} posUrl={shop.posUrl} onPin={() => {}} onPhoto={() => {}} />}{body}</ToastProvider>);
