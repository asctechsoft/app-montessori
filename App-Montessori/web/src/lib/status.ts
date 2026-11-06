// Nhãn trạng thái tiếng Việt (CONTRACT §9) + tông màu. Luôn hiển thị chữ + biểu tượng, không chỉ màu.

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface StatusInfo {
  label: string;
  tone: Tone;
}

export const STATUS_MAPS = {
  attendance: {
    present: { label: 'Có mặt', tone: 'success' },
    absent_excused: { label: 'Nghỉ có phép', tone: 'info' },
    absent_unexcused: { label: 'Nghỉ không phép', tone: 'error' },
    no_class: { label: 'Ngày không học', tone: 'neutral' },
    unconfirmed: { label: 'Chưa xác nhận', tone: 'warning' },
  },
  handover: {
    not_received: { label: 'Chưa nhận', tone: 'neutral' },
    received: { label: 'Đã nhận', tone: 'info' },
    picked_up: { label: 'Đã trả', tone: 'success' },
  },
  payment: {
    unpaid: { label: 'Chưa thanh toán', tone: 'neutral' },
    pending_reconciliation: { label: 'Chờ đối soát', tone: 'warning' },
    partially_paid: { label: 'Đã thanh toán một phần', tone: 'info' },
    paid: { label: 'Đã thanh toán', tone: 'success' },
    overdue: { label: 'Quá hạn', tone: 'error' },
    cancelled: { label: 'Đã hủy', tone: 'neutral' },
  },
  approval: {
    pending: { label: 'Chờ duyệt', tone: 'warning' },
    approved: { label: 'Đã duyệt', tone: 'success' },
    rejected: { label: 'Từ chối', tone: 'error' },
    cancelled: { label: 'Đã hủy', tone: 'neutral' },
  },
  campus: {
    preparing: { label: 'Chuẩn bị', tone: 'info' },
    active: { label: 'Đang hoạt động', tone: 'success' },
    paused: { label: 'Tạm ngừng', tone: 'warning' },
    closed: { label: 'Đã đóng', tone: 'neutral' },
  },
  member: {
    invited: { label: 'Đã mời', tone: 'info' },
    active: { label: 'Đang hoạt động', tone: 'success' },
    suspended: { label: 'Tạm khóa', tone: 'warning' },
    revoked: { label: 'Đã thu hồi', tone: 'error' },
  },
  invite: {
    pending: { label: 'Chờ chấp nhận', tone: 'info' },
    accepted: { label: 'Đã chấp nhận', tone: 'success' },
    revoked: { label: 'Đã thu hồi', tone: 'neutral' },
    expired: { label: 'Hết hạn', tone: 'warning' },
  },
} as const satisfies Record<string, Record<string, StatusInfo>>;

export type StatusDomain = keyof typeof STATUS_MAPS;

export function statusInfo(domain: StatusDomain, value: string | null | undefined): StatusInfo {
  const map = STATUS_MAPS[domain] as Record<string, StatusInfo>;
  return (value && map[value]) || { label: value || 'Không rõ', tone: 'neutral' };
}

export const MEMBER_KIND_LABELS: Record<string, string> = { owner: 'Chủ chuỗi', staff: 'Nhân sự', parent: 'Phụ huynh' };
