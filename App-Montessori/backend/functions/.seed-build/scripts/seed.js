"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Seed dữ liệu mẫu (CONTRACT §10). Idempotent: id cố định, chạy lại sẽ ghi đè đúng các tài liệu mẫu.
 *
 * Chạy với emulator (khuyến nghị):
 *   firebase emulators:start --only auth,firestore        (ở thư mục backend/)
 *   npm --prefix functions run seed                       (biến môi trường FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST tự gán nếu chưa có)
 * Chạy với dự án thật (cần ADC/service account, có thể GHI vào dữ liệu thật):
 *   SEED_LIVE=1 GOOGLE_APPLICATION_CREDENTIALS=... npm --prefix functions run seed
 *
 * Tài khoản dev dùng chung mật khẩu `Montessori@123` (CHỈ để phát triển; không dùng trên môi trường thật).
 */
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const permissions_1 = require("../functions/src/core/permissions");
const PROJECT = process.env.GCLOUD_PROJECT || 'app-montessori-36ec6';
const LIVE = process.env.SEED_LIVE === '1';
if (!LIVE) {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}
else if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('SEED_LIVE=1 nhưng đang có FIRESTORE_EMULATOR_HOST. Bỏ biến emulator hoặc bỏ SEED_LIVE.');
}
process.env.GCLOUD_PROJECT = PROJECT;
if ((0, app_1.getApps)().length === 0)
    (0, app_1.initializeApp)({ projectId: PROJECT });
