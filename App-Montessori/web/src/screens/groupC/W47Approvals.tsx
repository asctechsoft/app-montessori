'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { callApi } from '@/lib/api';
import { useScope } from '@/providers/ScopeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Textarea } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { ActionDialog, KV, arr, num, obj, periodLabel, str, tsMs, type Rec } from './parts/common';

interface Approval { id: string; type: string; status: string; summary: string; impact: Rec; requiredPerm: string; requestedBy: string; requestedByName: string; campusId: string; at: number; decisionNote: string; decidedByName: string; refId: string }
interface Panel { title: string; fields: [string, ReactNode][]; effects: string[]; link?: { href: string; label: string } }

const vnd = (v: unknown) => formatVnd(num(v));
const STATUS_LABEL: Record<string, string> = { attendance_correction: 'Sửa điểm danh' };
void STATUS_LABEL;
export const TYPE_LABEL: Record<string, string> = {
  attendance_correction: 'Sửa điểm danh', punch_adjust: 'Bổ sung giờ chấm công', staff_leave: 'Nghỉ phép nhân viên', shift_swap: 'Đổi ca', overtime: 'Tăng ca', transfer: 'Chuyển lớp hoặc cơ sở',
  enrollment_exception: 'Nhận trẻ vượt sĩ số', refund: 'Hoàn tiền', receivable_adjust: 'Điều chỉnh khoản phải thu', payment_cancel: 'Hủy phiếu thu', expense: 'Đề nghị chi', billing_run: 'Kỳ thu học phí',
  payroll_run: 'Bảng lương', timesheet_reopen: 'Mở lại bảng công', notification: 'Thông báo', stock_variance: 'Chênh lệch kiểm kê kho', menu: 'Thực đơn',
};
const ATT: Record<string, string> = { present: 'Có mặt', absent_excused: 'Nghỉ có phép', absent_unexcused: 'Nghỉ không phép', no_class: 'Ngày không học', unconfirmed: 'Chưa xác nhận' };

