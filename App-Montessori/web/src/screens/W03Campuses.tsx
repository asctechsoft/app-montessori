'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi, type ApiError } from '@/lib/api';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useScope } from '@/providers/ScopeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { STATUS_MAPS } from '@/lib/status';
import { PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FormField, Select, Textarea } from '@/components/ui/Fields';
import { Banner } from '@/components/ui/Banner';
import { useToast } from '@/components/ui/Toast';

interface CampusRow {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  status: string;
  openTime: string;
  closeTime: string;
  version?: number;
}

const toRow = (id: string, d: Record<string, unknown>): CampusRow => ({
  id,
  code: String(d.code ?? id),
  name: String(d.name ?? id),
  address: String(d.address ?? ''),
  phone: String(d.phone ?? ''),
  status: String(d.status ?? 'preparing'),
  openTime: String(d.openTime ?? ''),
  closeTime: String(d.closeTime ?? ''),
  version: typeof d.version === 'number' ? d.version : undefined,
});

const STATUS_OPTIONS = Object.entries(STATUS_MAPS.campus).map(([value, s]) => ({ value, label: s.label }));

interface Blockers {
  children?: { childId: string; fullName?: string }[];
  receivables?: unknown[];
  deposits?: unknown[];
}

function StatusDialog({ campus, onClose }: { campus: CampusRow | null; onClose: () => void }) {
  const { org } = useScope();
  const { refresh } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const action = useAsyncAction(async (opId: string) => {
    await callApi('campus.setStatus', { orgId: org!.orgId, opId, payload: { campusId: campus!.id, status, reason: reason.trim(), expectedVersion: campus!.version } });
    return true as const;
  });

  const blockers = (action.error?.details?.blockers ?? null) as Blockers | null;
  const label = STATUS_MAPS.campus[status as keyof typeof STATUS_MAPS.campus]?.label ?? '';
  const impact = [
    `Trạng thái cơ sở đổi từ «${STATUS_MAPS.campus[campus?.status as keyof typeof STATUS_MAPS.campus]?.label ?? campus?.status}» sang «${label}».`,
    'Thay đổi được ghi vào nhật ký thao tác kèm lý do và người thực hiện.',
    ...(status === 'closed'
      ? ['Máy chủ chỉ cho đóng khi không còn trẻ đang học, công nợ hoặc tiền đặt cọc; nếu còn sẽ liệt kê để bạn xử lý trước.', 'Dữ liệu của cơ sở không bị xóa.']
      : ['Dữ liệu của cơ sở được giữ nguyên.']),
  ];

  if (!campus) return null;
  const error: ApiError | null = action.error;
  return (
    <ConfirmDialog
      open
      title={`Đổi trạng thái cơ sở ${campus.name}`}
      subject={`${campus.code} · ${campus.name}`}
      impact={status ? impact : ['Chọn trạng thái mới để xem tác động.']}
      confirmLabel={status ? `Chuyển sang ${label}` : 'Đổi trạng thái'}
      tone={status === 'closed' ? 'destructive' : 'primary'}
      busy={action.busy}
      error={error ? error.message : null}
      onCancel={onClose}
      onConfirm={async () => {
        if (!status || status === campus.status) return setReasonError('Chọn trạng thái khác với trạng thái hiện tại.');
        if (!reason.trim()) return setReasonError('Nhập lý do đổi trạng thái.');
        setReasonError('');
        const ok = await action.run();
        if (ok) {
          toast.success('Đã đổi trạng thái cơ sở ' + campus.name + '.');
          void refresh();
          onClose();
        }
      }}
    >
      <FormField name="campus-status" label="Trạng thái mới" required>
        <Select name="campus-status" value={status} onValueChange={setStatus} placeholder="Chọn trạng thái" options={STATUS_OPTIONS.filter((o) => o.value !== campus.status)} />
      </FormField>
      <FormField name="campus-reason" label="Lý do" required error={reasonError || undefined}>
        <Textarea name="campus-reason" value={reason} onValueChange={setReason} />
      </FormField>
      {blockers ? (
        <Banner tone="warning" title="Chưa thể đóng cơ sở. Cần xử lý trước:">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {blockers.children?.length ? <li>{blockers.children.length} trẻ đang học</li> : null}
            {blockers.receivables?.length ? <li>{blockers.receivables.length} khoản công nợ còn lại</li> : null}
            {blockers.deposits?.length ? <li>{blockers.deposits.length} khoản đặt cọc đang giữ</li> : null}
          </ul>
        </Banner>
      ) : null}
    </ConfirmDialog>
  );
}