const db = (0, firestore_1.getFirestore)();
db.settings({ ignoreUndefinedProperties: true });
const auth = (0, auth_1.getAuth)();
const PASSWORD = 'Montessori@123';
const ORG = 'hoasen';
const DOMAIN = 'hoasen.test';
const TZ = 'Asia/Ho_Chi_Minh';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (day, hhmm) => firestore_1.Timestamp.fromDate(new Date(`${day}T${hhmm}:00+07:00`));
const now = firestore_1.Timestamp.now();
const TODAY = dayKey(new Date());
const SEED_BY = 'seed';
const meta = (extra = {}) => ({ createdAt: now, updatedAt: now, createdBy: SEED_BY, updatedBy: SEED_BY, version: 1, ...extra });
const ref = (p) => db.doc(`orgs/${ORG}/${p}`);
const shortHash = (v, n = 20) => (0, node_crypto_1.createHash)('sha1').update(v).digest('hex').slice(0, n); // khớp people.ts
const linkId = (childId, phone) => `${childId}_${shortHash(phone)}`;
const writes = [];
const put = (path, data) => writes.push({ path: `orgs/${ORG}/${path}`, data: { ...data } });
async function ensureUser(key, name, phone) {
    const uid = `seed-${key}`;
    const email = `${key}@${DOMAIN}`;
    const props = { email, emailVerified: true, displayName: name, password: PASSWORD, ...(phone ? { phoneNumber: phone } : {}) };
    try {
        await auth.getUser(uid);
        await auth.updateUser(uid, props);
    }
    catch (e) {
        if (e?.code !== 'auth/user-not-found')
            throw e;
        await auth.createUser({ uid, ...props });
    }
    return { uid, email, name, phone: phone ?? '' };
}
async function main() {
    console.log(`Seed → ${LIVE ? 'DỰ ÁN THẬT' : 'emulator'} (project ${PROJECT})`);
    // ---------------------------------------------------------------- tài khoản
    const owner = await ensureUser('owner', 'Chủ chuỗi Hoa Sen');
    const huong = await ensureUser('hieutruong.huong', 'Cô Hương (Hiệu trưởng CG)');
    const lan = await ensureUser('giaovien.lan', 'Cô Lan (Giáo viên Mầm 1)');
    const minh = await ensureUser('ketoan.minh', 'Kế toán Minh');
    const linh = await ensureUser('phuhuynh.linh', 'Nguyễn Thùy Linh', '+84912345678');
    const nam = await ensureUser('phuhuynh.nam', 'Nguyễn Văn Nam', '+84987654321');
    // ---------------------------------------------------------------- tổ chức, cơ sở
    writes.push({ path: `orgs/${ORG}`, data: { name: 'Hệ thống Mầm non Hoa Sen', status: 'active', ownerUid: owner.uid, plan: 'trial', timezone: TZ, currency: 'VND', ...meta() } });
    const campus = (code, name, address, phone) => ({
        code, name, address, phone, timezone: TZ, openTime: '07:00', closeTime: '17:30', mealCutoff: '08:30', status: 'active', archived: false, ...meta(),
    });
    put('campuses/CG', campus('CG', 'Trường Mầm non Cầu Giấy', '12 Trần Thái Tông, Cầu Giấy, Hà Nội', '02437000001'));
    put('campuses/TX', campus('TX', 'Trường Mầm non Thanh Xuân', '88 Nguyễn Trãi, Thanh Xuân, Hà Nội', '02437000002'));
    for (const c of ['CG', 'TX']) {
        put(`academicYears/ay_${c}_2026`, { campusId: c, code: '2026-2027', name: 'Năm học 2026-2027', startDate: '2026-09-01', endDate: '2027-05-31', current: true, status: 'active', teachingDays: [1, 2, 3, 4, 5], archived: false, ...meta() });
        put(`calendarExceptions/cal_${c}_quockhanh`, { campusId: c, name: 'Quốc khánh', type: 'holiday', fromDay: '2026-09-02', toDay: '2026-09-02', archived: false, ...meta() });
        for (const [code, name] of [['sick', 'Con ốm'], ['family', 'Việc gia đình'], ['travel', 'Về quê / đi xa']]) {
            put(`categories/cat_${c}_abs_${code}`, { campusId: c, type: 'absence_reason', code, name, sort: 1, active: true, archived: false, ...meta() });
        }
    }
    // ---------------------------------------------------------------- lớp
    const cls = (id, campusId, code, name, room, capacity, minM, maxM, enrolled) => put(`classes/${id}`, { campusId, code, name, room, capacity, ageGroup: `${Math.floor(minM / 12)}-${Math.ceil(maxM / 12)} tuổi`, minAgeMonths: minM, maxAgeMonths: maxM, academicYearId: `ay_${campusId}_2026`, status: 'active', enrolledCount: enrolled, archived: false, ...meta() });
    cls('cls_mam1', 'CG', 'M1', 'Mầm 1', 'P.101', 20, 24, 42, 3);
    cls('cls_choi2', 'CG', 'C2', 'Chồi 2', 'P.102', 25, 42, 60, 2);
    cls('cls_tx_la1', 'TX', 'L1', 'Lá 1', 'P.201', 25, 54, 72, 1);
    const kids = [
        { id: 'child_mn001', code: 'MN001', name: 'Nguyễn Minh An', dob: '2023-05-12', campus: 'CG', cls: 'cls_mam1', consent: true },
        { id: 'child_mn002', code: 'MN002', name: 'Nguyễn Gia Bình', dob: '2022-09-20', campus: 'CG', cls: 'cls_choi2', consent: true },
        { id: 'child_mn003', code: 'MN003', name: 'Trần Bảo Châu', dob: '2023-03-03', campus: 'CG', cls: 'cls_mam1', consent: false },
        { id: 'child_mn004', code: 'MN004', name: 'Lê Hoàng Dũng', dob: '2023-08-18', campus: 'CG', cls: 'cls_mam1', consent: true },
        { id: 'child_mn005', code: 'MN005', name: 'Phạm Khánh Hà', dob: '2022-11-05', campus: 'CG', cls: 'cls_choi2', consent: true },
        { id: 'child_mn006', code: 'MN006', name: 'Vũ Đức Khôi', dob: '2021-12-12', campus: 'TX', cls: 'cls_tx_la1', consent: true },
    ];
    for (const k of kids) {
        put(`children/${k.id}`, { code: k.code, fullName: k.name, dob: k.dob, gender: 'other', campusId: k.campus, classId: k.cls, status: 'active', enrolledAt: '2026-09-01', photoConsent: k.consent, archived: false, ...meta() });
        put(`childCodes/${k.code}`, { childId: k.id, campusId: k.campus, createdAt: now });
        put(`enrollments/enr_${k.id}`, { childId: k.id, classId: k.cls, campusId: k.campus, startDate: '2026-09-01', endDate: null, status: 'active', source: 'enroll', ...meta() });
    }
    put('counters/childCode', { value: 6, updatedAt: now });
    put('children/child_mn001/private/health', { childId: 'child_mn001', campusId: 'CG', allergies: ['Tôm cua'], conditions: [], dietNote: 'Không ăn hải sản có vỏ', bloodType: 'O', ...meta() });
    put('healthRecords/hr_mn001_1', { childId: 'child_mn001', campusId: 'CG', heightCm: 92.5, weightKg: 13.2, bmi: 15.4, measuredOn: addDays(TODAY, -20), note: 'Khám định kỳ', recordedBy: huong.uid, ...meta() });
    // ---------------------------------------------------------------- phân công giáo viên
    put('assignments/asg_lan_mam1', { classId: 'cls_mam1', campusId: 'CG', uid: lan.uid, role: 'main', validFrom: at('2026-09-01', '00:00'), validTo: null, status: 'active', teacherName: lan.name, ...meta() });
    // ---------------------------------------------------------------- phụ huynh, người giám hộ, người đón
    const perms = { notify: true, viewFees: true, pickup: true };
    const guardians = [
        { u: linh, relation: 'mother', phone: '+84912345678' },
        { u: nam, relation: 'father', phone: '+84987654321' },
    ];
    for (const k of kids.filter((x) => x.id === 'child_mn001' || x.id === 'child_mn002')) {
        for (const g of guardians) {
            const lid = linkId(k.id, g.phone);
            put(`guardianLinks/${lid}`, { childId: k.id, campusId: k.campus, name: g.u.name, phone: g.phone, email: g.u.email, relation: g.relation, uid: g.u.uid, status: 'linked', perms, inviteId: null, linkedAt: now, ...meta() });
            put(`pickupAuthorizations/pa_${lid}`, { childId: k.id, campusId: k.campus, personName: g.u.name, phone: g.phone, relation: g.relation, type: 'guardian', guardianLinkId: lid, status: 'approved', validFrom: '2026-09-01', validTo: null, ...meta() });
        }
    }
    put('pickupAuthorizations/pa_seed_baongoai', { childId: 'child_mn001', campusId: 'CG', personName: 'Bà Nguyễn Thị Hoa (bà ngoại)', phone: '+84901112233', relation: 'grandmother', type: 'delegate', status: 'approved', validFrom: TODAY, validTo: addDays(TODAY, 30), idNumberLast4: '4321', requestedBy: linh.uid, approvedBy: huong.uid, ...meta() });
    // ---------------------------------------------------------------- thành viên + quyền
    const campusIds = ['CG', 'TX'];
    const member = (u, kind, grants, extra = {}) => {
        const g = kind === 'owner' ? [{ id: 'owner', roleId: 'owner', campusIds: ['*'] }] : grants;
        const permsByCampus = (0, permissions_1.computePermsByCampus)(g, {}, new Date(), campusIds);
        put(`members/${u.uid}`, {
            uid: u.uid, displayName: u.name, email: u.email, phone: u.phone, kind, status: 'active', grants: g, childIds: [], childPerms: {}, permsByCampus,
            permsAny: [...new Set(Object.values(permsByCampus).flat())].sort(), ...extra, ...meta(),
        });
        writes.push({ path: `users/${u.uid}`, data: { uid: u.uid, displayName: u.name, email: u.email, phone: u.phone, locale: 'vi', createdAt: now, updatedAt: now } });
    };
    member(owner, 'owner', []);
    member(huong, 'staff', [{ id: 'g_principal_cg', roleId: 'principal', campusIds: ['CG'] }]);
    member(lan, 'staff', [{ id: 'g_teacher_lan', roleId: 'teacher', campusIds: ['CG'], classIds: ['cls_mam1'] }]);
    member(minh, 'staff', [{ id: 'g_acc_minh', roleId: 'accountant', campusIds: ['CG', 'TX'] }]);
    const childPerms = { child_mn001: perms, child_mn002: perms };
    member(linh, 'parent', [], { childIds: ['child_mn001', 'child_mn002'], childPerms });
    member(nam, 'parent', [], { childIds: ['child_mn001', 'child_mn002'], childPerms });
    // ---------------------------------------------------------------- điểm danh (4 ngày gần nhất) + bàn giao hôm nay
    const cgKids = kids.filter((k) => k.campus === 'CG');
    for (let i = 4; i >= 1; i--) {
        const d = addDays(TODAY, -i);
        for (const k of cgKids) {
            const absent = k.id === 'child_mn004' && i === 1;
            put(`attendance/${k.id}_${d}_all`, {
                childId: k.id, classId: k.cls, campusId: 'CG', dayKey: d, session: 'all', status: absent ? 'absent_excused' : 'present',
                arrivedAt: absent ? null : at(d, '07:50'), droppedBy: absent ? null : 'Phụ huynh', note: null, healthNote: null, closed: true, markedBy: lan.uid, markedByName: lan.name, markedAt: at(d, '08:10'), ...meta(),
            });
        }
        for (const c of ['cls_mam1', 'cls_choi2'])
            put(`attendanceClosures/${c}_${d}`, { classId: c, campusId: 'CG', dayKey: d, closedBy: lan.uid, closedAt: at(d, '16:30'), total: cgKids.filter((k) => k.cls === c).length, unconfirmed: 0, ...meta() });
    }
    for (const id of ['child_mn001', 'child_mn003']) {
        const k = kids.find((x) => x.id === id);
        put(`attendance/${id}_${TODAY}_all`, { childId: id, classId: k.cls, campusId: 'CG', dayKey: TODAY, session: 'all', status: 'present', arrivedAt: at(TODAY, '07:45'), droppedBy: 'Mẹ', note: null, healthNote: null, closed: false, markedBy: lan.uid, markedByName: lan.name, markedAt: at(TODAY, '07:46'), source: 'handover', ...meta() });
        put(`handovers/${id}_${TODAY}`, { childId: id, classId: k.cls, campusId: 'CG', dayKey: TODAY, state: 'received', receivedAt: at(TODAY, '07:45'), receivedBy: lan.uid, receivedByName: lan.name, droppedBy: 'Mẹ', pickedAt: null, pickedBy: null, ...meta() });
    }
    // ---------------------------------------------------------------- nhật ký, đơn nghỉ, thuốc, sự cố
    for (const d of [addDays(TODAY, -1), TODAY]) {
        put(`dailyLogs/child_mn001_${d}`, {
            childId: 'child_mn001', classId: 'cls_mam1', campusId: 'CG', dayKey: d, status: 'published', revision: 1,
            meals: [{ slot: 'lunch', amount: 'most', note: 'Ăn hết cơm, bỏ rau' }, { slot: 'snack', amount: 'all' }], sleep: [{ from: '12:15', to: '14:00' }],
            hygiene: { toilet: 3, note: 'Bình thường' }, mood: 'vui', activities: ['Vẽ tranh', 'Hát múa'], note: 'Bé hợp tác tốt, chơi vui cùng các bạn.', photoPaths: [],
            authorUid: lan.uid, authorName: lan.name, publishedAt: at(d, '16:00'), publishedBy: huong.uid, ...meta(),
        });
    }
    put(`dailyLogs/child_mn003_${TODAY}`, { childId: 'child_mn003', classId: 'cls_mam1', campusId: 'CG', dayKey: TODAY, status: 'draft', revision: 1, meals: [], sleep: [], hygiene: {}, mood: '', activities: [], note: 'Nháp: chưa hoàn thiện', photoPaths: [], authorUid: lan.uid, ...meta() });
    put('leaveRequests/lv_seed_binh', { childId: 'child_mn002', classId: 'cls_choi2', campusId: 'CG', fromDay: addDays(TODAY, 1), toDay: addDays(TODAY, 1), session: 'all', reasonId: 'sick', note: 'Bé sốt nhẹ', status: 'pending', submittedAt: now, submittedBy: linh.uid, submittedByName: linh.name, mealCancelled: null, mealCancelledDays: [], ...meta() });
    put('medicationRequests/med_seed_an', { childId: 'child_mn001', classId: 'cls_mam1', campusId: 'CG', medicineName: 'Hạ sốt Efferalgan', dose: '5ml', times: ['10:30'], fromDay: TODAY, toDay: addDays(TODAY, 2), instructions: 'Uống sau ăn, chỉ khi sốt trên 38.5°C', reason: 'Sốt', status: 'pending', requestedBy: linh.uid, requestedByName: linh.name, ...meta() });
    put('incidents/inc_seed_1', { childId: 'child_mn004', classId: 'cls_mam1', campusId: 'CG', occurredAt: at(addDays(TODAY, -2), '10:20'), type: 'Té ngã nhẹ', severity: 'minor', location: 'Sân chơi', description: 'Bé vấp ngã khi chạy, trầy nhẹ đầu gối.', firstAid: 'Rửa vết thương, sát khuẩn.', contactedPersons: [{ name: 'Mẹ bé', at: at(addDays(TODAY, -2), '10:30'), method: 'phone_call' }], outcome: '', status: 'open', restricted: true, viewerUids: [lan.uid, huong.uid], shareWithParent: false, ownerUid: huong.uid, reportedBy: lan.uid, reportedByName: lan.name, ...meta() });
    // ---------------------------------------------------------------- thông báo, trao đổi
    put('notifications/ntf_seed_1', { campusId: 'CG', title: 'Họp phụ huynh đầu năm', body: 'Nhà trường mời quý phụ huynh dự họp lúc 8h00 thứ Bảy tuần này tại hội trường.', category: 'event', attachmentPaths: [], scope: { type: 'campus', ids: ['CG'] }, requireAck: true, status: 'sent', sentAt: now, sentBy: huong.uid, recipientCount: 4, authorName: huong.name, ...meta() });
    for (const u of [linh, nam, lan, huong]) {
        put(`notificationReceipts/ntf_seed_1_${u.uid}`, { notifId: 'ntf_seed_1', uid: u.uid, campusId: 'CG', title: 'Họp phụ huynh đầu năm', category: 'event', requireAck: true, sentAt: now, readAt: u.uid === linh.uid ? now : null, ackAt: null, recipientKind: u.uid === lan.uid || u.uid === huong.uid ? 'staff' : 'parent' });
    }
    put('notifications/ntf_seed_2', { campusId: 'CG', title: 'Thông báo nghỉ lễ (nháp)', body: 'Trường nghỉ lễ theo lịch.', category: 'general', attachmentPaths: [], scope: { type: 'campus', ids: ['CG'] }, requireAck: false, status: 'draft', authorName: huong.name, ...meta() });
    put('threads/thr_seed_1', { campusId: 'CG', childId: 'child_mn001', classId: 'cls_mam1', subject: 'Hỏi về giờ đón muộn', priority: 'normal', status: 'open', participants: [linh.uid], createdByName: linh.name, createdByKind: 'parent', assignedTo: lan.uid, assignedToName: lan.name, dueAt: null, lastMessageAt: now, messageCount: 2, ...meta({ createdBy: linh.uid, updatedBy: linh.uid }) });
    put('threads/thr_seed_1/messages/m1', { senderUid: linh.uid, senderName: linh.name, senderKind: 'parent', text: 'Cô ơi, thứ Sáu này em đón bé muộn 30 phút được không ạ?', attachmentPaths: [], at: now, createdAt: now, createdBy: linh.uid });
    put('threads/thr_seed_1/messages/m2', { senderUid: lan.uid, senderName: lan.name, senderKind: 'staff', text: 'Dạ được chị, chị báo bảo vệ giúp em nhé.', attachmentPaths: [], at: now, createdAt: now, createdBy: lan.uid });
    // ---------------------------------------------------------------- học phí (ví dụ chuẩn: 3.000.000 + 770.000 + 200.000 − 300.000 − 70.000 = 3.600.000; nợ cũ 500.000)
    put('feePolicies/fp_seed_cg', {
        campusId: 'CG', name: 'Biểu phí Cầu Giấy 2026-2027', code: 'CG-2026', seriesId: 'fp_seed_cg', versionNo: 1, status: 'published', effectiveFrom: '2026-09-01',
        items: [{ code: 'TUITION', type: 'tuition', name: 'Học phí tháng', amount: 3000000 }, { code: 'LATE', type: 'service', name: 'Đón muộn', amount: 200000 }],
        meal: { mode: 'provisional', unitPrice: 35000, daysPerMonth: 22 }, discounts: [], dueDay: 10, includeTrial: false, publishedAt: now, publishedBy: owner.uid, archived: false, ...meta(),
    });
    const lines = [
        { code: 'TUITION', type: 'tuition', description: 'Học phí tháng 10/2026', qty: 1, unitPrice: 3000000, amount: 3000000 },
        { code: 'MEAL', type: 'meal', description: 'Tiền ăn 22 suất × 35000', qty: 22, unitPrice: 35000, amount: 770000 },
        { code: 'LATE', type: 'service', description: 'Đón muộn', qty: 1, unitPrice: 200000, amount: 200000 },
        { code: 'SIBLING', type: 'discount', description: 'Giảm trừ anh/chị em', qty: 1, unitPrice: 300000, amount: -300000 },
        { code: 'MEAL_REFUND', type: 'meal_refund', description: 'Hoàn trừ tiền ăn kỳ trước 2 suất × 35000', qty: 2, unitPrice: 35000, amount: -70000 },
    ];
    put('receivables/rcv_child_mn001_2026-09_monthly', { childId: 'child_mn001', childName: 'Nguyễn Minh An', classId: 'cls_mam1', campusId: 'CG', periodKey: '2026-09', type: 'monthly', lines: [{ code: 'TUITION', type: 'tuition', description: 'Học phí tháng 9/2026 (còn nợ)', qty: 1, unitPrice: 500000, amount: 500000 }], billed: 500000, discount: 0, adjustUp: 0, openingDebt: 0, allocated: 0, balance: 500000, amount: 500000, dueDate: '2026-09-10', status: 'overdue', isOverdue: true, ...meta() });
    put('receivables/rcv_child_mn001_2026-10_monthly', { childId: 'child_mn001', childName: 'Nguyễn Minh An', classId: 'cls_mam1', campusId: 'CG', periodKey: '2026-10', type: 'monthly', billingRunId: 'br_CG_2026-10', lines, billed: 3970000, discount: 370000, adjustUp: 0, openingDebt: 0, allocated: 0, balance: 3600000, amount: 3600000, dueDate: '2026-10-10', status: 'unpaid', isOverdue: false, mealMode: 'provisional', mealCount: 22, refundMealCount: 2, ...meta() });
    put('billingRuns/br_CG_2026-10', { campusId: 'CG', periodKey: '2026-10', status: 'published', counts: { created: 1, updated: 0, skipped: 0, errors: 0 }, totalNew: 3600000, runAt: now, runBy: minh.uid, ...meta() });
    // ---------------------------------------------------------------- ghi (batch ≤ 400)
    let n = 0;
    for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch();
        for (const w of writes.slice(i, i + 400)) {
            batch.set(db.doc(w.path), w.data);
            n++;
        }
        await batch.commit();
    }
    console.log(`Đã ghi ${n} tài liệu vào org "${ORG}".`);
    console.log('\nTài khoản dev (mật khẩu chung: ' + PASSWORD + ')');
    console.log('  Chủ chuỗi     : ' + owner.email);
    console.log('  Hiệu trưởng CG: ' + huong.email);
    console.log('  Giáo viên     : ' + lan.email);
    console.log('  Kế toán       : ' + minh.email);
    console.log('  Phụ huynh (mẹ): ' + linh.email + '   (điện thoại +84912345678)');
    console.log('  Phụ huynh (bố): ' + nam.email);
    console.log('\nOrg: ' + ORG + ' | Cơ sở: CG, TX | Trẻ: MN001..MN006');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