/** Mỗi loại yêu cầu có một panel chi tiết riêng (nội dung trước/sau, tác động, nơi đối chiếu). Không dùng một modal chung. */
const PANELS: Record<string, (a: Approval) => Panel> = {
  attendance_correction: (a) => { const b = obj(a.impact.before); const n = obj(a.impact.after); return { title: 'Sửa điểm danh đã chốt', fields: [['Ngày', str(a.impact.dayKey)], ['Trước khi sửa', ATT[str(b.status)] ?? str(b.status, '—')], ['Sau khi sửa', ATT[str(n.status)] ?? str(n.status, '—')], ['Lý do', str(a.impact.reason, '—')]], effects: ['Bản gốc được giữ, tạo bản điều chỉnh liên kết.', 'Cập nhật chuyên cần và các báo cáo liên quan; suất ăn tính tiền theo quy định giờ chốt.'], link: { href: '/diem-danh', label: 'Mở điểm danh' } }; },
  punch_adjust: (a) => ({ title: 'Bổ sung giờ chấm công', fields: [['Ngày', str(a.impact.dayKey)], ['Loại lượt', a.impact.kind === 'in' ? 'Vào ca' : 'Ra ca'], ['Giờ đề nghị', a.impact.requestedAt ? formatDateTime(str(a.impact.requestedAt)) : '—'], ['Số lượt gốc cùng ngày', num(a.impact.originalPunches)]], effects: ['Lượt gốc không bị xóa; tạo bản điều chỉnh liên kết.', 'Bảng công của kỳ được tính lại nếu kỳ chưa khóa.'], link: { href: '/cong-luong/duyet-cong', label: 'Mở duyệt công' } }),
  staff_leave: (a) => ({ title: 'Nghỉ phép nhân viên', fields: [['Số ngày xin nghỉ', num(a.impact.days)], ['Số dư phép', str(a.impact.balance, '—')], ['Ca bị ảnh hưởng', num(a.impact.affectedShifts)], ['Cảnh báo thiếu giáo viên', num(a.impact.teacherShortage) ? `${num(a.impact.teacherShortage)} ca` : 'Không']], effects: ['Trừ số dư phép nếu là nghỉ có lương.', 'Các ca trong thời gian nghỉ cần người thay.'], link: { href: '/cong-luong/nghi-phep', label: 'Mở nghỉ phép và đổi ca' } }),
  shift_swap: (a) => ({ title: 'Đổi ca giữa hai nhân viên', fields: [['Ngày', str(a.impact.dayKey)], ['Ca', str(a.impact.shiftId, '—')], ['Người nhường ca', str(a.impact.from, '—')], ['Người nhận ca', str(a.impact.to, '—')]], effects: ['Hoán đổi lịch ca hai người trong ngày; công tính theo ca mới.'], link: { href: '/cong-luong/nghi-phep', label: 'Mở nghỉ phép và đổi ca' } }),
  overtime: (a) => ({ title: 'Tăng ca', fields: [['Ngày', str(a.impact.dayKey)], ['Số phút', num(a.impact.minutes)]], effects: ['Cộng phút tăng ca vào bảng công và lương kỳ tương ứng.'], link: { href: '/cong-luong/duyet-cong', label: 'Mở duyệt công' } }),
  transfer: (a) => ({ title: 'Chuyển lớp hoặc cơ sở', fields: Object.entries(a.impact).filter(([, v]) => typeof v !== 'object').map(([k, v]): [string, ReactNode] => [k, String(v)]), effects: ['Đóng hồ sơ học ở lớp/cơ sở cũ và tạo hồ sơ mới từ ngày hiệu lực.', 'Công nợ và đặt cọc xử lý theo lựa chọn trong yêu cầu.'], link: { href: '/tre', label: 'Mở danh sách trẻ' } }),
  enrollment_exception: (a) => ({ title: 'Nhận trẻ vượt sĩ số', fields: [['Sức chứa lớp', num(a.impact.capacity)], ['Sĩ số hiện tại', num(a.impact.enrolled)], ['Sĩ số sau khi nhận', num(a.impact.after)], ['Lý do ngoại lệ', str(a.impact.reason, '—')]], effects: ['Cho phép nhận trẻ vượt sĩ số tối đa của lớp một lần.'], link: { href: '/lop', label: 'Mở lớp học' } }),
  refund: (a) => ({ title: 'Hoàn tiền cho phụ huynh', fields: [['Số tiền hoàn', vnd(a.impact.amount)], ['Số dư có hiện tại', vnd(a.impact.creditAvailable)]], effects: ['Duyệt KHÔNG đồng nghĩa đã chi tiền; việc chi trả ghi nhận riêng ở màn Hoàn tiền.', 'Số dư có chỉ giảm khi ghi nhận đã chi.'], link: { href: '/thu-tien/hoan-dieu-chinh', label: 'Mở hoàn tiền' } }),
  receivable_adjust: (a) => ({ title: 'Điều chỉnh khoản phải thu', fields: [['Số tiền điều chỉnh', `${num(a.impact.amount) > 0 ? '+' : ''}${vnd(a.impact.amount)}`], ['Còn nợ trước', vnd(a.impact.balanceBefore)], ['Còn nợ sau (dự kiến)', vnd(a.impact.balanceAfter)]], effects: ['Tạo chứng từ điều chỉnh liên kết; khoản gốc không bị sửa.', 'Giảm quá số đã thu sẽ tạo số dư có cho phụ huynh.'], link: { href: '/thu-tien/cong-no', label: 'Mở công nợ' } }),
  payment_cancel: (a) => ({ title: 'Hủy phiếu thu', fields: [['Số tiền phiếu thu', vnd(a.impact.amount)], ['Phân bổ đã thực hiện', arr(a.impact.allocations).map((x) => vnd(x.amount)).join(', ') || '—'], ['Phần dư thành số dư có', vnd(a.impact.credit)]], effects: [str(a.impact.effect, 'Tạo chứng từ đảo; công nợ tăng lại tương ứng.'), 'Phiếu gốc không bị xóa.'], link: { href: '/thu-tien/hoan-dieu-chinh', label: 'Mở phiếu thu' } }),
  expense: (a) => ({ title: 'Đề nghị chi', fields: [['Số tiền', vnd(a.impact.amount)], ['Khoản mục', str(a.impact.category, '—')]], effects: ['Duyệt chỉ cho phép chi; ghi nhận chi tiền thực tế là bước riêng.', 'Vượt hạn mức duyệt của cơ sở cần cấp cao hơn.'], link: { href: '/thu-chi', label: 'Mở thu chi và quỹ' } }),
  billing_run: (a) => { const c = obj(a.impact.counts); return { title: 'Duyệt kỳ thu học phí', fields: [['Kỳ thu', periodLabel(str(a.impact.periodKey))], ['Phải thu mới', vnd(a.impact.totalNew)], ['Khoản nháp tạo mới / cập nhật', `${num(c.created)} / ${num(c.updated)}`], ['Bỏ qua / dòng lỗi', `${num(c.skipped)} / ${num(c.errors)}`]], effects: ['Duyệt chuyển kỳ thu sang Đã duyệt; chưa phát hành, phụ huynh chưa thấy.', 'Dòng lỗi không tạo khoản phải thu.'], link: { href: '/hoc-phi/ky-thu', label: 'Mở kỳ thu để đối chiếu từng trẻ' } }; },
  payroll_run: (a) => { const t = obj(a.impact.totals); return { title: 'Duyệt bảng lương', fields: [['Kỳ lương', periodLabel(str(a.impact.periodKey))], ['Số nhân viên', num(a.impact.headcount)], ['Tổng thực lĩnh', vnd(t.net)], ['Tổng gộp', t.gross !== undefined ? vnd(t.gross) : '—']], effects: ['Duyệt không phải đã phát hành phiếu lương và cũng chưa phải đã chi trả.'], link: { href: '/cong-luong/bang-luong', label: 'Mở bảng lương' } }; },
  timesheet_reopen: (a) => ({ title: 'Mở lại bảng công đã khóa', fields: [['Kỳ công', periodLabel(str(a.impact.periodKey))], ['Lý do', str(a.impact.reason, '—')]], effects: [str(a.impact.effect, 'Bảng công về trạng thái mở; báo cáo kỳ trước được đánh dấu đã thay đổi.')], link: { href: '/cong-luong/cham-cong', label: 'Mở bảng chấm công' } }),
  notification: (a) => { const sc = obj(a.impact.scope); return { title: 'Duyệt thông báo', fields: [['Người nhận dự kiến', num(a.impact.recipients)], ['Phạm vi', `${str(sc.type)}${Array.isArray(sc.ids) && sc.ids.length ? ` (${sc.ids.length})` : ''}`], ['Yêu cầu xác nhận', a.impact.requireAck ? 'Có' : 'Không'], ['Loại', str(a.impact.category, '—')]], effects: ['Duyệt không tự gửi; người lập gửi ngay hoặc lên lịch sau khi duyệt.'], link: { href: '/ket-noi/thong-bao', label: 'Mở thông báo để đọc nội dung' } }; },
  stock_variance: (a) => ({ title: 'Chênh lệch kiểm kê kho', fields: [['Số mặt hàng chênh lệch', num(a.impact.varianceCount)], ['Giá trị chênh lệch', vnd(a.impact.totalVarianceValue)]], effects: ['Duyệt sẽ điều chỉnh tồn kho theo số kiểm kê và ghi nhận chênh lệch.'], link: { href: '/bep-kho/kho', label: 'Mở kho' } }),
  menu: (a) => ({ title: 'Duyệt thực đơn', fields: [['Ngày', str(a.impact.dayKey)], ['Trẻ có cảnh báo dị ứng', num(a.impact.allergyChildren)], ['Món thay thế đề xuất', num(a.impact.substitutions)]], effects: ['Sau khi duyệt, thực đơn có thể công bố cho phụ huynh.', 'Trẻ dị ứng cần có món thay thế trước khi công bố.'], link: { href: '/bep-kho/thuc-don', label: 'Mở thực đơn' } }),
};