/** W03 — Danh sách cơ sở (đọc Firestore orgs/{orgId}/campuses). */
export function W03Campuses() {
  const { org, canOrg, campuses: mine, selectCampus } = useScope();
  const router = useRouter();
  const orgWide = canOrg('campus.read');
  const [statusFor, setStatusFor] = useState<CampusRow | null>(null);

  const q = useFirestoreQuery<CampusRow>(
    org && orgWide ? `campuses|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'campuses'),
    (id, d) => toRow(id, d),
  );

  // Người chỉ có quyền ở vài cơ sở: Firestore rules không cho liệt kê cả tập; dùng danh sách máy chủ đã lọc theo quyền.
  const rows = useMemo<CampusRow[]>(
    () => (orgWide ? q.data : mine.map((c) => toRow(c.id, c as unknown as Record<string, unknown>))),
    [orgWide, q.data, mine],
  );
  const status = orgWide ? q.status : mine.length === 0 ? 'empty' : 'ready';

  const columns: Column<CampusRow>[] = [
    { key: 'code', header: 'Mã', value: (r) => r.code, sortable: true, width: 100 },
    { key: 'name', header: 'Tên cơ sở', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'address', header: 'Địa chỉ', value: (r) => r.address },
    { key: 'hours', header: 'Giờ hoạt động', value: (r) => r.openTime, render: (r) => (r.openTime && r.closeTime ? `${r.openTime}–${r.closeTime}` : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="campus" value={r.status} /> },
    {
      key: 'actions',
      header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button
            size="sm"
            variant="tertiary"
            onClick={async (e) => {
              e.stopPropagation();
              if (await selectCampus(r.id)) router.push('/van-hanh');
            }}
          >
            Vận hành cơ sở
          </Button>
          {canOrg('campus.manage') ? (
            <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setStatusFor(r); }}>
              Đổi trạng thái
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const filters: TableFilter<CampusRow>[] = [
    { key: 'status', label: 'Trạng thái', options: STATUS_OPTIONS, predicate: (r, v) => r.status === v },
  ];

  return (
    <div>
      <PageHeader
        title="Danh sách cơ sở"
        code="W03"
        description="Các cơ sở thuộc tổ chức mà bạn được phép xem."
        actions={canOrg('campus.manage') ? <LinkButton href="/co-so/moi" icon="plus">Tạo cơ sở mới</LinkButton> : undefined}
      />
      <DataTable
        caption="Danh sách cơ sở"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        error={q.error?.message}
        onRetry={q.retry}
        searchText={(r) => `${r.code} ${r.name} ${r.address}`}
        searchPlaceholder="Tìm theo mã, tên, địa chỉ"
        filters={filters}
        emptyTitle="Chưa có cơ sở nào"
        emptyDescription="Tạo cơ sở đầu tiên để bắt đầu thiết lập năm học, lớp học và mời hiệu trưởng."
        emptyAction={canOrg('campus.manage') ? <LinkButton href="/co-so/moi" icon="plus">Tạo cơ sở mới</LinkButton> : undefined}
      />
      <StatusDialog key={statusFor?.id ?? 'none'} campus={statusFor} onClose={() => setStatusFor(null)} />
    </div>
  );
}
