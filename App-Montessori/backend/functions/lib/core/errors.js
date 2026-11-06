"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = fail;
exports.denied = denied;
exports.invalid = invalid;
const https_1 = require("firebase-functions/v2/https");
const GRPC = {
    PERMISSION_DENIED: 'permission-denied',
    UNAUTHENTICATED: 'unauthenticated',
    NOT_FOUND: 'not-found',
    VALIDATION: 'invalid-argument',
    VERSION_CONFLICT: 'aborted',
    CONFLICT: 'already-exists',
    PRECONDITION: 'failed-precondition',
    INVALID_STATE: 'failed-precondition',
    LIMIT: 'resource-exhausted',
    INTERNAL: 'internal',
};
/** Lỗi nghiệp vụ chuẩn: message tiếng Việt cho người dùng, details.code cho client. */
function fail(code, message, extra = {}) {
    throw new https_1.HttpsError(GRPC[code], message, { code, ...extra });
}
function denied(message = 'Bạn không có quyền thực hiện thao tác này.') {
    return fail('PERMISSION_DENIED', message);
}
function invalid(fieldErrors, message = 'Dữ liệu chưa hợp lệ.') {
    return fail('VALIDATION', message, { fieldErrors });
}