function Detail({ a, canDecide, isMine, onClose, onChanged }: { a: Approval; canDecide: boolean; isMine: boolean; onClose: () => void; onChanged: () => void }) {
  const { org, tz } = useScope();
  const [dlg, setDlg] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const panel = (PANELS[a.type] ?? ((x: Approval): Panel => ({ title: TYPE_LABEL[x.type] ?? x.type, fields: [], effects: [] })))(a);
  const base = { orgId: org!.orgId, campusId: a.campusId || undefined };
  const pending = a.status === 'pending';
  return (
    <Drawer open title={`${TYPE_LABEL[a.type] ?? a.type}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="stack">
        <KV items={[['Trạng thái', <StatusBadge key="s" domain="approval" value={a.status} />], ['Người yêu cầu', a.requestedByName || a.requestedBy], ['Lúc', formatDateTime(a.at, tz)], ['Quyền duyệt', a.requiredPerm]]} />
        <p>{a.summary}</p>
        <Card title={panel.title}>
          <div className="stack">
            {panel.fields.length ? <KV items={panel.fields} /> : <p className="text-secondary">Không có số liệu chi tiết kèm theo.</p>}
            <Banner tone="info" title="Tác động nếu duyệt"><ul style={{ margin: 0, paddingLeft: 20 }}>{panel.effects.map((e) => <li key={e}>{e}</li>)}</ul></Banner>
            {panel.link ? <div><LinkButton href={panel.link.href} variant="secondary" size="sm">{panel.link.label}</LinkButton></div> : null}
          </div>
        </Card>
        {!pending ? <Banner tone={a.status === 'approved' ? 'success' : 'info'} title={`Đã xử lý${a.decidedByName ? ` bởi ${a.decidedByName}` : ''}`}>{a.decisionNote || 'Không có ý kiến.'}</Banner> : null}
        {pending && isMine ? <Banner tone="warning">Bạn là người lập yêu cầu này nên không tự duyệt được.</Banner> : null}
        {pending ? (
          <div className="row">
            {canDecide && !isMine ? <Button onClick={() => { setNote(''); setDlg('approve'); }}>Duyệt</Button> : null}
            {canDecide && !isMine ? <Button variant="destructiveOutline" onClick={() => { setNote(''); setDlg('reject'); }}>Từ chối</Button> : null}
            {isMine ? <Button variant="secondary" onClick={() => { setNote(''); setDlg('cancel'); }}>Hủy yêu cầu</Button> : null}
          </div>
        ) : null}
      </div>
      {dlg ? (
        <ActionDialog
          title={dlg === 'approve' ? `Duyệt: ${TYPE_LABEL[a.type] ?? a.type}` : dlg === 'reject' ? `Từ chối: ${TYPE_LABEL[a.type] ?? a.type}` : 'Hủy yêu cầu'}
          subject={a.summary}
          impact={dlg === 'approve' ? panel.effects : dlg === 'reject' ? ['Yêu cầu bị từ chối và không có thay đổi nào được áp dụng.', 'Lý do được gửi tới người yêu cầu.'] : ['Yêu cầu bị hủy; không áp dụng thay đổi.']}
          confirmLabel={dlg === 'approve' ? 'Duyệt yêu cầu' : dlg === 'reject' ? 'Từ chối yêu cầu' : 'Hủy yêu cầu'}
          tone={dlg === 'approve' ? 'primary' : 'destructive'}
          success={dlg === 'approve' ? 'Đã duyệt yêu cầu.' : dlg === 'reject' ? 'Đã từ chối yêu cầu.' : 'Đã hủy yêu cầu.'}
          validate={() => (dlg === 'reject' && !note.trim() ? 'Nhập lý do từ chối.' : null)}
          run={(opId) => dlg === 'cancel' ? callApi('approval.cancel', { ...base, opId, payload: { id: a.id, reason: note.trim() || undefined } }) : callApi('approval.decide', { ...base, opId, payload: { id: a.id, decision: dlg === 'approve' ? 'approved' : 'rejected', note: note.trim() || undefined } })}
          onClose={() => setDlg(null)}
          onDone={() => { onChanged(); onClose(); }}
        >
          <FormField name="note" label={dlg === 'reject' ? 'Lý do từ chối' : 'Ý kiến'} required={dlg === 'reject'}><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}
    </Drawer>
  );
}

/** W47 — Trung tâm phê duyệt. Mở từng yêu cầu để xem trước/sau và tác động; không có duyệt hàng loạt. */
export function W47Approvals(_props: ScreenProps) {
  void _props;
  const { org, campusId, can, campuses, tz } = useScope();
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const orgId = org?.orgId;
  const cid = campusId && campusId !== 'all' ? campusId : undefined;
  // Máy chủ lọc theo approvals.read + requiredPerm (rules không cho truy vấn list trực tiếp).
  const api = useApiQuery<{ items: Rec[] }>(orgId ? `approvals|${orgId}|${cid ?? 'all'}|${version}` : null, 'approval.list', () => ({ orgId, payload: { status: 'all', limit: 200, ...(cid ? { campusId: cid } : {}) } }));
  const data = useMemo<Approval[]>(() => (api.data?.items ?? []).map((d) => ({
    id: str(d.id), type: str(d.type), status: str(d.status, 'pending'), summary: str(d.summary), impact: obj(d.impact), requiredPerm: str(d.requiredPerm), requestedBy: str(d.requestedBy), requestedByName: str(d.requestedByName),
    campusId: str(d.campusId), at: tsMs(d.createdAt), decisionNote: str(d.decisionNote), decidedByName: str(d.decidedByName), refId: str(d.refId),
  })), [api.data]);
  const q = { data, status: api.status === 'ready' && data.length === 0 ? 'empty' as const : api.status, error: api.error, retry: api.retry };
  const [sel, setSel] = useState<string | null>(null);
  const rows = [...q.data].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.at - a.at);
  const cur = rows.find((r) => r.id === sel) ?? null;
  const cn = (id: string) => (id ? campuses.find((c) => c.id === id)?.name ?? id : 'Cấp tổ chức');
  const columns: Column<Approval>[] = [
    { key: 'type', header: 'Loại', value: (r) => TYPE_LABEL[r.type] ?? r.type, sortable: true, render: (r) => <strong>{TYPE_LABEL[r.type] ?? r.type}</strong> },
    { key: 'sum', header: 'Nội dung', value: (r) => r.summary },
    { key: 'campus', header: 'Cơ sở', value: (r) => cn(r.campusId), render: (r) => cn(r.campusId) },
    { key: 'by', header: 'Người yêu cầu', value: (r) => r.requestedByName },
    { key: 'at', header: 'Lúc', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, tz) },
    { key: 'st', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="approval" value={r.status} /> },
    { key: 'a', header: 'Thao tác', render: (r) => <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setSel(r.id); }}>Xem và xử lý</Button> },
  ];
  return (
    <div>
      <PageHeader title="Trung tâm phê duyệt" code="W47" description="Chỉ hiện yêu cầu bạn được quyền xử lý. Mở từng yêu cầu để xem chi tiết và tác động trước khi duyệt hoặc từ chối." />
      <DataTable caption="Yêu cầu phê duyệt" columns={columns} rows={rows} rowKey={(r) => r.id} status={q.status} error={q.error?.message} onRetry={q.retry} onRowClick={(r) => setSel(r.id)}
        searchText={(r) => `${TYPE_LABEL[r.type] ?? r.type} ${r.summary} ${r.requestedByName}`} searchPlaceholder="Tìm theo loại, nội dung, người yêu cầu"
        filters={[
          { key: 'st', label: 'Trạng thái', options: [{ value: 'pending', label: 'Chờ duyệt' }, { value: 'approved', label: 'Đã duyệt' }, { value: 'rejected', label: 'Từ chối' }, { value: 'cancelled', label: 'Đã hủy' }], predicate: (r, v) => r.status === v },
          { key: 'type', label: 'Loại', options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })), predicate: (r, v) => r.type === v },
        ]}
        emptyTitle="Không có yêu cầu nào" emptyDescription="Khi có yêu cầu cần bạn xử lý (công, phép, kỳ thu, hoàn tiền...) chúng sẽ hiện ở đây." />
      {cur ? <Detail key={cur.id} a={cur} canDecide={can(cur.requiredPerm, cur.campusId || null)} isMine={cur.requestedBy === user?.uid} onClose={() => setSel(null)} onChanged={() => setVersion((n) => n + 1)} /> : null}
    </div>
  );
}
