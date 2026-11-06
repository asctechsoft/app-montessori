'use client';
import { useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import type { ScreenProps } from '../registry';
import { KV, obj, str, tsMs, useScopedQuery, type Rec } from './parts/common';

interface Log { id: string; at: number; actorName: string; actorUid: string; campusId: string; action: string; collection: string; docId: string; before: Rec; after: Rec; reason: string; result: string; requestId: string }
const RESULT: Record<string, { label: string; tone: 'success' | 'error' | 'warning' }> = { ok: { label: 'Thành công', tone: 'success' }, denied: { label: 'Bị từ chối', tone: 'warning' }, error: { label: 'Lỗi', tone: 'error' } };
const show = (v: unknown): string => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function LogDrawer({ log, campusName, tz, onClose }: { log: Log; campusName: string; tz: string; onClose: () => void }) {
  const keys = [...new Set([...Object.keys(log.before), ...Object.keys(log.after)])];
  return (
    <Drawer open title={log.action} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="stack">
        <KV items={[
          ['Thời điểm', formatDateTime(log.at, tz)], ['Người thực hiện', log.actorName || log.actorUid || 'Hệ thống'], ['Cơ sở', campusName || 'Cấp tổ chức'],
          ['Kết quả', <Badge key="r" tone={RESULT[log.result]?.tone ?? 'neutral'}>{RESULT[log.result]?.label ?? log.result}</Badge>], ['Đối tượng', `${log.collection} / ${log.docId}`], ['Mã yêu cầu', log.requestId || '—'],
        ]} />
        {log.reason ? <Banner tone="info" title="Lý do">{log.reason}</Banner> : null}
        {keys.length ? (
          <table className="dt">
            <caption className="sr-only">Giá trị trước và sau</caption>
            <thead><tr><th scope="col">Trường</th><th scope="col">Trước</th><th scope="col">Sau</th></tr></thead>
            <tbody>{keys.map((k) => <tr key={k}><td>{k}</td><td style={{ wordBreak: 'break-word' }}>{show(log.before[k])}</td><td style={{ wordBreak: 'break-word' }}>{show(log.after[k])}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-secondary">Thao tác này không ghi giá trị trước và sau.</p>}
      </div>
    </Drawer>
  );
}

/** W45 — Nhật ký thao tác và truy cập. Chỉ đọc: không có nút sửa hoặc xóa. */
export function W45AuditLog(_props: ScreenProps) {
  void _props;
  const { campuses, tz } = useScope();
  const q = useScopedQuery<Log>('auditLogs', 'audit.read', (id, d) => ({
    id, at: tsMs(d.at), actorName: str(d.actorName), actorUid: str(d.actorUid), campusId: str(d.campusId), action: str(d.action), collection: str(d.collection), docId: str(d.docId),
    before: obj(d.before), after: obj(d.after), reason: str(d.reason), result: str(d.result, 'ok'), requestId: str(d.requestId),
  }), { includeOrgWide: true, extra: [orderBy('at', 'desc'), limit(500)] });
  const [sel, setSel] = useState<string | null>(null);
  const cn = (id: string) => (id ? campuses.find((c) => c.id === id)?.name ?? id : '');
  const cur = q.data.find((l) => l.id === sel) ?? null;
  const collections = useMemo(() => [...new Set(q.data.map((l) => l.collection).filter(Boolean))].sort().map((v) => ({ value: v, label: v })), [q.data]);
  const columns: Column<Log>[] = [
    { key: 'at', header: 'Thời điểm', value: (r) => r.at, sortable: true, render: (r) => formatDateTime(r.at, tz) },
    { key: 'actor', header: 'Người thực hiện', value: (r) => r.actorName || r.actorUid, render: (r) => r.actorName || r.actorUid || 'Hệ thống' },
    { key: 'campus', header: 'Cơ sở', value: (r) => cn(r.campusId), render: (r) => cn(r.campusId) || 'Cấp tổ chức' },
    { key: 'action', header: 'Thao tác', value: (r) => r.action, sortable: true, render: (r) => <strong>{r.action}</strong> },
    { key: 'obj', header: 'Đối tượng', value: (r) => `${r.collection}/${r.docId}`, render: (r) => `${r.collection}${r.docId ? ` / ${r.docId}` : ''}` },
    { key: 'result', header: 'Kết quả', value: (r) => r.result, sortable: true, render: (r) => <Badge tone={RESULT[r.result]?.tone ?? 'neutral'}>{RESULT[r.result]?.label ?? r.result}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Nhật ký thao tác và truy cập" code="W45" description="Chỉ đọc. Hiển thị 500 bản ghi gần nhất trong phạm vi bạn được xem; không ai sửa hoặc xóa được nhật ký." />
      <DataTable caption="Nhật ký thao tác" columns={columns} rows={q.data} rowKey={(r) => r.id} status={q.status} error={q.error?.message} onRetry={q.retry} onRowClick={(r) => setSel(r.id)}
        searchText={(r) => `${r.action} ${r.actorName} ${r.collection} ${r.docId} ${r.reason}`} searchPlaceholder="Tìm theo thao tác, người, đối tượng"
        filters={[
          { key: 'res', label: 'Kết quả', options: Object.entries(RESULT).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.result === v },
          { key: 'col', label: 'Đối tượng', options: collections, predicate: (r, v) => r.collection === v },
          { key: 'cam', label: 'Cơ sở', options: campuses.map((c) => ({ value: c.id, label: c.name })), predicate: (r, v) => r.campusId === v },
        ]}
        emptyTitle="Chưa có nhật ký" emptyDescription="Mỗi thao tác ghi dữ liệu, xuất hồ sơ hoặc truy cập nhạy cảm sẽ được ghi lại ở đây." />
      {cur ? <LogDrawer log={cur} campusName={cn(cur.campusId)} tz={tz} onClose={() => setSel(null)} /> : null}
    </div>
  );
}
