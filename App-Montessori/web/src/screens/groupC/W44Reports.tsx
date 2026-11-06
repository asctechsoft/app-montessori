'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { callApi } from '@/lib/api';
import { useScope } from '@/providers/ScopeProvider';
import { dayKey, formatDate, formatDateTime, formatVnd } from '@/lib/format';
import { PageHeader, Stat, EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DateInput, FormField, Select } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { ActionDialog, arr, num, obj, str, useScopedQuery, type Rec } from './parts/common';
import { downloadText } from './parts/csv';

const TYPES = [
  { value: 'overview', label: 'Tổng quan' }, { value: 'enrollment', label: 'Sĩ số và tuyển sinh' }, { value: 'attendance', label: 'Chuyên cần' },
  { value: 'handover', label: 'Bàn giao' }, { value: 'tuition', label: 'Học phí và công nợ' }, { value: 'cashflow', label: 'Dòng tiền' },
  { value: 'hr', label: 'Nhân sự và công' }, { value: 'ops', label: 'Vận hành bếp, kho' },
];
const LABELS: Record<string, string> = {
  enrolled: 'Sĩ số', capacity: 'Sức chứa', utilizationPct: 'Công suất', trial: 'Học thử', onLeave: 'Bảo lưu', withdrawn: 'Đã nghỉ', pending: 'Chờ nhập học', campuses: 'Số cơ sở',
  attendanceRatePct: 'Tỷ lệ chuyên cần', present: 'Có mặt', required: 'Buổi phải học', receivable: 'Phải thu', allocated: 'Đã thu', outstanding: 'Còn nợ', overdue: 'Quá hạn', credits: 'Số dư có',
  carriedDebt: 'Nợ chuyển kỳ', collectionRatePct: 'Tỷ lệ thu', netReceipts: 'Thực thu ròng', netCashAfterOutflows: 'Dòng tiền sau chi', expensesPaid: 'Đã chi', payrollPaid: 'Đã trả lương',
  activeStaff: 'Nhân sự đang làm', lockedPeriods: 'Kỳ công đã khóa', openPeriods: 'Kỳ công đang mở', lateMinutes: 'Phút đi muộn', incompleteDays: 'Ngày thiếu lượt', overtimeMinutes: 'Phút tăng ca', leaveDays: 'Ngày nghỉ',
  mealsExpected: 'Suất dự kiến', mealsLocked: 'Suất đã chốt', mealsServed: 'Suất đã phục vụ', mealsBillable: 'Suất tính tiền', mealsCancelled: 'Suất đã hủy',
};
const MONEY = /(receivable|allocated|outstanding|overdue|credits|carriedDebt|netReceipts|netCash|expensesPaid|payrollPaid|amount|balance|total|price|billed|discount|net)$/i;
const fmt = (k: string, v: unknown): string => {
  if (typeof v === 'number') return /Pct$/.test(k) ? `${v}%` : MONEY.test(k) && Number.isInteger(v) ? formatVnd(v) : v.toLocaleString('vi-VN');
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
interface Report { type: string; from: string; to: string; metrics: Rec; rows: Rec[]; definitions: Record<string, string>; generatedAt: string; truncated: boolean; rowCount: number }
const parse = (d: unknown): Report => {
  const o = obj(d);
  return { type: str(o.type), from: str(o.from), to: str(o.to), metrics: obj(o.metrics), rows: arr(o.rows), definitions: Object.fromEntries(Object.entries(obj(o.definitions)).map(([k, v]) => [k, str(v)])), generatedAt: str(o.generatedAt), truncated: o.truncated === true, rowCount: num(o.rowCount) };
};

/** W44 — Báo cáo quản trị: mở dữ liệu cấu thành, định nghĩa chỉ số, xuất CSV, so sánh các lần tạo báo cáo. */
export function W44Reports(_props: ScreenProps) {
  void _props;
  const { org, campusId, campus, can, canOrg, tz, years, yearId } = useScope();
  const [type, setType] = useState('overview');
  const [from, setFrom] = useState(() => `${dayKey(new Date(), tz).slice(0, 7)}-01`);
  const [to, setTo] = useState(() => dayKey(new Date(), tz));
  const [classId, setClassId] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [versions, setVersions] = useState<Report[]>([]);
  const lastKey = useRef('');
  const classes = useScopedQuery('classes', 'classes.read', (id, d) => ({ id, name: str(d.name, id) }));
  const cid = campusId && campusId !== 'all' ? campusId : undefined;
  const valid = !!from && !!to && from <= to;
  const key = valid && org ? `${org.orgId}|${cid ?? 'all'}|${type}|${from}|${to}|${classId}` : null;
  const q = useApiQuery<unknown>(key, 'report.get', () => ({ orgId: org?.orgId, campusId: cid, payload: { type, campusId: cid, from, to, classId: classId || undefined } }));
  const rep = useMemo(() => (q.data ? parse(q.data) : null), [q.data]);

  useEffect(() => {
    if (!rep || !key) return;
    const k = `${key}|${rep.generatedAt}`;
    if (lastKey.current === k) return;
    lastKey.current = k;
    setVersions((v) => [rep, ...v.filter((x) => x.generatedAt !== rep.generatedAt)].slice(0, 5));
  }, [rep, key]);
  useEffect(() => setVersions([]), [type, cid, from, to, classId]);

  const scalar = rep ? Object.entries(rep.metrics).filter(([, v]) => typeof v === 'number') : [];
  const prev = versions[1];
  const changed = rep && prev ? scalar.filter(([k, v]) => prev.metrics[k] !== v) : [];
  const cols = useMemo<Column<Rec>[]>(() => {
    const keys = [...new Set((rep?.rows ?? []).slice(0, 50).flatMap((r) => Object.keys(r)))];
    return keys.map((k) => ({ key: k, header: LABELS[k] ?? k, value: (r) => (typeof r[k] === 'number' || typeof r[k] === 'string' ? (r[k] as number | string) : fmt(k, r[k])), render: (r) => fmt(k, r[k]), align: typeof rep?.rows[0]?.[k] === 'number' ? 'right' : 'left' }));
  }, [rep]);
  const canExport = !!cid || canOrg('reports.export') ? can('reports.export', cid) || canOrg('reports.export') : false;
  const scopeLabel = cid ? campus?.name ?? cid : 'Tất cả cơ sở được phép';
  const yearName = years.find((y) => y.id === yearId)?.name;

  return (
    <div>
      <PageHeader title="Báo cáo quản trị" code="W44" description={`Phạm vi: ${scopeLabel}${yearName ? ` · năm học ${yearName}` : ''}. Chọn cơ sở và năm học ở thanh trên cùng.`}
        actions={canExport && rep ? <Button variant="secondary" onClick={() => setExportOpen(true)}>Xuất CSV</Button> : undefined} />
      <div className="stack">
        <Card title="Bộ lọc">
          <div className="grid-4">
            <FormField name="type" label="Loại báo cáo"><Select name="type" value={type} onValueChange={setType} options={TYPES} /></FormField>
            <FormField name="from" label="Từ ngày"><DateInput name="from" value={from} onValueChange={setFrom} /></FormField>
            <FormField name="to" label="Đến ngày" error={!valid && from && to ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : undefined}><DateInput name="to" value={to} onValueChange={setTo} /></FormField>
            {cid ? <FormField name="class" label="Lớp"><Select name="class" value={classId} onValueChange={setClassId} placeholder="Tất cả lớp" options={classes.data.map((c) => ({ value: c.id, label: c.name }))} /></FormField> : null}
          </div>
        </Card>
        {!valid ? <EmptyState title="Chọn khoảng thời gian hợp lệ" description="Nhập ngày bắt đầu và ngày kết thúc (tối đa 366 ngày)." /> : q.status === 'loading' ? <div className="stack"><Skeleton height={90} /><Skeleton height={200} /></div> : q.status === 'error' ? <ErrorState message={q.error?.message} onRetry={q.retry} /> : rep ? (
          <>
            <div className="grid-4">{scalar.map(([k, v]) => <Stat key={k} label={LABELS[k] ?? k} value={fmt(k, v)} hint={rep.definitions[k]} />)}</div>
            <Banner tone="info" title="Phiên bản báo cáo">
              Tạo lúc {formatDateTime(rep.generatedAt, tz)} cho {formatDate(rep.from)} – {formatDate(rep.to)}. Máy chủ tính lại theo dữ liệu hiện tại; khi kỳ đã khóa được mở lại, so sánh với lần tạo trước ở bên dưới để thấy chỉ số nào đổi.
              {prev ? <> {changed.length ? `Có ${changed.length} chỉ số khác lần tạo lúc ${formatDateTime(prev.generatedAt, tz)}: ${changed.map(([k]) => LABELS[k] ?? k).join(', ')}.` : `Không có chỉ số nào thay đổi so với lần tạo lúc ${formatDateTime(prev.generatedAt, tz)}.`}</> : null}
            </Banner>
            <Card title="Định nghĩa chỉ số">
              {Object.keys(rep.definitions).length === 0 ? <p className="text-secondary">Không có định nghĩa.</p> : <dl style={{ margin: 0 }}>{Object.entries(rep.definitions).map(([k, v]) => <div key={k} style={{ marginBottom: 'var(--space-2)' }}><dt><strong>{LABELS[k] ?? k}</strong></dt><dd style={{ margin: 0 }} className="text-secondary">{v}</dd></div>)}</dl>}
            </Card>
            <Card title="Dữ liệu cấu thành chỉ số" flush>
              {rep.truncated ? <Banner tone="warning">Chỉ hiển thị 5000 dòng đầu trong {rep.rowCount} dòng. Thu hẹp bộ lọc hoặc xuất CSV.</Banner> : null}
              <DataTable caption="Dữ liệu cấu thành" columns={cols} rows={rep.rows} rowKey={(r) => JSON.stringify(r)} status={rep.rows.length ? 'ready' : 'empty'} searchText={(r) => Object.values(r).map(String).join(' ')} searchPlaceholder="Tìm trong dữ liệu" emptyTitle="Không có dữ liệu cấu thành" emptyDescription="Không có dòng nào trong khoảng thời gian và phạm vi đã chọn." />
            </Card>
          </>
        ) : null}
      </div>
      {exportOpen && org ? (
        <ActionDialog
          title="Xuất báo cáo CSV"
          subject={`${TYPES.find((t) => t.value === type)?.label} · ${formatDate(from)} – ${formatDate(to)}`}
          impact={['Tạo tệp CSV gồm định nghĩa chỉ số và dữ liệu cấu thành theo bộ lọc hiện tại.', 'Việc xuất được ghi vào nhật ký thao tác (ai, lúc nào, bộ lọc nào).', 'Tệp có thể chứa dữ liệu của trẻ và phụ huynh; chỉ lưu và chia sẻ cho người có thẩm quyền.']}
          confirmLabel="Xuất CSV"
          success="Đã xuất báo cáo."
          run={async () => {
            const r = obj(await callApi('export.csv', { orgId: org.orgId, campusId: cid, payload: { report: type, filters: { campusId: cid, from, to, classId: classId || undefined } } }));
            downloadText(str(r.filename, 'bao-cao.csv'), str(r.csv), str(r.mimeType, 'text/csv;charset=utf-8'));
            return r;
          }}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
