"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
exports.countActiveEnrollments = countActiveEnrollments;
const firebase_1 = require("../core/firebase");
const errors_1 = require("../core/errors");
const entity_registry_1 = require("../core/entity-registry");
const store_1 = require("../core/store");
const validate_1 = require("../core/validate");
const util_1 = require("./util");
// ------------------------------------------------------------------ đăng ký collection của BE-1
(0, entity_registry_1.registerEntity)('academicYears', {
    writePerm: 'classes.write',
    campusScoped: true,
    uniqueBy: ['code'],
    idPrefix: 'ay_',
    schema: {
        code: { t: 'string', req: true, min: 2, max: 30 },
        name: { t: 'string', req: true, min: 2, max: 120 },
        startDate: { t: 'day', req: true },
        endDate: { t: 'day', req: true },
        current: { t: 'bool' },
        status: { t: 'string', oneOf: ['draft', 'active', 'closed'] },
        teachingDays: { t: 'array', max: 7, of: { t: 'int', min: 1, max: 7 } }, // 1=Thứ hai ... 7=Chủ nhật
        note: { t: 'string', max: 500 },
    },
    async beforeSave(ctx, data, existing) {
        const start = data.startDate ?? existing?.startDate;
        const end = data.endDate ?? existing?.endDate;
        if (start && end && start >= end)
            (0, errors_1.invalid)({ endDate: 'Ngày kết thúc phải sau ngày bắt đầu.' });
        const campusId = data.campusId ?? existing?.campusId;
        const others = (await ctx.col('academicYears').where('campusId', '==', campusId).get()).docs
            .filter((d) => !d.data().archived && d.id !== existing?.id);
        for (const o of others) {
            const od = o.data();
            if (start <= od.endDate && end >= od.startDate)
                (0, errors_1.invalid)({ startDate: `Trùng khoảng thời gian với năm học "${od.name}".` });
        }
        if (data.current === true) {
            for (const o of others.filter((x) => x.data().current === true))
                await o.ref.update({ current: false, ...ctx.metaUpdate(o.data().version ?? 1) });
        }
        return data;
    },
});
(0, entity_registry_1.registerEntity)('calendarExceptions', {
    writePerm: 'campus.manage',
    campusScoped: true,
    idPrefix: 'cal_',
    schema: {
        name: { t: 'string', req: true, min: 2, max: 120 },
        type: { t: 'string', req: true, oneOf: ['holiday', 'closure', 'makeup_day', 'special_hours'] },
        fromDay: { t: 'day', req: true },
        toDay: { t: 'day', req: true },
        openTime: { t: 'time' },
        closeTime: { t: 'time' },
        classIds: { t: 'array', max: 100, of: { t: 'string', max: 128 } },
        note: { t: 'string', max: 500 },
    },
    async beforeSave(_ctx, data, existing) {
        const from = data.fromDay ?? existing?.fromDay;
        const to = data.toDay ?? existing?.toDay;
        if (from && to && from > to)
            (0, errors_1.invalid)({ toDay: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
        const type = data.type ?? existing?.type;
        if (type === 'special_hours') {
            const o = data.openTime ?? existing?.openTime;
            const c = data.closeTime ?? existing?.closeTime;
            if (!o || !c)
                (0, errors_1.invalid)({ openTime: 'Cần nhập giờ mở và đóng cửa cho ngày giờ đặc biệt.' });
            if (o >= c)
                (0, errors_1.invalid)({ closeTime: 'Giờ đóng cửa phải sau giờ mở cửa.' });
        }
        return data;
    },
});
(0, entity_registry_1.registerEntity)('classes', {
    writePerm: 'classes.write',
    campusScoped: true,
    uniqueBy: ['code'],
    idPrefix: 'cls_',
    schema: {
        code: { t: 'string', req: true, min: 1, max: 30 },
        name: { t: 'string', req: true, min: 2, max: 120 },
        ageGroup: { t: 'string', max: 60 },
        minAgeMonths: { t: 'int', min: 0, max: 120 },
        maxAgeMonths: { t: 'int', min: 0, max: 120 },
        room: { t: 'string', max: 60 },
        capacity: { t: 'int', req: true, min: 1, max: 200 },
        academicYearId: { t: 'string', max: 128 },
        status: { t: 'string', oneOf: ['active', 'closed'] },
        note: { t: 'string', max: 500 },
    },
    async beforeSave(ctx, data, existing) {
        const min = data.minAgeMonths ?? existing?.minAgeMonths;
        const max = data.maxAgeMonths ?? existing?.maxAgeMonths;
        if (min !== undefined && max !== undefined && min > max)
            (0, errors_1.invalid)({ maxAgeMonths: 'Tuổi tối đa phải không nhỏ hơn tuổi tối thiểu.' });
        const campusId = data.campusId ?? existing?.campusId;
        if (data.academicYearId) {
            const ay = await ctx.doc(`academicYears/${data.academicYearId}`).get();
            if (!ay.exists || ay.data().campusId !== campusId)
                (0, errors_1.invalid)({ academicYearId: 'Năm học không tồn tại tại cơ sở này.' });
        }
        if (existing && data.capacity !== undefined) {
            const enrolled = await countActiveEnrollments(ctx, existing.id);
            if (data.capacity < enrolled)
                (0, errors_1.invalid)({ capacity: `Sức chứa không được nhỏ hơn sĩ số hiện tại (${enrolled}).` });
        }
        return data;
    },
});
(0, entity_registry_1.registerEntity)('categories', {
    writePerm: 'campus.manage',
    campusScoped: true,
    uniqueBy: ['type', 'code'],
    idPrefix: 'cat_',
    schema: {
        type: { t: 'string', req: true, min: 2, max: 40 }, // absence_reason | incident_type | unit | allergy | ...
        code: { t: 'string', req: true, min: 1, max: 40 },
        name: { t: 'string', req: true, min: 1, max: 120 },
        sort: { t: 'int', min: 0, max: 9999 },
        active: { t: 'bool' },
        note: { t: 'string', max: 300 },
    },
});
async function countActiveEnrollments(ctx, classId) {
    const q = await ctx.col('enrollments').where('classId', '==', classId).where('status', '==', 'active').count().get();
    return q.data().count;
}
// ------------------------------------------------------------------ nội bộ
const archiveGuards = {
    async classes(ctx, doc) {
        const n = await countActiveEnrollments(ctx, doc.id);
        if (n > 0)
            (0, errors_1.fail)('PRECONDITION', `Lớp còn ${n} trẻ đang học. Hãy chuyển lớp cho các trẻ trước khi lưu trữ.`, { enrolled: n });
    },
    async academicYears(ctx, doc) {
        const q = await ctx.col('classes').where('academicYearId', '==', doc.id).get();
        const live = q.docs.filter((d) => !d.data().archived);
        if (live.length)
            (0, errors_1.fail)('PRECONDITION', 'Năm học còn lớp đang dùng. Hãy lưu trữ hoặc chuyển các lớp trước.', { classIds: live.map((d) => d.id) });
    },
};
function cfgOf(collection) {
    const name = (0, util_1.s)(collection);
    const cfg = (0, entity_registry_1.getEntity)(name);
    if (!cfg)
        (0, errors_1.fail)('VALIDATION', 'Danh mục không được hỗ trợ.', { fieldErrors: { collection: 'Giá trị không hợp lệ.' }, supported: (0, entity_registry_1.listEntities)() });
    return { name, cfg };
}
async function resolveCampus(ctx, cfg, data, existing) {
    if (!cfg.campusScoped)
        return null;
    const requested = (0, util_1.s)(data.campusId) || (0, util_1.s)(ctx.campusId);
    if (existing) {
        if (requested && requested !== existing.campusId)
            (0, errors_1.invalid)({ campusId: 'Không được đổi cơ sở của bản ghi.' });
        return existing.campusId;
    }
    if (!requested)
        (0, errors_1.invalid)({ campusId: 'Bắt buộc chọn cơ sở.' });
    await (0, util_1.campusOf)(ctx, requested); // phải thuộc org, nếu không → từ chối
    return requested;
}
exports.actions = {
    'entity.save': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const { name, cfg } = cfgOf(b.collection);
            const raw = (0, util_1.asObj)(b.data);
            const id = (0, util_1.s)(b.id);
            let existing = null;
            if (id) {
                (0, util_1.requireId)(id, 'id');
                existing = await (0, store_1.getOr404)(ctx.doc(`${name}/${id}`), 'Bản ghi');
                if (existing.archived === true)
                    (0, errors_1.fail)('INVALID_STATE', 'Bản ghi đã được lưu trữ, không thể sửa.');
                if (cfg.editableStatuses && existing.status && !cfg.editableStatuses.includes(existing.status)) {
                    (0, errors_1.fail)('INVALID_STATE', `Không thể sửa bản ghi ở trạng thái "${existing.status}".`);
                }
            }
            const campusId = await resolveCampus(ctx, cfg, raw, existing);
            ctx.require(cfg.writePerm, campusId); // campusId=null → phải có quyền toàn org
            let data = (0, validate_1.validate)(raw, cfg.schema, { partial: !!existing });
            if (campusId)
                data.campusId = campusId;
            // trùng mã
            if (cfg.uniqueBy?.length) {
                const keys = cfg.uniqueBy;
                const vals = keys.map((k) => data[k] ?? existing?.[k]);
                if (vals.every((v) => v !== undefined && v !== null && v !== '')) {
                    let q = ctx.col(name).where(keys[0], '==', vals[0]);
                    if (campusId)
                        q = q.where('campusId', '==', campusId);
                    const dup = (await q.get()).docs.find((d) => d.id !== id && !d.data().archived && keys.every((k, i) => d.data()[k] === vals[i]));
                    if (dup)
                        (0, errors_1.invalid)({ [keys[keys.length - 1]]: 'Mã đã tồn tại, vui lòng chọn mã khác.' }, 'Dữ liệu bị trùng.');
                }
            }
            if (cfg.beforeSave) {
                const r = await cfg.beforeSave(ctx, data, existing);
                if (r)
                    data = r;
            }
            if (!existing) {
                const newId = cfg.idPrefix ? ctx.col(name).doc().id.replace(/^/, cfg.idPrefix) : undefined;
                const toWrite = { archived: false, ...data };
                const created = await (0, store_1.createDoc)(ctx, name, newId, toWrite);
                await ctx.audit({ action: 'entity.save', collection: name, docId: created, campusId, before: null, after: toWrite });
                return { id: created, version: 1, ...toWrite };
            }
            if (!Object.keys(data).length)
                (0, errors_1.invalid)({ data: 'Không có thay đổi để lưu.' });
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`${name}/${id}`), data, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            const changed = Object.keys(data);
            await ctx.audit({
                action: 'entity.save', collection: name, docId: id, campusId,
                before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
                after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
            });
            return { id, ...after };
        },
    },
    'entity.archive': {
        scope: 'org',
        handler: async (ctx, p) => {
            const b = (0, util_1.asObj)(p);
            const { name, cfg } = cfgOf(b.collection);
            const id = (0, util_1.requireId)(b.id, 'id');
            const reason = (0, util_1.s)(b.reason);
            if (!reason)
                (0, errors_1.invalid)({ reason: 'Vui lòng nhập lý do lưu trữ.' });
            const existing = await (0, store_1.getOr404)(ctx.doc(`${name}/${id}`), 'Bản ghi');
            const campusId = cfg.campusScoped ? (existing.campusId ?? null) : null;
            ctx.require(cfg.writePerm, campusId);
            if (existing.archived === true)
                return { id, archived: true, unchanged: true };
            await archiveGuards[name]?.(ctx, existing);
            const { before, after } = await (0, store_1.updateDoc)(ctx, ctx.doc(`${name}/${id}`), {
                archived: true, archivedAt: firebase_1.Timestamp.fromDate(ctx.now), archivedBy: ctx.uid, archiveReason: reason,
            }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
            await ctx.audit({ action: 'entity.archive', collection: name, docId: id, campusId, before: { archived: before.archived ?? false }, after: { archived: true }, reason });
            return { id, archived: true, version: after.version };
        },
    },
};
