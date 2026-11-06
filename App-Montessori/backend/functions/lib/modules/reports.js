"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
// Báo cáo (W44), xuất CSV, dashboard. Mọi chỉ số trả kèm `rows` (dữ liệu cấu thành) và `definitions` (công thức).
// Phạm vi theo campusesFor('reports.read'); KHÔNG tin campusId của client.
const firestore_1 = require("firebase-admin/firestore");
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const store_1 = require("../core/store");
const common_1 = require("../lib/common");
const finance_common_1 = require("../lib/finance-common");
const time_1 = require("../lib/time");
async function allowedCampuses(ctx, perm, requested) {
    const all = (0, common_1.asDocs)(await ctx.col('campuses').get()).filter((c) => !c.archived);
    const scope = ctx.campusesFor(perm);
    const allowed = scope.includes('*') ? all : all.filter((c) => scope.includes(c.id));
    if (typeof requested === 'string' && requested) {
        const c = allowed.find((x) => x.id === requested);
        if (!c)
            (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không có quyền xem báo cáo của cơ sở này.');
        return new Map([[c.id, c]]);
    }
    if (!allowed.length)
        (0, errors_1.fail)('PERMISSION_DENIED', 'Bạn không có quyền xem báo cáo.');
    return new Map(allowed.map((c) => [c.id, c]));
}
const rangeDocs = async (ctx, col, campusId, from, to, field = 'dayKey') => (0, common_1.asDocs)(await ctx.col(col).where('campusId', '==', campusId).where(field, '>=', from).where(field, '<=', to).limit(20000).get());
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); // % một chữ số thập phân (không phải tiền)
// ---------------------------------------------------------------- từng loại
async function enrollmentReport(ctx, cs, to, classId) {
    const rows = [];
    const byCampus = {};
    for (const [campusId, campus] of cs) {
        const [classes, enr, children] = await Promise.all([
            ctx.col('classes').where('campusId', '==', campusId).get().then(common_1.asDocs),
            ctx.col('enrollments').where('campusId', '==', campusId).get().then(common_1.asDocs),
            ctx.col('children').where('campusId', '==', campusId).get().then(common_1.asDocs),
        ]);
        const kids = new Map(children.map((c) => [c.id, c]));
        const eff = enr.filter((e) => (!e.startDate || e.startDate <= to) && (!e.endDate || e.endDate >= to) && e.status !== 'cancelled' && (!classId || e.classId === classId));
        const cap = classes.filter((c) => !c.archived && (!classId || c.id === classId)).reduce((s, c) => s + (c.capacity ?? 0), 0);
        const st = (s) => children.filter((c) => c.status === s && (!classId || c.classId === classId)).length;
        byCampus[campusId] = { enrolled: eff.length, capacity: cap, utilizationPct: pct(eff.length, cap), trial: st('trial'), onLeave: st('on_leave'), withdrawn: st('withdrawn'), pending: st('pending') };
        for (const e of eff) {
            const k = kids.get(e.childId);
            rows.push({ campusId, campusName: campus.name, classId: e.classId, className: classes.find((c) => c.id === e.classId)?.name ?? e.classId, childId: e.childId, childName: k ? (0, finance_common_1.childName)(k) : e.childId, childStatus: k?.status ?? null, startDate: e.startDate ?? null });
        }
        for (const c of classes.filter((x) => !x.archived && (!classId || x.id === classId))) {
            const n = eff.filter((e) => e.classId === c.id).length;
            rows.push({ campusId, campusName: campus.name, classId: c.id, className: c.name, classSummary: true, enrolled: n, capacity: c.capacity ?? 0, utilizationPct: pct(n, c.capacity ?? 0) });
        }
    }
    const sum = (k) => Object.values(byCampus).reduce((s, x) => s + (x[k] ?? 0), 0);
    return {
        metrics: { enrolled: sum('enrolled'), capacity: sum('capacity'), utilizationPct: pct(sum('enrolled'), sum('capacity')), trial: sum('trial'), onLeave: sum('onLeave'), withdrawn: sum('withdrawn'), pending: sum('pending'), byCampus },
        rows,
        definitions: {
            enrolled: 'Sĩ số = số trẻ có đợt ghi danh (enrollment) hiệu lực tại ngày đến (to); không tính hủy.',
            capacity: 'Sức chứa = tổng capacity cấu hình của các lớp đang hoạt động.',
            utilizationPct: 'Công suất (%) = sĩ số / sức chứa.',
            trial: 'Học thử, bảo lưu (on_leave), thôi học (withdrawn): đếm theo trạng thái hiện tại của hồ sơ trẻ, tách khỏi sĩ số.',
        },
    };
}
async function attendanceReport(ctx, cs, from, to, classId) {
    const rows = [];
    const tot = { present: 0, excused: 0, unexcused: 0, noClass: 0, unconfirmed: 0 };
    for (const [campusId, campus] of cs) {
        const att = (await rangeDocs(ctx, 'attendance', campusId, from, to)).filter((a) => !classId || a.classId === classId);
        const by = new Map();
        for (const a of att) {
            const k = a.childId;
            const r = by.get(k) ?? { campusId, campusName: campus.name, classId: a.classId, childId: k, present: 0, excused: 0, unexcused: 0, noClass: 0, unconfirmed: 0 };
            if (a.status === 'present')
                r.present++;
            else if (a.status === 'absent_excused')
                r.excused++;
            else if (a.status === 'absent_unexcused')
                r.unexcused++;
            else if (a.status === 'no_class')
                r.noClass++;
            else
                r.unconfirmed++;
            by.set(k, r);
        }
        for (const r of by.values()) {
            const required = r.present + r.excused + r.unexcused; // số buổi phải học (loại ngày không học, chưa xác nhận)
            rows.push({ ...r, required, ratePct: pct(r.present, required) });
            tot.present += r.present;
            tot.excused += r.excused;
            tot.unexcused += r.unexcused;
            tot.noClass += r.noClass;
            tot.unconfirmed += r.unconfirmed;
        }
    }
    const required = tot.present + tot.excused + tot.unexcused;
    return {
        metrics: { ...tot, required, attendanceRatePct: pct(tot.present, required) }, rows,
        definitions: {
            attendanceRatePct: 'Chuyên cần (%) = số buổi có mặt / số buổi phải học.',
            required: 'Số buổi phải học = có mặt + nghỉ có phép + nghỉ không phép; loại ngày không học (no_class) và buổi chưa xác nhận; trẻ nhập học giữa kỳ chỉ tính từ ngày có điểm danh.',
        },
    };
}
async function handoverReport(ctx, cs, from, to, classId) {
    const rows = [];
    const m = { received: 0, pickedUp: 0, stillAtSchool: 0, missingConfirm: 0, latePickup: 0 };
    for (const [campusId, campus] of cs) {
        const hs = (await rangeDocs(ctx, 'handovers', campusId, from, to)).filter((h) => !classId || h.classId === classId);
        const att = (await rangeDocs(ctx, 'attendance', campusId, from, to)).filter((a) => a.status === 'present' && (!classId || a.classId === classId));
        const hBy = new Map(hs.map((h) => [`${h.childId}_${h.dayKey}`, h]));
        const close = campus.closeTime ?? '17:30';
        const tz = (0, common_1.tzOf)(campus);
        for (const h of hs) {
            const picked = h.state === 'picked_up' || h.pickedUpAt;
            const pAt = (0, common_1.toDate)(h.pickedUpAt);
            const late = !!(pAt && new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(pAt) > close);
            m.received++;
            if (picked)
                m.pickedUp++;
            else
                m.stillAtSchool++;
            if (late)
                m.latePickup++;
            rows.push({ campusId, campusName: campus.name, childId: h.childId, classId: h.classId, dayKey: h.dayKey, state: picked ? 'picked_up' : 'received', receivedAt: (0, common_1.toDate)(h.receivedAt)?.toISOString() ?? null, pickedUpAt: pAt?.toISOString() ?? null, late });
        }
        for (const a of att) {
            if (!hBy.has(`${a.childId}_${a.dayKey}`)) {
                m.missingConfirm++;
                rows.push({ campusId, campusName: campus.name, childId: a.childId, classId: a.classId, dayKey: a.dayKey, state: 'missing_handover' });
            }
        }
    }
    return {
        metrics: m, rows,
        definitions: {
            received: 'Đã nhận = số lượt bàn giao nhận trẻ trong kỳ.', pickedUp: 'Đã trả = lượt có xác nhận trả trẻ.',
            stillAtSchool: 'Còn ở trường = đã nhận nhưng chưa có xác nhận trả.', missingConfirm: 'Thiếu xác nhận = có điểm danh có mặt nhưng không có bản ghi bàn giao nhận.',
            latePickup: 'Trả muộn = trả sau giờ đóng cửa của cơ sở (campus.closeTime) theo thời điểm thực tế.',
        },
    };
}
async function tuitionReport(ctx, cs, from, to, classId) {
    const rows = [];
    let receivable = 0;
    let allocated = 0;
    let outstanding = 0;
    let overdue = 0;
    let credits = 0;
    let carried = 0;
    const fromP = from.slice(0, 7);
    const toP = to.slice(0, 7);
    for (const [campusId] of cs) {
        const rs = (0, common_1.asDocs)(await ctx.col('receivables').where('campusId', '==', campusId).limit(20000).get()).filter((r) => !['draft', 'cancelled'].includes(r.status) && (!classId || r.classId === classId));
        for (const r of rs) {
            const net = (r.openingDebt ?? 0) + (r.billed ?? 0) + (r.adjustUp ?? 0) - (r.discount ?? 0);
            const inRange = r.periodKey >= fromP && r.periodKey <= toP;
            if (inRange) {
                receivable += net;
                allocated += r.allocated ?? 0;
            }
            if (r.periodKey <= toP) {
                outstanding += r.balance ?? 0; // mỗi khoản đếm MỘT lần; nợ kỳ trước chuyển sang là chính các khoản kỳ trước, không cộng lại vào kỳ mới
                if (r.periodKey < fromP)
                    carried += r.balance ?? 0;
                if ((r.balance ?? 0) > 0 && r.dueDate && r.dueDate < to)
                    overdue += r.balance;
            }
            if (inRange || ((r.balance ?? 0) > 0 && r.periodKey <= toP))
                rows.push({ campusId, receivableId: r.id, childId: r.childId, childName: r.childName ?? null, classId: r.classId ?? null, periodKey: r.periodKey, type: r.type, net, allocated: r.allocated ?? 0, balance: r.balance ?? 0, dueDate: r.dueDate ?? null, status: r.status, carriedFromPriorPeriod: r.periodKey < fromP });
        }
        const cr = (0, common_1.asDocs)(await ctx.col('credits').where('campusId', '==', campusId).where('status', '==', 'open').get());
        credits += cr.reduce((s, c) => s + c.remaining, 0);
    }
    return {
        metrics: { receivable, allocated, outstanding, overdue, credits, carriedDebt: carried, collectionRatePct: pct(allocated, receivable) },
        rows,
        definitions: {
            receivable: 'Phải thu = tổng (nợ đầu + phát sinh + điều chỉnh tăng − giảm trừ) của các khoản đã phát hành thuộc kỳ trong khoảng lọc.',
            allocated: 'Đã phân bổ = tiền đã phân bổ vào các khoản của kỳ trong khoảng lọc (hiện tại).',
            outstanding: 'Còn nợ = tổng số dư các khoản đã phát hành tới kỳ cuối; mỗi khoản chỉ đếm một lần (nợ chuyển kỳ là chính các khoản kỳ trước, KHÔNG cộng lặp vào kỳ mới).',
            carriedDebt: 'Nợ chuyển kỳ = số dư các khoản thuộc kỳ trước khoảng lọc (đã nằm trong "Còn nợ").',
            overdue: 'Quá hạn = số dư khoản có dueDate < ngày đến (to).', credits: 'Số dư có của phụ huynh (khoản nộp dư), không phải doanh thu.',
        },
    };
}
async function cashflowReport(ctx, cs, from, to) {
    const rows = [];
    const m = { collected: 0, reversed: 0, refunded: 0, expensesPaid: 0, payrollPaid: 0 };
    const byChannel = {};
    for (const [campusId, campus] of cs) {
        for (const l of await rangeDocs(ctx, 'cashLedger', campusId, from, to)) {
            const amt = l.amount;
            if (l.refType === 'payment') {
                m.collected += amt;
                byChannel[l.channel] = (byChannel[l.channel] ?? 0) + amt;
            }
            else if (l.refType === 'payment_reversal') {
                m.reversed += amt;
                byChannel[l.channel] = (byChannel[l.channel] ?? 0) - amt;
            }
            else if (l.refType === 'refund') {
                m.refunded += amt;
                byChannel[l.channel] = (byChannel[l.channel] ?? 0) - amt;
            }
            else if (l.refType === 'expense')
                m.expensesPaid += amt;
            else if (l.refType === 'payroll')
                m.payrollPaid += amt;
            rows.push({ campusId, campusName: campus.name, dayKey: l.dayKey, dir: l.dir, refType: l.refType, refId: l.refId, channel: l.channel, amount: amt, childId: l.childId ?? null });
        }
    }
    const netReceipts = m.collected - m.reversed - m.refunded;
    return {
        metrics: { ...m, netReceipts, netCashAfterOutflows: netReceipts - m.expensesPaid - m.payrollPaid, byChannel },
        rows,
        definitions: {
            collected: 'Thực thu = tổng phiếu thu đã ghi nhận trong kỳ (theo ngày nhận tiền).', reversed: 'Đảo = phiếu thu bị hủy bằng bút toán đảo.', refunded: 'Hoàn = tiền đã chi trả hoàn cho phụ huynh (không phải mới duyệt).',
            netReceipts: 'Dòng tiền thu = thực thu − đảo − hoàn.', expensesPaid: 'Chi vận hành = khoản chi đã thanh toán theo ngày thực trả.', payrollPaid: 'Chi lương = lương đã chi trả theo ngày thực trả.',
            netCashAfterOutflows: 'Chênh lệch thu chi tiền mặt/chuyển khoản — KHÔNG phải lợi nhuận; không dùng tổng phải thu.',
        },
    };
}
async function hrReport(ctx, cs, from, to) {
    const rows = [];
    const m = { activeStaff: 0, lockedPeriods: 0, openPeriods: 0, paidDaysLocked: 0, paidDaysOpen: 0, lateMinutes: 0, incompleteDays: 0, overtimeMinutes: 0, leaveDays: 0 };
    const fromP = from.slice(0, 7);
    const toP = to.slice(0, 7);
    for (const [campusId, campus] of cs) {
        m.activeStaff += (0, common_1.asDocs)(await ctx.col('employees').where('campusId', '==', campusId).get()).filter((e) => e.status === 'active' && !e.archived).length;
        const sheets = (0, common_1.asDocs)(await ctx.col('timesheets').where('campusId', '==', campusId).get()).filter((t) => t.periodKey >= fromP && t.periodKey <= toP);
        for (const t of sheets) {
            const locked = t.status === 'locked';
            if (locked)
                m.lockedPeriods++;
            else
                m.openPeriods++;
            for (const e of t.employees ?? []) {
                if (locked)
                    m.paidDaysLocked += e.paidDaysTotal ?? 0;
                else
                    m.paidDaysOpen += e.paidDaysTotal ?? 0;
                m.lateMinutes += e.totals?.lateMinutes ?? 0;
                m.incompleteDays += e.totals?.incompleteDays ?? 0;
                m.overtimeMinutes += e.totals?.overtimeMinutes ?? 0;
                rows.push({ campusId, campusName: campus.name, periodKey: t.periodKey, timesheetStatus: t.status, employeeId: e.employeeId, name: e.name, workDays: e.totals?.workDays ?? 0, paidDays: e.paidDaysTotal ?? 0, lateMinutes: e.totals?.lateMinutes ?? 0, incompleteDays: e.totals?.incompleteDays ?? 0, absentDays: e.totals?.absentDays ?? 0, overtimeMinutes: e.totals?.overtimeMinutes ?? 0 });
            }
        }
        for (const l of (0, common_1.asDocs)(await ctx.col('staffLeaves').where('campusId', '==', campusId).where('status', '==', 'approved').get())) {
            if (l.fromDay <= to && l.toDay >= from) {
                m.leaveDays += l.days ?? 0;
                rows.push({ campusId, campusName: campus.name, leaveId: l.id, employeeId: l.employeeId, name: l.employeeName, leaveType: l.type, fromDay: l.fromDay, toDay: l.toDay, leaveDays: l.days });
            }
        }
    }
    return {
        metrics: m,
        rows,
        definitions: {
            activeStaff: 'Nhân sự đang làm = hồ sơ nhân viên status active có cơ sở chính tại cơ sở.', paidDaysLocked: 'Công đủ của kỳ ĐÃ KHÓA (tách khỏi kỳ chưa chốt).', paidDaysOpen: 'Công của kỳ chưa khóa (số liệu tạm).',
            incompleteDays: 'Ngày công thiếu dữ liệu (thiếu lượt vào/ra).', lateMinutes: 'Tổng phút muộn vượt dung sai.', overtimeMinutes: 'Tăng ca = chỉ phần đã được duyệt và có ở lại thực tế.', leaveDays: 'Ngày nghỉ phép đã duyệt giao với khoảng lọc.',
        },
    };
}
async function opsReport(ctx, cs, from, to) {
    const rows = [];
    const m = { mealsExpected: 0, mealsLocked: 0, mealsCancelled: 0, mealsServed: 0, mealsBillable: 0, incidents: 0, openAssetRequests: 0, lowStockItems: 0, lotsExpiringIn7Days: 0, tripsCompleted: 0, tripsNeedReview: 0 };
    for (const [campusId, campus] of cs) {
        const tz = (0, common_1.tzOf)(campus);
        const today = (0, store_1.dayKeyOf)(new Date(), tz);
        const orders = await rangeDocs(ctx, 'mealOrders', campusId, from, to);
        for (const o of orders) {
            if (o.expected)
                m.mealsExpected++;
            if (o.locked)
                m.mealsLocked++;
            if (o.cancelled)
                m.mealsCancelled++;
            if (o.served === true)
                m.mealsServed++;
            if (o.billable)
                m.mealsBillable++;
        }
        const byDay = new Map();
        for (const o of orders) {
            const r = byDay.get(o.dayKey) ?? { campusId, campusName: campus.name, dayKey: o.dayKey, expected: 0, locked: 0, served: 0, billable: 0 };
            r.expected += o.expected ? 1 : 0;
            r.locked += o.locked ? 1 : 0;
            r.served += o.served === true ? 1 : 0;
            r.billable += o.billable ? 1 : 0;
            byDay.set(o.dayKey, r);
        }
        rows.push(...byDay.values());
        const inc = (0, common_1.asDocs)(await ctx.col('incidents').where('campusId', '==', campusId).get()).filter((i) => { const d = (0, common_1.toDate)(i.occurredAt ?? i.createdAt); const k = d ? (0, store_1.dayKeyOf)(d, tz) : i.dayKey; return k && k >= from && k <= to; });
        m.incidents += inc.length;
        for (const i of inc)
            rows.push({ campusId, campusName: campus.name, incidentId: i.id, type: i.type ?? null, severity: i.severity ?? null, status: i.status ?? null, childId: i.childId ?? null });
        const ar = (0, common_1.asDocs)(await ctx.col('assetRequests').where('campusId', '==', campusId).get()).filter((a) => ['open', 'assigned'].includes(a.status));
        m.openAssetRequests += ar.length;
        for (const a of ar)
            rows.push({ campusId, campusName: campus.name, assetRequestId: a.id, title: a.title, status: a.status, priority: a.priority ?? null });
        const items = (0, common_1.asDocs)(await ctx.col('stockItems').where('campusId', '==', campusId).get()).filter((i) => i.active !== false && typeof i.minQty === 'number' && (i.onHand ?? 0) < i.minQty);
        m.lowStockItems += items.length;
        for (const i of items)
            rows.push({ campusId, campusName: campus.name, stockItemId: i.id, code: i.code, name: i.name, onHand: i.onHand ?? 0, minQty: i.minQty });
        const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
        const lots = (0, common_1.asDocs)(await ctx.col('stockLots').where('campusId', '==', campusId).where('status', '==', 'active').get()).filter((l) => l.expiry && l.expiry <= soon && l.qtyRemaining > 0);
        m.lotsExpiringIn7Days += lots.length;
        for (const l of lots)
            rows.push({ campusId, campusName: campus.name, lotId: l.id, itemId: l.itemId, lot: l.lot, expiry: l.expiry, qtyRemaining: l.qtyRemaining, expired: l.expiry < today });
        for (const t of await rangeDocs(ctx, 'trips', campusId, from, to)) {
            if (t.status === 'completed')
                m.tripsCompleted++;
            if (t.status === 'needs_review')
                m.tripsNeedReview++;
        }
    }
    return {
        metrics: m, rows,
        definitions: {
            mealsExpected: 'Suất dự kiến = tổng suất tạo khi chốt (tất cả trẻ đủ điều kiện).', mealsLocked: 'Suất chốt cho bếp = dự kiến trừ suất hủy trước giờ chốt.', mealsServed: 'Suất sử dụng = suất bếp ghi nhận phục vụ thực tế.',
            mealsBillable: 'Suất đủ điều kiện tính tiền = kết quả tính phí cuối cùng của từng suất.', incidents: 'Sự cố ghi nhận trong khoảng lọc.', openAssetRequests: 'Yêu cầu sửa chữa chưa xử lý xong.',
        },
    };
}
async function runReport(ctx, type, p, perm = 'reports.read') {
    const to = (0, common_1.needDay)(p?.to ?? (0, store_1.dayKeyOf)(ctx.now), 'to');
    const from = (0, common_1.needDay)(p?.from ?? (type === 'enrollment' ? to : `${to.slice(0, 7)}-01`), 'from');
    if (from > to)
        (0, errors_1.invalid)({ to: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
    if ((0, time_1.listDays)(from, to).length > 366)
        (0, errors_1.invalid)({ to: 'Khoảng thời gian tối đa 366 ngày.' });
    const cs = await allowedCampuses(ctx, perm, p?.campusId);
    const classId = typeof p?.classId === 'string' ? p.classId : undefined;
    let r;
    switch (type) {
        case 'enrollment':
            r = await enrollmentReport(ctx, cs, to, classId);
            break;
        case 'attendance':
            r = await attendanceReport(ctx, cs, from, to, classId);
            break;
        case 'handover':
            r = await handoverReport(ctx, cs, from, to, classId);
            break;
        case 'tuition':
            r = await tuitionReport(ctx, cs, from, to, classId);
            break;
        case 'cashflow':
            r = await cashflowReport(ctx, cs, from, to);
            break;
        case 'hr':
            r = await hrReport(ctx, cs, from, to);
            break;
        case 'ops':
            r = await opsReport(ctx, cs, from, to);
            break;
        case 'overview': {
            const per = [];
            for (const [id, c] of cs) {
                const one = new Map([[id, c]]);
                const [e, a, t, cf] = await Promise.all([enrollmentReport(ctx, one, to), attendanceReport(ctx, one, from, to), tuitionReport(ctx, one, from, to), cashflowReport(ctx, one, from, to)]);
                const staff = (0, common_1.asDocs)(await ctx.col('employees').where('campusId', '==', id).get()).filter((x) => x.status === 'active' && !x.archived).length;
                per.push({ campusId: id, campusName: c.name, enrolled: e.metrics.enrolled, capacity: e.metrics.capacity, utilizationPct: e.metrics.utilizationPct, attendanceRatePct: a.metrics.attendanceRatePct, outstanding: t.metrics.outstanding, overdue: t.metrics.overdue, netReceipts: cf.metrics.netReceipts, activeStaff: staff });
            }
            const sum = (k) => per.reduce((s, x) => s + (x[k] ?? 0), 0);
            r = {
                metrics: { campuses: per.length, enrolled: sum('enrolled'), capacity: sum('capacity'), utilizationPct: pct(sum('enrolled'), sum('capacity')), outstanding: sum('outstanding'), overdue: sum('overdue'), netReceipts: sum('netReceipts'), activeStaff: sum('activeStaff') },
                rows: per,
                definitions: {
                    enrolled: 'Sĩ số tại ngày đến; mở loại báo cáo "enrollment" để xem từng trẻ.', utilizationPct: 'Công suất = sĩ số / sức chứa.', attendanceRatePct: 'Chuyên cần = có mặt / buổi phải học; loại báo cáo "attendance" cho chi tiết.',
                    outstanding: 'Còn nợ học phí = tổng số dư các khoản đã phát hành (không cộng lặp nợ chuyển kỳ). Chi tiết: "tuition".', netReceipts: 'Tiền thực thu − hoàn trong kỳ. Chi tiết: "cashflow".',
                    activeStaff: 'Nhân sự đang làm (hồ sơ active). Chi tiết: "hr".',
                },
            };
            break;
        }
        default: (0, errors_1.invalid)({ type: 'Loại báo cáo: overview | enrollment | attendance | handover | tuition | cashflow | hr | ops.' });
    }
    return { type, from, to, campusIds: [...cs.keys()], ...r, generatedAt: new Date().toISOString() };
}
const reportGet = async (ctx, p) => {
    const out = await runReport(ctx, String(p?.type ?? ''), p);
    const rows = out.rows.length > 5000 ? out.rows.slice(0, 5000) : out.rows;
    return { ...out, rows, truncated: out.rows.length > 5000, rowCount: out.rows.length };
};
// ---------------------------------------------------------------- export.csv
function csvCell(v) {
    if (v === null || v === undefined)
        return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number')
        s = `'${s}`; // chống CSV injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const exportCsv = async (ctx, p) => {
    const type = (0, common_1.needStr)(p?.report ?? p?.type, 'report', 30);
    const filters = (p?.filters ?? p ?? {});
    const out = await runReport(ctx, type, { ...filters, type }, 'reports.export');
    if (out.rows.length > 20000)
        (0, errors_1.fail)('LIMIT', 'Quá nhiều dòng để xuất; thu hẹp bộ lọc.');
    const cols = [...new Set(out.rows.flatMap((r) => Object.keys(r)))];
    const lines = [
        `# Báo cáo: ${type}`, `# Khoảng: ${out.from} → ${out.to}`, `# Cơ sở: ${out.campusIds.join(',')}`, `# Thời điểm xuất: ${new Date().toISOString()} bởi ${ctx.member?.displayName ?? ctx.uid}`,
        ...Object.entries(out.definitions).map(([k, v]) => `# ${k}: ${v}`),
        cols.map(csvCell).join(','),
        ...out.rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')),
    ];
    const filename = `${type}_${out.from}_${out.to}.csv`;
    await ctx.audit({ action: 'export.csv', collection: 'reports', docId: type, campusId: out.campusIds.length === 1 ? out.campusIds[0] : null, after: { report: type, from: out.from, to: out.to, campusIds: out.campusIds, rows: out.rows.length, filters: { classId: filters.classId ?? null } } });
    return { filename, mimeType: 'text/csv;charset=utf-8', csv: '﻿' + lines.join('\r\n'), rowCount: out.rows.length, exportedAt: new Date().toISOString() };
};
// ---------------------------------------------------------------- dashboard
async function campusSnapshot(ctx, campusId, campus, detail) {
    const tz = (0, common_1.tzOf)(campus);
    const today = (0, store_1.dayKeyOf)(ctx.now, tz);
    const c = (q) => q.count().get().then((s) => s.data().count);
    const [enrolled, presentToday, absentToday, receivedToday, pickedUpToday, pendingApprovals, openAlerts] = await Promise.all([
        c(ctx.col('children').where('campusId', '==', campusId).where('status', '==', 'active')),
        c(ctx.col('attendance').where('campusId', '==', campusId).where('dayKey', '==', today).where('status', '==', 'present')),
        c(ctx.col('attendance').where('campusId', '==', campusId).where('dayKey', '==', today).where('status', 'in', ['absent_excused', 'absent_unexcused'])),
        c(ctx.col('handovers').where('campusId', '==', campusId).where('dayKey', '==', today)),
        c(ctx.col('handovers').where('campusId', '==', campusId).where('dayKey', '==', today).where('state', '==', 'picked_up')),
        c(ctx.col('approvals').where('campusId', '==', campusId).where('status', '==', 'pending')),
        c(ctx.col('alerts').where('campusId', '==', campusId).where('status', '==', 'open')),
    ]);
    const bal = await ctx.col('receivables').where('campusId', '==', campusId).where('status', 'in', [...finance_common_1.OPEN_STATUSES]).aggregate({ total: firestore_1.AggregateField.sum('balance'), n: firestore_1.AggregateField.count() }).get();
    const od = await ctx.col('receivables').where('campusId', '==', campusId).where('status', '==', 'overdue').aggregate({ total: firestore_1.AggregateField.sum('balance'), n: firestore_1.AggregateField.count() }).get();
    const snap = {
        campusId, campusName: campus.name, dayKey: today, enrolled, presentToday, absentToday, stillAtSchool: Math.max(0, receivedToday - pickedUpToday), pendingApprovals, openAlerts,
        outstanding: bal.data().total ?? 0, openReceivables: bal.data().n, overdueAmount: od.data().total ?? 0, overdueCount: od.data().n,
    };
    if (detail) {
        const classes = (0, common_1.asDocs)(await ctx.col('classes').where('campusId', '==', campusId).get()).filter((x) => !x.archived);
        snap.classes = classes.map((x) => ({ classId: x.id, name: x.name, capacity: x.capacity ?? 0 }));
        snap.alerts = (0, common_1.asDocs)(await ctx.col('alerts').where('campusId', '==', campusId).where('status', '==', 'open').limit(30).get()).map((a) => ({ id: a.id, type: a.type, severity: a.severity, title: a.title, message: a.message }));
        snap.approvals = (0, common_1.asDocs)(await ctx.col('approvals').where('campusId', '==', campusId).where('status', '==', 'pending').limit(20).get()).map((a) => ({ id: a.id, type: a.type, summary: a.summary }));
        const lock = await ctx.doc(`mealLocks/${campusId}_${today}`).get();
        snap.mealsToday = lock.exists ? { expected: lock.data()?.expected, locked: lock.data()?.locked, cancelled: lock.data()?.cancelled } : null;
    }
    return snap;
}
const dashboardChain = async (ctx) => {
    const cs = await allowedCampuses(ctx, 'reports.read');
    const list = await Promise.all([...cs.entries()].map(([id, c]) => campusSnapshot(ctx, id, c, false)));
    const sum = (k) => list.reduce((s, x) => s + (x[k] ?? 0), 0);
    return {
        generatedAt: new Date().toISOString(), campuses: list,
        totals: { enrolled: sum('enrolled'), presentToday: sum('presentToday'), absentToday: sum('absentToday'), stillAtSchool: sum('stillAtSchool'), pendingApprovals: sum('pendingApprovals'), openAlerts: sum('openAlerts'), outstanding: sum('outstanding'), overdueAmount: sum('overdueAmount') },
        definitions: { enrolled: 'Trẻ đang học (status active) hiện tại.', stillAtSchool: 'Đã nhận nhưng chưa trả hôm nay.', outstanding: 'Tổng số dư các khoản đã phát hành chưa thanh toán đủ (mỗi khoản một lần).', overdueAmount: 'Số dư khoản ở trạng thái quá hạn.' },
    };
};
const dashboardCampus = async (ctx, p) => {
    const cs = await allowedCampuses(ctx, 'reports.read', p?.campusId ?? ctx.campusId ?? '__none__');
    const [[id, c]] = [...cs.entries()];
    return { generatedAt: new Date().toISOString(), ...(await campusSnapshot(ctx, id, c, true)) };
};
exports.actions = {
    'report.get': { scope: 'org', perm: 'reports.read', handler: reportGet },
    'export.csv': { scope: 'org', perm: 'reports.export', handler: exportCsv },
    'dashboard.chain': { scope: 'org', perm: 'reports.read', handler: dashboardChain },
    'dashboard.campus': { scope: 'org', perm: 'reports.read', handler: dashboardCampus },
};
void firebase_1.Timestamp;
void time_1.periodRange;
