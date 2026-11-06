'use client';
import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { callApi, toApiError } from '@/lib/api';
import { dayKey, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DateInput, FormField } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { dateOf, IN_SCHOOL, Kv, num, obj, objs, Progress, str, strs, statusOf, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, type Doc } from './parts/kit';

interface LogDoc { id: string; childId: string; classId: string; status: string; filled: number; photos: number; revision: number; edited: boolean; publishedAt: Date | null; raw: Doc }
interface Row {
  key: string; childId: string; name: string; classId: string; className: string; log: LogDoc | null; pct: number; photoNoConsent: boolean;
}

const FIELDS: [keyof Doc, string][] = [['meals', 'Ăn uống'], ['sleep', 'Giấc ngủ'], ['hygiene', 'Vệ sinh'], ['mood', 'Tâm trạng'], ['activities', 'Hoạt động'], ['note', 'Nhận xét']];
const isFilled = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v as object).length > 0 : typeof v === 'string' ? v.trim() !== '' : false);

const mapLog = (id: string, d: Doc): LogDoc => ({
  id, childId: str(d.childId), classId: str(d.classId), status: str(d.status, 'draft'), filled: FIELDS.filter(([k]) => isFilled(d[k])).length, photos: strs(d.photoPaths).length,
  revision: num(d.revision) ?? 1, edited: d.editedAfterPublish === true, publishedAt: dateOf(d.publishedAt), raw: d,
});

const fmt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v ? JSON.stringify(v) : '');
const lineOf = (o: Doc): string => Object.entries(o).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ');

interface Result { classId: string; className: string; published: number; skipped: { childId: string; reason: string }[]; already: number; error?: string }

