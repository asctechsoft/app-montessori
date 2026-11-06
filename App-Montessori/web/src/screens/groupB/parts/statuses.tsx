'use client';
import { Badge } from '@/components/ui/Badge';
import type { StatusInfo } from '@/lib/status';

type StatusMap = Record<string, StatusInfo>;
const S = (label: string, tone: StatusInfo['tone']): StatusInfo => ({ label, tone });

/** Nhãn trạng thái riêng của nhóm B (nhân sự, công, lương, thu chi, bếp, kho, tài sản, xe). Luôn hiển thị chữ + biểu tượng. */
export const B_STATUS = {
  employee: { active: S('Đang làm việc', 'success'), on_leave: S('Tạm nghỉ', 'warning'), resigned: S('Đã nghỉ việc', 'neutral') },
  contract: { active: S('Đang hiệu lực', 'success'), ended: S('Đã kết thúc', 'neutral'), cancelled: S('Đã hủy', 'neutral') },
  assignment: { active: S('Đang hiệu lực', 'success'), cancelled: S('Đã hủy', 'neutral') },
  roster: { draft: S('Nháp', 'neutral'), published: S('Đã công bố', 'success') },
  timesheet: { draft: S('Nháp (chưa khóa)', 'warning'), locked: S('Đã khóa', 'success'), reopened: S('Đã mở lại', 'info') },
  day: {
    ok: S('Đủ dữ liệu', 'success'), incomplete: S('Chưa đủ dữ liệu', 'warning'), absent: S('Vắng', 'error'), leave: S('Nghỉ phép', 'info'),
    holiday: S('Ngày lễ', 'neutral'), scheduled: S('Ca chưa kết thúc', 'neutral'), off: S('Không có ca', 'neutral'),
  },
  punchResult: { ok: S('Hợp lệ', 'success'), outside_radius: S('Ngoài phạm vi', 'warning'), no_location: S('Không có vị trí', 'warning') },
  punchSource: { app: S('Ứng dụng', 'neutral'), device: S('Máy chấm công', 'neutral'), manual: S('Nhập thủ công', 'neutral') },
  leave: { pending: S('Chờ duyệt', 'warning'), approved: S('Đã duyệt', 'success'), rejected: S('Từ chối', 'error'), cancelled: S('Đã hủy', 'neutral') },
  swap: {
    awaiting_peer: S('Chờ người nhận ca', 'info'), declined_by_peer: S('Người nhận từ chối', 'error'), awaiting_manager: S('Chờ quản lý duyệt', 'warning'),
    approved: S('Đã duyệt', 'success'), rejected: S('Từ chối', 'error'),
  },
  payrollRun: {
    draft: S('Nháp', 'neutral'), submitted: S('Chờ duyệt', 'warning'), approved: S('Đã duyệt', 'info'),
    published: S('Đã phát hành phiếu', 'info'), paid: S('Đã chi trả đủ', 'success'),
  },
  expense: { draft: S('Nháp', 'neutral'), requested: S('Chờ duyệt', 'warning'), approved: S('Đã duyệt, chưa chi', 'info'), rejected: S('Từ chối', 'error'), paid: S('Đã thanh toán', 'success') },
  menu: { draft: S('Nháp', 'neutral'), submitted: S('Chờ duyệt', 'warning'), approved: S('Đã duyệt', 'info'), rejected: S('Từ chối', 'error'), published: S('Đã công bố', 'success') },
  stocktake: { pending_approval: S('Chờ duyệt chênh lệch', 'warning'), closed: S('Khớp, đã đóng', 'success'), approved: S('Đã duyệt điều chỉnh', 'success'), rejected: S('Từ chối', 'error') },
  stockTransfer: { in_transit: S('Đang vận chuyển', 'info'), received: S('Đã nhận', 'success'), received_with_variance: S('Đã nhận, có chênh lệch', 'warning') },
  asset: {
    created: S('Mới tạo', 'neutral'), handed_over: S('Đã bàn giao', 'info'), in_use: S('Đang sử dụng', 'success'), repair_requested: S('Yêu cầu sửa', 'warning'),
    repair_assigned: S('Đã giao sửa', 'warning'), repair_accepted: S('Đã nghiệm thu sửa', 'info'), transferred: S('Đã điều chuyển', 'info'), disposed: S('Đã thanh lý', 'neutral'),
  },
  assetRequest: { open: S('Đang mở', 'warning'), assigned: S('Đã giao', 'info'), closed: S('Đã đóng', 'success') },
  trip: { planned: S('Kế hoạch', 'neutral'), in_progress: S('Đang chạy', 'info'), completed: S('Hoàn tất', 'success'), needs_review: S('Cần rà soát', 'error') },
  rider: { expected: S('Dự kiến', 'neutral'), onboard: S('Đang trên xe', 'info'), alighted: S('Đã xuống xe', 'success'), handed_over: S('Đã bàn giao', 'success') },
  fund: { matched: S('Khớp', 'success'), variance: S('Có chênh lệch', 'warning') },
  pay: { unpaid: S('Chưa trả', 'neutral'), partially_paid: S('Đã trả một phần', 'info'), paid: S('Đã trả đủ', 'success') },
} as const satisfies Record<string, StatusMap>;

export type BDomain = keyof typeof B_STATUS;

export function bStatus(domain: BDomain, value: string | null | undefined): StatusInfo {
  return (value && (B_STATUS[domain] as StatusMap)[value]) || { label: value || 'Không rõ', tone: 'neutral' };
}

export function Tag({ domain, value }: { domain: BDomain; value: string | null | undefined }) {
  const s = bStatus(domain, value);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
