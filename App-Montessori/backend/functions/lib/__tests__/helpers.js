"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.db = exports.addDay = exports.today = exports.op = void 0;
exports.makeUser = makeUser;
exports.call = call;
exports.callFail = callFail;
exports.buildWorld = buildWorld;
require("./env");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const firebase_1 = require("../core/firebase");
Object.defineProperty(exports, "auth", { enumerable: true, get: function () { return firebase_1.auth; } });
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return firebase_1.db; } });
const router_1 = require("../core/router");
const modules_1 = require("../modules");
const handle = (0, router_1.createRouter)(modules_1.actions);
async function makeUser(label, opts = {}) {
    const email = `${label}.${(0, node_crypto_1.randomUUID)().slice(0, 8)}@test.local`;
    const u = await firebase_1.auth.createUser({ email, emailVerified: opts.emailVerified ?? true, displayName: label, password: 'Montessori@123', ...(opts.phone ? { phoneNumber: opts.phone } : {}) });
    return { uid: u.uid, email, token: { email, email_verified: true, name: label, ...(opts.phone ? { phone_number: opts.phone } : {}) } };
}
async function call(who, action, body = {}) {
    const res = await handle({ auth: { uid: who.uid, token: who.token }, data: { action, ...body } });
    return res.data;
}
/** Gọi và mong đợi lỗi; trả details của HttpsError. */
async function callFail(who, action, body = {}) {
    try {
        await call(who, action, body);
    }
    catch (e) {
        strict_1.default.ok(e && e.httpErrorCode, `Lỗi không chuẩn hóa: ${String(e?.stack ?? e)}`);
        return { code: e.details?.code ?? e.code, message: e.message, details: e.details };
    }
    strict_1.default.fail(`Action ${action} lẽ ra phải bị từ chối`);
}
const op = () => (0, node_crypto_1.randomUUID)();
exports.op = op;
async function inviteAndClaim(owner, orgId, user, name, grants) {
    await call(owner, 'member.invite', { orgId, payload: { kind: 'staff', email: user.email, displayName: name, grants } });
    const r = await call(user, 'invite.claimPending');
    strict_1.default.equal(r.joined.length, 1, `claim ${name}`);
}
async function buildWorld() {
    const owner = await makeUser('owner');
    const created = await call(owner, 'org.create', { payload: { name: `Mầm non Test ${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, ownerCampus: { code: 'CG', name: 'Cầu Giấy', address: 'Hà Nội' } } });
    const orgId = created.orgId;
    const tx = await call(owner, 'campus.create', { orgId, payload: { code: 'TX', name: 'Thanh Xuân', address: 'Hà Nội', phone: '0900000000' } });
    const CG = 'CG';
    const TX = tx.campus.id;
    const mk = async (campusId, code, name, capacity) => (await call(owner, 'entity.save', { orgId, payload: { collection: 'classes', data: { campusId, code, name, capacity } } })).id;
    const mam1 = await mk(CG, 'M1', 'Mầm 1', 2);
    const choi2 = await mk(CG, 'C2', 'Chồi 2', 20);
    const tx1 = await mk(TX, 'TX1', 'Lá 1 TX', 20);
    const [principalCG, principalTX, lan, mai, hoa] = await Promise.all(['huong', 'tam', 'lan', 'mai', 'hoa'].map((n) => makeUser(n)));
    await inviteAndClaim(owner, orgId, principalCG, 'Cô Hương', [{ roleId: 'principal', campusIds: [CG] }]);
    await inviteAndClaim(owner, orgId, principalTX, 'Cô Tâm', [{ roleId: 'principal', campusIds: [TX] }]);
    await inviteAndClaim(owner, orgId, lan, 'Cô Lan', [{ roleId: 'teacher', campusIds: [CG], classIds: [mam1] }]);
    await inviteAndClaim(owner, orgId, mai, 'Cô Mai', [{ roleId: 'teacher', campusIds: [CG], classIds: [mam1] }]);
    await inviteAndClaim(owner, orgId, hoa, 'Cô Hoa', [{ roleId: 'teacher', campusIds: [TX], classIds: [tx1] }]);
    const linh = await makeUser('linh', { phone: '+84912000111' });
    const thuy = await makeUser('thuy', { phone: '+84912000222' });
    const guardian = (name, phone) => [{ name, phone, relation: 'mother', perms: { notify: true, viewFees: true, pickup: true } }];
    const an = await call(owner, 'lead.enroll', { orgId, opId: (0, exports.op)(), payload: { classId: mam1, startDate: (0, exports.today)(), child: { fullName: 'Nguyễn Minh An', dob: '2023-05-12', photoConsent: true }, guardians: guardian('Nguyễn Thùy Linh', '0912000111') } });
    const an2 = await call(owner, 'lead.enroll', { orgId, opId: (0, exports.op)(), payload: { classId: mam1, startDate: (0, exports.today)(), child: { fullName: 'Nguyễn Gia Bình', dob: '2023-07-01' }, guardians: [] } });
    const binh = await call(owner, 'lead.enroll', { orgId, opId: (0, exports.op)(), payload: { classId: tx1, startDate: (0, exports.today)(), child: { fullName: 'Trần Bảo Châu', dob: '2023-03-03' }, guardians: guardian('Trần Thu Thủy', '0912000222') } });
    strict_1.default.equal(an.status, 'enrolled');
    strict_1.default.equal((await call(linh, 'invite.claimPending')).joined.length, 1);
    strict_1.default.equal((await call(thuy, 'invite.claimPending')).joined.length, 1);
    return { orgId, owner, principalCG, principalTX, lan, mai, hoa, linh, thuy, CG, TX, mam1, choi2, tx1, childAn: an.childId, childAn2: an2.childId, childBinh: binh.childId };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
exports.today = today;
const addDay = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
exports.addDay = addDay;
