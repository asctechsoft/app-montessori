'use client';
import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { LinkButton, Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import type { ScreenProps } from '../registry';
import { KV, tsMs, str, useScopedQuery } from './parts/common';
import { CATEGORY_LABEL, NOTIF_STATUS, NotifActions, NotifBadge, scopeText, toNotif, type Notif } from './parts/notif';

interface Receipt { id: string; uid: string; readAt: number; ackAt: number; sentAt: number }

function Detail({ n, names, onClose }: { n: Notif; names: (id: string) => string; onClose: () => void }) {
  const { tz } = useScope();
  const rq = useScopedQuery<Receipt>('notificationReceipts', 'notify.read', (id, d) => ({ id, uid: str(d.uid), readAt: tsMs(d.readAt), ackAt: tsMs(d.ackAt), sentAt: tsMs(d.sentAt) }), { includeOrgWide: true, extra: [where('notifId', '==', n.id)], tag: n.id });
  const sent = rq.data.length;
  const read = rq.data.filter((r) => r.readAt > 0).length;
  const ack = rq.data.filter((r) => r.ackAt > 0).length;
  return (
    <Drawer open title={n.title} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="stack">
        <KV items={[
          ['Trạng thái', <NotifBadge key="s" value={n.status} />],
          ['Loại', CATEGORY_LABEL[n.category] ?? n.category],
          ['Phạm vi', scopeText(n, names)],
          ['Người lập', n.authorName || '—'],
          ['Lịch gửi', n.scheduledAt ? formatDateTime(n.scheduledAt, tz) : 'Gửi ngay'],
          ['Đã gửi lúc', n.sentAt ? formatDateTime(n.sentAt, tz) : '—'],
        ]} />
        {n.rejectNote ? <Banner tone="warning" title="Lý do bị từ chối">{n.rejectNote}</Banner> : null}
        <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
        {n.attachmentPaths.length ? <p className="text-small text-secondary">{n.attachmentPaths.length} tệp đính kèm.</p> : null}
        {n.status === 'sent' ? (
          rq.status === 'error' ? <Banner tone="error">{rq.error?.message}</Banner> : (
            <div className="grid-3">
              <Stat label="Đã gửi" value={rq.status === 'loading' ? '…' : sent || n.recipientCount} hint="Số người nhận" />
              <Stat label="Đã xem" value={rq.status === 'loading' ? '…' : read} hint={sent ? `${Math.round((read / sent) * 100)}% người nhận` : undefined} />
              <Stat label="Đã xác nhận" value={n.requireAck ? (rq.status === 'loading' ? '…' : ack) : 'Không yêu cầu'} hint={n.requireAck && sent ? `${Math.round((ack / sent) * 100)}% người nhận` : undefined} />
            </div>
          )
        ) : <p className="text-secondary">Chưa gửi nên chưa có số liệu đã xem hoặc đã xác nhận. Dự kiến người nhận: {n.recipientPreview || '—'}.</p>}
        <NotifActions n={n} />
      </div>
    </Drawer>
  );
}

/** W41 — Danh sách thông báo: gửi, đã xem, đã xác nhận tách riêng. */
export function W41Notifications(_props: ScreenProps) {
  void _props;
  const { can, campuses, tz } = useScope();
  const q = useScopedQuery<Notif>('notifications', 'notify.read', toNotif, { includeOrgWide: true });
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => [...q.data].sort((a, b) => (b.sentAt || b.scheduledAt) - (a.sentAt || a.scheduledAt) || a.title.localeCompare(b.title, 'vi')), [q.data]);
  const names = (id: string) => campuses.find((c) => c.id === id)?.name ?? id;
  const cur = rows.find((r) => r.id === sel) ?? null;
  const canSend = campuses.some((c) => can('notify.send', c.id)) || can('notify.send');
  const columns: Column<Notif>[] = [
    { key: 'title', header: 'Tiêu đề', value: (r) => r.title, sortable: true, render: (r) => <strong>{r.title}</strong> },
    { key: 'cat', header: 'Loại', value: (r) => r.category, render: (r) => <Badge tone={r.category === 'urgent' ? 'error' : 'neutral'}>{CATEGORY_LABEL[r.category] ?? r.category}</Badge> },
    { key: 'scope', header: 'Phạm vi', value: (r) => scopeText(r, names), render: (r) => scopeText(r, names) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <NotifBadge value={r.status} /> },
    { key: 'sent', header: 'Đã gửi', value: (r) => r.recipientCount, align: 'right', render: (r) => (r.status === 'sent' ? `${r.recipientCount} người` : '—') },
    { key: 'ack', header: 'Yêu cầu xác nhận', value: (r) => (r.requireAck ? 1 : 0), render: (r) => (r.requireAck ? 'Có' : 'Không') },
    { key: 'at', header: 'Gửi / lịch', value: (r) => r.sentAt || r.scheduledAt, sortable: true, render: (r) => (r.sentAt || r.scheduledAt ? formatDateTime(r.sentAt || r.scheduledAt, tz) : '—') },
  ];
  return (
    <div>
      <PageHeader title="Danh sách thông báo" code="W41" description="Mở một thông báo để xem riêng số người đã nhận, đã xem và đã xác nhận."
        actions={canSend ? <LinkButton href="/ket-noi/thong-bao/soan" icon="plus">Soạn thông báo</LinkButton> : undefined} />
      <DataTable caption="Danh sách thông báo" columns={columns} rows={rows} rowKey={(r) => r.id} status={q.status} error={q.error?.message} onRetry={q.retry} onRowClick={(r) => setSel(r.id)}
        searchText={(r) => r.title} searchPlaceholder="Tìm theo tiêu đề"
        filters={[{ key: 'status', label: 'Trạng thái', options: Object.entries(NOTIF_STATUS).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }]}
        emptyTitle="Chưa có thông báo nào" emptyDescription="Soạn thông báo đầu tiên để gửi tới phụ huynh hoặc nhân sự."
        emptyAction={canSend ? <LinkButton href="/ket-noi/thong-bao/soan" icon="plus">Soạn thông báo</LinkButton> : undefined} />
      {cur ? <Detail key={cur.id} n={cur} names={names} onClose={() => setSel(null)} /> : null}
    </div>
  );
}
