'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDateTime } from '@/lib/format';
import { PageHeader, Stat, EmptyState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { Tabs } from '@/components/ui/Tabs';
import type { ScreenProps } from '../registry';
import { ActionDialog, arr, num, obj, str, tsMs, useScopedQuery } from './parts/common';
import { csvToObjects, downloadText, readFileText, toCsv } from './parts/csv';

const KINDS: Record<string, { label: string; headers: string[]; note: string }> = {
  children: { label: 'Trẻ (kèm một phụ huynh)', headers: ['code', 'fullName', 'dob', 'gender', 'classCode', 'startDate', 'guardianName', 'guardianPhone', 'guardianRelation'], note: 'dob, startDate dạng yyyy-MM-dd; gender: male | female | other. Mã trẻ khác số điện thoại. Hệ thống không tự ghép hồ sơ trùng theo tên.' },
  staff: { label: 'Nhân sự', headers: ['code', 'fullName', 'phone', 'email', 'title', 'startDate', 'campusCode'], note: 'startDate dạng yyyy-MM-dd. Mã nhân viên không trùng.' },
  guardians: { label: 'Phụ huynh của trẻ đã có', headers: ['childCode', 'name', 'phone', 'email', 'relation', 'notify', 'viewFees', 'pickup'], note: 'childCode là mã trẻ ở cơ sở này; ghép theo mã, không theo tên. notify/viewFees/pickup: 1 hoặc 0.' },
};
interface RowRes { line: number; ok: boolean; errors: { field: string; message: string }[]; warnings: string[] }
interface Validated { jobId: string; kind: string; total: number; valid: number; invalid: number; rows: RowRes[]; errorCsv: string }
interface Job { id: string; kind: string; status: string; fileName: string; total: number; valid: number; invalid: number; at: number }
interface Backup { id: string; kind: string; status: string; startedAt: number; finishedAt: number; sizeBytes: number; location: string; exportName: string; lastVerifiedAt: number; lastVerifyResult: string; note: string }
const JOB_STATUS: Record<string, string> = { validated: 'Đã kiểm tra, chờ ghi', committing: 'Đang ghi', committed: 'Đã ghi' };

function ImportPanel() {
  const { org, campusId, can, tz } = useScope();
  const cid = campusId && campusId !== 'all' ? campusId : '';
  const [kind, setKind] = useState('children');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileErr, setFileErr] = useState('');
  const [val, setVal] = useState<Validated | null>(null);
  const [skip, setSkip] = useState(false);
  const [dups, setDups] = useState(false);
  const [commit, setCommit] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; errors: number; results: { line: number; result: string; message: string }[] } | null>(null);
  const jobs = useScopedQuery<Job>('importJobs', 'import.write', (id, d) => ({ id, kind: str(d.kind), status: str(d.status), fileName: str(d.fileName), total: num(d.total), valid: num(d.valid), invalid: num(d.invalid), at: tsMs(d.createdAt) }));
  const parsed = useMemo(() => (text.trim() ? csvToObjects(text) : null), [text]);
  const spec = KINDS[kind];
  const missing = parsed ? spec.headers.filter((h) => !parsed.headers.includes(h)).slice(0, 3) : [];
  const check = useAsyncAction(async (opId: string) => {
    void opId;
    const r = obj(await callApi('import.validate', { orgId: org!.orgId, campusId: cid, payload: { campusId: cid, kind, fileName: fileName || undefined, rows: parsed!.rows } }));
    setVal({ jobId: str(r.jobId), kind: str(r.kind), total: num(r.total), valid: num(r.valid), invalid: num(r.invalid), errorCsv: str(r.errorCsv),
      rows: arr(r.rows).map((x) => ({ line: num(x.line), ok: x.ok === true, errors: arr(x.errors).map((e) => ({ field: str(e.field), message: str(e.message) })), warnings: Array.isArray(x.warnings) ? (x.warnings as unknown[]).map(String) : [] })) });
    setDone(null);
    return true as const;
  });
  const onFile = async (f?: File) => {
    if (!f) return;
    try { setText(await readFileText(f)); setFileName(f.name); setFileErr(''); setVal(null); } catch (e) { setFileErr(e instanceof Error ? e.message : 'Không đọc được tệp.'); }
  };
  if (!cid) return <EmptyState title="Chọn một cơ sở để nhập dữ liệu" description="Nhập dữ liệu thực hiện cho từng cơ sở. Chọn cơ sở ở thanh trên cùng." />;
  if (!can('import.write', cid)) return <EmptyState title="Bạn chưa có quyền nhập dữ liệu ở cơ sở này" />;
  const warnCount = val?.rows.filter((r) => r.warnings.length).length ?? 0;
  const rowCols: Column<RowRes>[] = [
    { key: 'line', header: 'Dòng', value: (r) => r.line, sortable: true, width: 70 },
    { key: 'ok', header: 'Kết quả', value: (r) => (r.ok ? 1 : 0), render: (r) => (r.ok ? <Badge tone={r.warnings.length ? 'warning' : 'success'}>{r.warnings.length ? 'Hợp lệ, có cảnh báo' : 'Hợp lệ'}</Badge> : <Badge tone="error">Lỗi</Badge>) },
    { key: 'msg', header: 'Chi tiết', value: (r) => r.errors.map((e) => e.message).join(' '), render: (r) => [...r.errors.map((e) => `${e.field}: ${e.message}`), ...r.warnings].join(' · ') || '—' },
  ];
  const jobCols: Column<Job>[] = [
    { key: 'at', header: 'Lúc', value: (r) => r.at, render: (r) => formatDateTime(r.at, tz) },
    { key: 'kind', header: 'Loại', value: (r) => r.kind, render: (r) => KINDS[r.kind]?.label ?? r.kind },
    { key: 'file', header: 'Tệp', value: (r) => r.fileName },
    { key: 'st', header: 'Trạng thái', value: (r) => r.status, render: (r) => <Badge tone={r.status === 'committed' ? 'success' : 'info'}>{JOB_STATUS[r.status] ?? r.status}</Badge> },
    { key: 'n', header: 'Dòng', value: (r) => r.total, render: (r) => `${r.valid} hợp lệ / ${r.invalid} lỗi / ${r.total}` },
  ];
  return (
    <div className="stack">
      <Card title="1. Chọn mẫu và tệp">
        <div className="stack">
          <div className="grid-2">
            <FormField name="kind" label="Loại dữ liệu"><Select name="kind" value={kind} onValueChange={(k) => { setKind(k); setVal(null); }} options={Object.entries(KINDS).map(([value, k2]) => ({ value, label: k2.label }))} /></FormField>
          </div>
          <p className="text-small text-secondary">{spec.note} Tối đa 500 dòng mỗi lần.</p>
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => downloadText(`mau-nhap-${kind}.csv`, toCsv(spec.headers, []))}>Tải mẫu CSV</Button>
            <input type="file" accept=".csv,text/csv" aria-label="Chọn tệp CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {fileErr ? <Banner tone="error">{fileErr}</Banner> : null}
          <FormField name="csv" label="Hoặc dán nội dung CSV"><Textarea name="csv" value={text} onValueChange={(t) => { setText(t); setVal(null); }} rows={5} /></FormField>
          {missing.length ? <Banner tone="error" title="Thiếu cột">{missing.join(', ')}. Tải mẫu CSV để xem đúng tên cột.</Banner> : null}
          {check.error ? <Banner tone="error">{check.error.message}</Banner> : null}
          <div><Button loading={check.busy} disabled={!parsed || parsed.rows.length === 0 || missing.length > 0} onClick={() => void check.run()}>Kiểm tra trước khi ghi{parsed ? ` (${parsed.rows.length} dòng)` : ''}</Button></div>
        </div>
      </Card>
      {val ? (
        <Card title="2. Kết quả kiểm tra">
          <div className="stack">
            <div className="grid-3"><Stat label="Tổng số dòng" value={val.total} /><Stat label="Hợp lệ" value={val.valid} tone="success" /><Stat label="Dòng lỗi" value={val.invalid} tone={val.invalid ? 'error' : undefined} /></div>
            <DataTable caption="Kết quả kiểm tra từng dòng" columns={rowCols} rows={val.rows} rowKey={(r) => String(r.line)} status={val.rows.length ? 'ready' : 'empty'} pageSize={15}
              filters={[{ key: 'ok', label: 'Kết quả', options: [{ value: 'bad', label: 'Chỉ dòng lỗi' }, { value: 'warn', label: 'Có cảnh báo' }], predicate: (r, v) => (v === 'bad' ? !r.ok : r.warnings.length > 0) }]} emptyTitle="Không có dòng" />
            <div className="row">
              {val.errorCsv ? <Button variant="secondary" onClick={() => downloadText(`loi-nhap-${kind}.csv`, val.errorCsv)}>Tải lỗi từng dòng (CSV)</Button> : null}
              {val.invalid > 0 ? <Checkbox checked={skip} onChange={setSkip}>Bỏ qua {val.invalid} dòng lỗi và ghi các dòng hợp lệ</Checkbox> : null}
              {warnCount > 0 ? <Checkbox checked={dups} onChange={setDups}>Tôi đã xem {warnCount} cảnh báo trùng và đồng ý tạo hồ sơ mới</Checkbox> : null}
              <Button disabled={(val.invalid > 0 && !skip) || val.valid === 0} onClick={() => setCommit(true)}>Xem tác động và ghi dữ liệu</Button>
            </div>
          </div>
        </Card>
      ) : null}
      {done ? (
        <Card title="3. Kết quả ghi dữ liệu">
          <div className="stack">
            <Banner tone={done.errors ? 'warning' : 'success'}>{done.created} dòng đã tạo, {done.skipped} bỏ qua, {done.errors} lỗi khi ghi.</Banner>
            {done.results.filter((r) => r.result !== 'created').length ? <ul>{done.results.filter((r) => r.result !== 'created').slice(0, 30).map((r) => <li key={r.line}>Dòng {r.line}: {r.message || r.result}</li>)}</ul> : null}
          </div>
        </Card>
      ) : null}
      <Card title="Lịch sử nhập" flush><DataTable caption="Lịch sử nhập dữ liệu" columns={jobCols} rows={[...jobs.data].sort((a, b) => b.at - a.at)} rowKey={(r) => r.id} status={jobs.status} error={jobs.error?.message} onRetry={jobs.retry} emptyTitle="Chưa có lượt nhập nào" /></Card>
      {commit && val && org ? (
        <ActionDialog
          title={`Ghi ${val.valid} dòng ${KINDS[val.kind]?.label ?? ''}`}
          subject={`Cơ sở hiện tại · ${val.invalid} dòng lỗi`}
          impact={[`Tạo ${val.valid} bản ghi mới từ các dòng hợp lệ; ${val.invalid ? (skip ? `${val.invalid} dòng lỗi bị bỏ qua` : 'còn dòng lỗi nên máy chủ sẽ từ chối') : 'không có dòng lỗi'}.`, 'Dòng nào lỗi khi ghi được báo riêng theo từng dòng; không dừng cả lô.', 'Không tự ghép hồ sơ trùng; chỉ tạo mới khi bạn đã đồng ý với cảnh báo.', 'Ghi vào nhật ký thao tác.']}
          confirmLabel="Ghi dữ liệu"
          success="Đã ghi dữ liệu nhập."
          run={(opId) => callApi('import.commit', { orgId: org.orgId, campusId: cid, opId, payload: { jobId: val.jobId, skipInvalid: skip, allowPossibleDuplicates: dups } })}
          onClose={() => setCommit(false)}
          onDone={(res) => { const r = obj(res); setDone({ created: num(r.created), skipped: num(r.skipped), errors: num(r.errors), results: arr(r.results).map((x) => ({ line: num(x.line), result: str(x.result), message: str(x.message) })) }); setVal(null); }}
        />
      ) : null}
    </div>
  );
}

