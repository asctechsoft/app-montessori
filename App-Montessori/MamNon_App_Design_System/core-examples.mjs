/** Runnable pure helpers; not authentication, API clients or native widgets. */
export function formatVnd(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('VND must be a safe integer');
  const sign = value < 0 ? '−' : '';
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' đ';
}
export function createScopeKey(scope, resource) {
  const parts = [scope.organizationId, scope.campusId, scope.userId, scope.role, resource];
  if (parts.some(x => typeof x !== 'string' || x.length === 0)) throw new TypeError('Missing scope');
  return JSON.stringify(parts); // Delimiter-safe; backend still enforces authorization.
}
export function mayPress({loading = false, disabled = false}) {
  return !loading && !disabled;
}
export function outstanding({openingDebt, issued, credit, allocated}) {
  const xs = [openingDebt, issued, credit, allocated];
  if (xs.some(x => !Number.isSafeInteger(x) || x < 0)) throw new TypeError('Invalid money');
  const result = openingDebt + issued - credit - allocated;
  if (!Number.isSafeInteger(result)) throw new RangeError('Unsafe result');
  return result; // Negative is a credit balance, not an extra charge.
}
export const navigationByRole = {
  parent: ['Trang chủ', 'Nhật ký', 'Học phí', 'Tiện ích', 'Cá nhân'],
  teacher: ['Trang chủ', 'Lớp học', 'Nhật ký', 'Công cá nhân', 'Tiện ích'],
  principal: ['Tổng quan', 'Quản lý', 'Nhân sự', 'Phê duyệt', 'Cá nhân']
};