/** W18 — Kiểm tra nhật ký chăm sóc theo ngày: mức hoàn thành từng trẻ, bản nháp/đã xuất bản, xuất bản có xem tác động. */
export function W18CareLogs() {
  const { orgId, cid, tz, can } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const [day, setDay] = useState(today);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const dk = valid ? day : today;
  const [view, setView] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<{ keys: string[]; clear: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [progress, setProgress] = useState('');

  const children = useChildrenQ();
  const classes = useClassesQ();
  const logs = useCampusCol('dailyLogs', mapLog, { where: [where('dayKey', '==', dk)], keyExtra: dk, enabled: valid });

  const rows = useMemo<Row[]>(() => {
    const by = new Map(logs.data.map((l) => [l.childId, l]));
    return children.data.filter((c) => c.classId && IN_SCHOOL.includes(c.status)).map((c) => {
      const log = by.get(c.id) ?? null;
      return { key: c.id, childId: c.id, name: c.fullName, classId: c.classId!, className: classes.byId.get(c.classId!)?.name ?? '', log, pct: log ? (log.filled / FIELDS.length) * 100 : 0, photoNoConsent: !!log && log.photos > 0 && !c.photoConsent };
    });
  }, [children.data, logs.data, classes.byId]);

  const drafts = rows.filter((r) => r.log?.status === 'draft');
  const published = rows.filter((r) => r.log?.status === 'published').length;
  const none = rows.filter((r) => !r.log).length;
  const loading = logs.status === 'loading' || children.status === 'loading';
  const status = logs.status === 'error' || children.status === 'error' ? 'error' : loading ? 'loading' : statusOf('ready', rows);
  const canPublish = can('care.publish');

  const selected = confirm ? rows.filter((r) => confirm.keys.includes(r.key) && r.log?.status === 'draft') : [];
  const photoWarn = selected.filter((r) => r.photoNoConsent);

  const publish = async () => {
    if (!confirm) return;
    setBusy(true);
    setResults(null);
    const groups = new Map<string, Row[]>();
    for (const r of selected) groups.set(r.classId, [...(groups.get(r.classId) ?? []), r]);
    const out: Result[] = [];
    let i = 0;
    for (const [classId, rs] of groups) {
      i++;
      setProgress(`Đang xuất bản lớp ${rs[0].className} (${i}/${groups.size})...`);
      try {
        const res = await callApi<Record<string, unknown>>('dailyLog.publish', { orgId, campusId: cid ?? undefined, payload: { classId, dayKey: dk, childIds: rs.map((r) => r.childId) } });
        out.push({ classId, className: rs[0].className, published: strs(res.published).length, skipped: objs(res.skipped).map((s) => ({ childId: str(s.childId), reason: str(s.reason) })), already: num(res.alreadyPublished) ?? 0 });
      } catch (e) {
        const ae = toApiError(e);
        out.push({ classId, className: rs[0].className, published: 0, skipped: [], already: 0, error: ae.message });
      }
    }
    setBusy(false);
    setProgress('');
    setResults(out);
    confirm.clear();
    setConfirm(null);
    const n = out.reduce((s, r) => s + r.published, 0);
    if (n > 0) toast.success(`Đã xuất bản ${n} nhật ký.`);
  };

  const columns: Column<Row>[] = [
    { key: 'child', header: 'Trẻ', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'class', header: 'Lớp', value: (r) => r.className, sortable: true },
    { key: 'status', header: 'Trạng thái', value: (r) => r.log?.status ?? 'none', sortable: true, render: (r) => (!r.log ? <Badge tone="error">Chưa có nhật ký</Badge> : r.log.status === 'published' ? <Badge tone="success">Đã xuất bản{r.log.edited ? ' (đã sửa sau xuất bản)' : ''}</Badge> : <Badge tone="warning">Bản nháp</Badge>) },
    { key: 'pct', header: 'Mức hoàn thành', value: (r) => r.pct, sortable: true, render: (r) => <Progress value={r.pct} label={`Mức hoàn thành nhật ký của ${r.name}`} /> },
    { key: 'sections', header: 'Còn thiếu', render: (r) => (r.log ? FIELDS.filter(([k]) => !isFilled(r.log!.raw[k])).map(([, l]) => l).join(', ') || 'Đủ' : FIELDS.map(([, l]) => l).join(', ')) },
    { key: 'photo', header: 'Ảnh', render: (r) => (r.log ? (r.photoNoConsent ? <Badge tone="error">{r.log.photos} ảnh, chưa có đồng ý</Badge> : r.log.photos) : '—') },
    { key: 'act', header: 'Thao tác', render: (r) => (r.log ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setView(r); }}>Xem nội dung</Button> : null) },
  ];
  const filters: TableFilter<Row>[] = [
    { key: 'class', label: 'Lớp', options: classes.data.map((c) => ({ value: c.id, label: c.name })), predicate: (r, v) => r.classId === v },
    { key: 'status', label: 'Trạng thái', options: [{ value: 'none', label: 'Chưa có nhật ký' }, { value: 'draft', label: 'Bản nháp' }, { value: 'published', label: 'Đã xuất bản' }], predicate: (r, v) => (r.log?.status ?? 'none') === v },
  ];

  const raw = view?.log?.raw ?? {};
  return (
    <div className="stack">
      <PageHeader title="Kiểm tra nhật ký chăm sóc" code="W18" description="Theo dõi mức hoàn thành nhật ký từng trẻ. Bản nháp chưa hiện trên app phụ huynh." />
      <div className="row"><FormField name="care-day" label="Ngày" error={valid ? undefined : 'Nhập ngày hợp lệ.'}><DateInput name="care-day" value={day} onValueChange={setDay} /></FormField>{day !== today ? <Button variant="secondary" onClick={() => setDay(today)}>Về hôm nay</Button> : null}</div>
      <div className="grid-4">
        <Stat label="Trẻ cần nhật ký" value={rows.length} />
        <Stat label="Đã xuất bản" value={published} tone="success" />
        <Stat label="Bản nháp" value={drafts.length} tone={drafts.length ? 'warning' : undefined} />
        <Stat label="Chưa có nhật ký" value={none} tone={none ? 'error' : undefined} />
      </div>
      {progress ? <Banner tone="info">{progress}</Banner> : null}
      {results ? (
        <Banner tone={results.some((r) => r.error || r.skipped.length) ? 'warning' : 'success'} title="Kết quả xuất bản từng lớp">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {results.map((r) => (
              <li key={r.classId}>{r.className}: {r.error ? `lỗi — ${r.error}` : `đã xuất bản ${r.published}${r.already ? `, ${r.already} đã xuất bản trước đó` : ''}${r.skipped.length ? `, bỏ qua ${r.skipped.length}` : ''}`}
                {r.skipped.map((s) => <div key={s.childId} className="text-caption">{rows.find((x) => x.childId === s.childId)?.name ?? s.childId}: {s.reason}</div>)}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <DataTable
        caption={`Nhật ký chăm sóc ngày ${formatDate(dk)}`}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        error={logs.error?.message ?? children.error?.message}
        onRetry={() => { logs.retry(); children.retry(); }}
        searchText={(r) => `${r.name} ${r.className}`}
        searchPlaceholder="Tìm theo tên trẻ, lớp"
        filters={filters}
        selectable={canPublish}
        bulkActions={canPublish ? (keys, clear) => (
          <Button size="sm" onClick={() => setConfirm({ keys, clear })} disabled={!keys.some((k) => rows.find((r) => r.key === k)?.log?.status === 'draft')}>Xuất bản bản nháp đã chọn</Button>
        ) : undefined}
        emptyTitle="Chưa có trẻ đang học"
        emptyDescription="Khi có trẻ đang học trong lớp, danh sách nhật ký của từng trẻ sẽ hiển thị tại đây."
      />
      <ConfirmDialog
        open={!!confirm}
        title="Xuất bản nhật ký chăm sóc"
        subject={`${selected.length} nhật ký ngày ${formatDate(dk)}`}
        impact={[
          `Phụ huynh của ${selected.length} trẻ nhìn thấy nhật ký trên app và nhận thông báo.`,
          'Chỉ xuất bản bản nháp đã chọn; bản đã xuất bản và trẻ chưa có nhật ký được bỏ qua.',
          photoWarn.length ? `${photoWarn.length} nhật ký có ảnh nhưng chưa có đồng ý hình ảnh sẽ bị máy chủ bỏ qua: ${photoWarn.map((r) => r.name).join(', ')}.` : 'Ảnh đính kèm được kiểm tra đồng ý sử dụng hình ảnh của từng bé.',
          'Sau khi xuất bản, sửa nhật ký sẽ được đánh dấu «đã sửa sau xuất bản».',
        ]}
        confirmLabel={`Xuất bản ${selected.length} nhật ký`}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (selected.length === 0) { setConfirm(null); return; } void publish(); }}
      />
      <Drawer open={!!view} title={view ? `Nhật ký của ${view.name}` : ''} onClose={() => setView(null)}>
        {view?.log ? (
          <div className="stack">
            <Kv items={[
              ['Ngày', formatDate(dk)], ['Trạng thái', view.log.status === 'published' ? `Đã xuất bản ${formatDateTime(view.log.publishedAt)}` : 'Bản nháp (chưa hiện cho phụ huynh)'], ['Phiên bản nội dung', String(view.log.revision)],
              ['Ăn uống', objs(raw.meals).map(lineOf).join(' | ')], ['Giấc ngủ', objs(raw.sleep).map(lineOf).join(' | ')], ['Vệ sinh', lineOf(obj(raw.hygiene))],
              ['Tâm trạng', str(raw.mood)], ['Hoạt động', strs(raw.activities).join(', ')], ['Nhận xét', str(raw.note)], ['Ảnh đính kèm', String(view.log.photos)],
            ]} />
            {view.photoNoConsent ? <Banner tone="error">Nhật ký có ảnh nhưng bé chưa có đồng ý sử dụng hình ảnh. Kiểm tra trước khi xuất bản.</Banner> : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