function BackupPanel() {
  const { org, canOrg, tz } = useScope();
  const q = useFirestoreQuery<Backup>(org && canOrg('backup.manage') ? `backups|${org.orgId}` : null, () => collection(firebase().db, 'orgs', org!.orgId, 'backups'), (id, d) => ({
    id, kind: str(d.kind), status: str(d.status), startedAt: tsMs(d.startedAt), finishedAt: tsMs(d.finishedAt), sizeBytes: num(d.sizeBytes), location: str(d.location), exportName: str(d.exportName), lastVerifiedAt: tsMs(d.lastVerifiedAt), lastVerifyResult: str(d.lastVerifyResult), note: str(d.note),
  }));
  const [rec, setRec] = useState(false);
  const [ver, setVer] = useState<Backup | null>(null);
  const [f, setF] = useState({ kind: 'scheduled', status: 'success', location: '', exportName: '', sizeMb: '', note: '' });
  const [v, setV] = useState({ result: 'success', notes: '', environment: 'staging' });
  if (!canOrg('backup.manage')) return <EmptyState title="Cần quyền sao lưu cấp toàn tổ chức" description="Quản lý và ghi nhận sao lưu chỉ dành cho người có quyền backup.manage ở cấp tổ chức." />;
  const rows = [...q.data].sort((a, b) => b.startedAt - a.startedAt);
  const last = rows.find((r) => r.status === 'success');
  const cols: Column<Backup>[] = [
    { key: 'at', header: 'Bắt đầu', value: (r) => r.startedAt, sortable: true, render: (r) => formatDateTime(r.startedAt, tz) },
    { key: 'kind', header: 'Loại', value: (r) => r.kind, render: (r) => (r.kind === 'manual' ? 'Thủ công' : 'Theo lịch') },
    { key: 'st', header: 'Kết quả', value: (r) => r.status, render: (r) => <Badge tone={r.status === 'success' ? 'success' : 'error'}>{r.status === 'success' ? 'Thành công' : 'Thất bại'}</Badge> },
    { key: 'size', header: 'Dung lượng', value: (r) => r.sizeBytes, align: 'right', render: (r) => (r.sizeBytes ? `${(r.sizeBytes / 1048576).toFixed(1)} MB` : '—') },
    { key: 'loc', header: 'Vị trí lưu', value: (r) => r.location, render: (r) => r.location || r.exportName || '—' },
    { key: 'ver', header: 'Kiểm tra khôi phục', value: (r) => r.lastVerifiedAt, render: (r) => (r.lastVerifiedAt ? <Badge tone={r.lastVerifyResult === 'success' ? 'success' : 'error'}>{r.lastVerifyResult === 'success' ? 'Đạt' : 'Không đạt'} · {formatDateTime(r.lastVerifiedAt, tz)}</Badge> : <Badge tone="warning">Chưa kiểm tra</Badge>) },
    { key: 'a', header: 'Thao tác', render: (r) => (r.status === 'success' ? <Button size="sm" variant="tertiary" onClick={() => { setV({ result: 'success', notes: '', environment: 'staging' }); setVer(r); }}>Ghi nhận kiểm tra khôi phục</Button> : null) },
  ];
  return (
    <div className="stack">
      <Banner tone="info" title="Lịch sao lưu và phục hồi">
        Sao lưu chạy theo lịch xuất Firestore ở hạ tầng; màn này ghi nhận kết quả và kết quả kiểm tra khôi phục. Phục hồi dữ liệu là thao tác hạ tầng có kiểm soát, cần xem tác động và đúng thẩm quyền; không có nút phục hồi ở đây.
      </Banner>
      <div className="grid-3">
        <Stat label="Lần sao lưu thành công gần nhất" value={last ? formatDateTime(last.startedAt, tz) : 'Chưa có'} tone={last ? undefined : 'warning'} />
        <Stat label="Đã kiểm tra khôi phục" value={rows.filter((r) => r.lastVerifyResult === 'success').length} hint="Số bản sao lưu kiểm tra đạt" />
        <Stat label="Sao lưu thất bại" value={rows.filter((r) => r.status === 'failed').length} tone={rows.some((r) => r.status === 'failed') ? 'error' : undefined} />
      </div>
      <div><Button icon="plus" onClick={() => setRec(true)}>Ghi nhận bản sao lưu</Button></div>
      <DataTable caption="Bản sao lưu" columns={cols} rows={rows} rowKey={(r) => r.id} status={q.status} error={q.error?.message} onRetry={q.retry} emptyTitle="Chưa ghi nhận bản sao lưu" emptyDescription="Ghi nhận kết quả sao lưu theo lịch hoặc thủ công để theo dõi và kiểm tra khôi phục." />
      {rec && org ? (
        <ActionDialog title="Ghi nhận bản sao lưu" impact={['Lưu một bản ghi kết quả sao lưu vào nhật ký hệ thống.', 'Không thực hiện sao lưu hay phục hồi; chỉ ghi nhận kết quả.']} confirmLabel="Ghi nhận" success="Đã ghi nhận bản sao lưu."
          validate={() => (f.sizeMb && !/^\d+$/.test(f.sizeMb) ? 'Dung lượng (MB) phải là số nguyên.' : null)}
          run={(opId) => callApi('backup.record', { orgId: org.orgId, opId, payload: { kind: f.kind, status: f.status, location: f.location.trim() || undefined, exportName: f.exportName.trim() || undefined, sizeBytes: f.sizeMb ? Number(f.sizeMb) * 1048576 : undefined, note: f.note.trim() || undefined } })} onClose={() => setRec(false)}>
          <div className="grid-2">
            <FormField name="kind" label="Loại"><Select name="kind" value={f.kind} onValueChange={(x) => setF({ ...f, kind: x })} options={[{ value: 'scheduled', label: 'Theo lịch' }, { value: 'manual', label: 'Thủ công' }]} /></FormField>
            <FormField name="status" label="Kết quả"><Select name="status" value={f.status} onValueChange={(x) => setF({ ...f, status: x })} options={[{ value: 'success', label: 'Thành công' }, { value: 'failed', label: 'Thất bại' }]} /></FormField>
          </div>
          <FormField name="location" label="Vị trí lưu"><Input name="location" value={f.location} onValueChange={(x) => setF({ ...f, location: x })} /></FormField>
          <FormField name="exportName" label="Tên bản xuất"><Input name="exportName" value={f.exportName} onValueChange={(x) => setF({ ...f, exportName: x })} /></FormField>
          <FormField name="sizeMb" label="Dung lượng (MB)"><Input name="sizeMb" value={f.sizeMb} onValueChange={(x) => setF({ ...f, sizeMb: x })} inputMode="numeric" /></FormField>
          <FormField name="note" label="Ghi chú"><Textarea name="note" value={f.note} onValueChange={(x) => setF({ ...f, note: x })} /></FormField>
        </ActionDialog>
      ) : null}
      {ver && org ? (
        <ActionDialog title="Ghi nhận kiểm tra khôi phục" subject={`Bản sao lưu ${formatDateTime(ver.startedAt, tz)}`} impact={['Ghi kết quả kiểm tra khôi phục trên môi trường thử, không đụng dữ liệu đang chạy.', 'Kết quả hiển thị trong bảng sao lưu và nhật ký thao tác.']} confirmLabel="Ghi nhận kết quả" success="Đã ghi nhận kiểm tra khôi phục."
          validate={() => (v.notes.trim() ? null : 'Nhập ghi chú kiểm tra.')}
          run={(opId) => callApi('backup.verify', { orgId: org.orgId, opId, payload: { backupId: ver.id, result: v.result, notes: v.notes.trim(), environment: v.environment.trim() || 'staging' } })} onClose={() => setVer(null)}>
          <FormField name="result" label="Kết quả"><Select name="result" value={v.result} onValueChange={(x) => setV({ ...v, result: x })} options={[{ value: 'success', label: 'Đạt' }, { value: 'failed', label: 'Không đạt' }]} /></FormField>
          <FormField name="env" label="Môi trường thử"><Input name="env" value={v.environment} onValueChange={(x) => setV({ ...v, environment: x })} /></FormField>
          <FormField name="notes" label="Ghi chú" required><Textarea name="notes" value={v.notes} onValueChange={(x) => setV({ ...v, notes: x })} /></FormField>
        </ActionDialog>
      ) : null}
    </div>
  );
}

/** W46 — Nhập dữ liệu và sao lưu. Không có nút phục hồi. */
export function W46ImportBackup(_props: ScreenProps) {
  void _props;
  const { canAnywhere, canOrg } = useScope();
  const showImport = canAnywhere('import.write');
  const showBackup = canAnywhere('backup.manage') || canOrg('backup.manage');
  const [tab, setTab] = useState(showImport ? 'import' : 'backup');
  const items = [...(showImport ? [{ id: 'import', label: 'Nhập dữ liệu' }] : []), ...(showBackup ? [{ id: 'backup', label: 'Sao lưu' }] : [])];
  return (
    <div>
      <PageHeader title="Nhập dữ liệu và sao lưu" code="W46" description="Nhập bằng mẫu CSV, kiểm tra trước khi ghi, tải lỗi từng dòng. Sao lưu có lịch, kết quả và kiểm tra khôi phục." />
      <div className="stack">
        {items.length > 1 ? <Tabs label="Nhập dữ liệu hoặc sao lưu" items={items} active={tab} onChange={setTab} /> : null}
        {tab === 'import' && showImport ? <ImportPanel /> : <BackupPanel />}
      </div>
    </div>
  );
}
