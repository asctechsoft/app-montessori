'use client';
import { useState } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FormField, Input, Textarea, Checkbox } from '@/components/ui/Fields';
import type { Tone } from '@/lib/status';
import { ActionDialog, num, obj, str, strArr, tsMs } from './common';

export interface Notif {
  id: string; title: string; body: string; category: string; status: string; campusId: string;
  scopeType: string; scopeIds: string[]; requireAck: boolean; scheduledAt: number; sentAt: number;
  recipientCount: number; recipientPreview: number; authorName: string; attachmentPaths: string[]; version: number; rejectNote: string;
}
export const toNotif = (id: string, d: DocumentData): Notif => {
  const sc = obj(d.scope);
  return {
    id, title: str(d.title, id), body: str(d.body), category: str(d.category, 'general'), status: str(d.status, 'draft'), campusId: str(d.campusId),
    scopeType: str(sc.type), scopeIds: strArr(sc.ids), requireAck: d.requireAck === true, scheduledAt: tsMs(d.scheduledAt), sentAt: tsMs(d.sentAt),
    recipientCount: num(d.recipientCount), recipientPreview: num(d.recipientPreview), authorName: str(d.authorName), attachmentPaths: strArr(d.attachmentPaths),
    version: num(d.version), rejectNote: str(d.rejectNote),
  };
};
export const CATEGORY_LABEL: Record<string, string> = { general: 'Thông báo chung', event: 'Sự kiện', urgent: 'Khẩn', finance: 'Học phí', health: 'Sức khỏe', menu: 'Thực đơn' };
export const NOTIF_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Bản nháp', tone: 'neutral' },
  pending_approval: { label: 'Chờ duyệt', tone: 'warning' },
  approved: { label: 'Đã duyệt, chưa gửi', tone: 'info' },
  scheduled: { label: 'Đã lên lịch', tone: 'info' },
  sending: { label: 'Đang gửi', tone: 'warning' },
  sent: { label: 'Đã gửi', tone: 'success' },
  failed: { label: 'Gửi lỗi', tone: 'error' },
};
export function NotifBadge({ value }: { value: string }) {
  const s = NOTIF_STATUS[value] ?? { label: value, tone: 'neutral' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export const scopeText = (n: { scopeType: string; scopeIds: string[] }, names: (id: string) => string): string =>
  n.scopeType === 'org' ? 'Toàn tổ chức' : n.scopeType === 'campus' ? `Cơ sở: ${n.scopeIds.map(names).join(', ')}` : n.scopeType === 'class' ? `Lớp: ${n.scopeIds.map(names).join(', ')}` : n.scopeType === 'users' ? `${n.scopeIds.length} người được chọn` : 'Chưa chọn phạm vi';

/** Nút gửi duyệt / duyệt / gửi hoặc lên lịch cho một thông báo, mỗi thao tác có hộp thoại xem tác động. */
export function NotifActions({ n, onChanged }: { n: Notif; onChanged?: () => void }) {
  const { org, campusId, can, campuses } = useScope();
  const [k, setK] = useState<'submit' | 'approve' | 'reject' | 'send' | null>(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [ack, setAck] = useState(n.requireAck);
  if (!org) return null;
  const cid = n.campusId || (campusId && campusId !== 'all' ? campusId : campuses[0]?.id) || '';
  const base = { orgId: org.orgId, campusId: cid || undefined };
  const send = can('notify.send', n.campusId || cid);
  const approve = can('notify.approve', n.campusId || cid);
  const preview = n.recipientPreview || n.recipientCount;
  const close = () => setK(null);
  return (
    <div className="row">
      {n.status === 'draft' && send ? <Button size="sm" onClick={() => setK('submit')}>Xem tác động và gửi duyệt</Button> : null}
      {n.status === 'pending_approval' && approve ? <Button size="sm" onClick={() => setK('approve')}>Duyệt</Button> : null}
      {n.status === 'pending_approval' && approve ? <Button size="sm" variant="secondary" onClick={() => { setNote(''); setK('reject'); }}>Từ chối</Button> : null}
      {n.status === 'approved' && send ? <Button size="sm" onClick={() => setK('send')}>Gửi hoặc lên lịch</Button> : null}
      {k === 'submit' ? (
        <ActionDialog
          title="Gửi duyệt thông báo"
          subject={n.title}
          impact={['Máy chủ tính danh sách người nhận theo phạm vi đã chọn và kiểm tra quyền gửi của bạn.', approve ? 'Bạn có quyền duyệt nên thông báo được duyệt ngay (chưa gửi).' : 'Thông báo chuyển sang Chờ duyệt và hiện trong Trung tâm phê duyệt.', 'Chưa có thông báo nào được gửi tới người nhận ở bước này.']}
          confirmLabel="Gửi duyệt"
          success="Đã xử lý yêu cầu duyệt thông báo."
          run={(opId) => callApi('notification.submit', { ...base, opId, payload: { id: n.id } })}
          onClose={close}
          onDone={onChanged}
        />
      ) : null}
      {k === 'approve' ? (
        <ActionDialog
          title="Duyệt thông báo"
          subject={n.title}
          impact={[`Thông báo dự kiến tới ${preview} người nhận.`, 'Duyệt không tự gửi; sau khi duyệt cần gửi ngay hoặc lên lịch.', 'Người lập không được tự duyệt.']}
          confirmLabel="Duyệt thông báo"
          success="Đã duyệt thông báo."
          run={(opId) => callApi('notification.approve', { ...base, opId, payload: { id: n.id, decision: 'approved', note: note.trim() || undefined } })}
          onClose={close}
          onDone={onChanged}
        >
          <FormField name="note" label="Ý kiến"><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}
      {k === 'reject' ? (
        <ActionDialog
          title="Từ chối thông báo"
          subject={n.title}
          tone="destructive"
          impact={['Thông báo quay về bản nháp kèm lý do để người lập sửa.', 'Không gửi tới ai.']}
          confirmLabel="Từ chối thông báo"
          success="Đã từ chối thông báo."
          validate={() => (note.trim() ? null : 'Nhập lý do từ chối.')}
          run={(opId) => callApi('notification.approve', { ...base, opId, payload: { id: n.id, decision: 'rejected', note: note.trim() } })}
          onClose={close}
          onDone={onChanged}
        >
          <FormField name="note" label="Lý do" required><Textarea name="note" value={note} onValueChange={setNote} /></FormField>
        </ActionDialog>
      ) : null}
      {k === 'send' ? (
        <ActionDialog
          title={when ? 'Lên lịch gửi thông báo' : 'Gửi thông báo ngay'}
          subject={n.title}
          impact={[
            `Gửi tới ${preview} người nhận theo phạm vi đã duyệt (danh sách chốt lại tại thời điểm gửi).`,
            when ? `Sẽ gửi lúc ${formatDateTime(new Date(when))}.` : 'Gửi ngay sau khi xác nhận; không thu hồi được.',
            ack ? 'Yêu cầu người nhận xác nhận; theo dõi riêng đã xem và đã xác nhận.' : 'Không yêu cầu xác nhận.',
            'Đẩy thông báo chỉ báo có cập nhật, không kèm nội dung nhạy cảm.',
          ]}
          confirmLabel={when ? 'Lên lịch gửi' : 'Gửi ngay'}
          success={when ? 'Đã lên lịch gửi.' : 'Đã gửi thông báo.'}
          validate={() => (when && new Date(when).getTime() <= Date.now() ? 'Thời điểm gửi phải ở tương lai, hoặc để trống để gửi ngay.' : null)}
          run={(opId) => callApi('notification.send', { ...base, opId, payload: { id: n.id, requireAck: ack, at: when ? new Date(when).toISOString() : undefined } })}
          onClose={close}
          onDone={onChanged}
        >
          <FormField name="when" label="Lịch gửi (để trống = gửi ngay)"><Input name="when" type="datetime-local" value={when} onValueChange={setWhen} /></FormField>
          <Checkbox checked={ack} onChange={setAck}>Yêu cầu người nhận xác nhận</Checkbox>
        </ActionDialog>
      ) : null}
    </div>
  );
}
