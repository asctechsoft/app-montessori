'use client';
import { useMemo, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useDoc, useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate, formatVnd } from '@/lib/format';
import { ErrorState, PageHeader, SkeletonText } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { DateInput, FormField, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ClassSelect, EnrollProblems } from './parts/enroll';
import {
  IN_SCHOOL, Kv, mapChild, mapClass, NotInCampus, num, str, useCampusCol, useCampusCtx, useChildrenQ, useClassesQ, useOccupancy, type ChildRow, type ClassRow,
} from './parts/kit';

const DEBT_OPTS = [{ value: 'stay', label: 'Cơ sở cũ tiếp tục thu' }, { value: 'move', label: 'Chuyển công nợ sang cơ sở mới' }];
const DEPOSIT_OPTS = [{ value: 'stay', label: 'Giữ tại cơ sở cũ' }, { value: 'move', label: 'Điều chuyển sang cơ sở mới' }, { value: 'refund', label: 'Hoàn lại cho phụ huynh' }];

/** Lớp của một cơ sở bất kỳ (cơ sở đích có thể khác cơ sở đang chọn). */
function useClassesOf(campusId: string, enabled: boolean) {
  const { orgId } = useCampusCtx();
  const q = useFirestoreQuery<ClassRow>(
    enabled && campusId ? `classesOf|${orgId}|${campusId}` : null,
    () => query(collection(firebase().db, 'orgs', orgId, 'classes'), where('campusId', '==', campusId)),
    (id, d) => mapClass(id, d),
  );
  const data = useMemo(() => q.data.filter((c) => !c.archived && c.status !== 'closed').sort((a, b) => a.name.localeCompare(b.name, 'vi')), [q.data]);
  return { ...q, data };
}

interface Created { id: string; sides: { campusId: string; status: string }[]; impact: Record<string, unknown> }

/** W13 — Chuyển lớp hoặc cơ sở: chỗ trống, ngày hiệu lực, xử lý công nợ/đặt cọc, gửi phê duyệt sau khi xem tác động. */
export function W13Transfer({ params }: ScreenProps) {
  const id = params.id;
  const { orgId, cid, tz, scopeKey, can, campuses } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Created | null>(null);

  const cq = useDoc<ChildRow>(orgId && cid ? `child|${scopeKey}|${id}` : null, () => doc(firebase().db, 'orgs', orgId, 'children', id), (i, d) => mapChild(i, d));
  const child = cq.data;
  const children = useChildrenQ();
  const myClasses = useClassesQ();
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const pending = useCampusCol<{ id: string; toClassId: string; effectiveDate: string }>('transfers', (i, d) => ({ id: i, toClassId: str(d.toClassId), effectiveDate: str(d.effectiveDate) }), {
    where: [where('childId', '==', id), where('status', '==', 'pending')], keyExtra: `pending|${id}`,
  });
  const rcv = useCampusCol<{ id: string; balance: number; status: string }>('receivables', (i, d) => ({ id: i, balance: num(d.balance) ?? 0, status: str(d.status) }), { where: [where('childId', '==', id)], keyExtra: id, enabled: can('payments.read') });
  const dep = useCampusCol<{ id: string; amount: number; status: string }>('deposits', (i, d) => ({ id: i, amount: num(d.amount) ?? 0, status: str(d.status) }), { where: [where('childId', '==', id)], keyExtra: id, enabled: can('payments.read') });

  const form = useForm({
    initial: { toCampusId: cid ?? '', toClassId: '', effectiveDate: today, reason: '', debtHandling: 'stay', depositHandling: 'stay' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.toClassId) e.toClassId = 'Chọn lớp đến.';
      else if (v.toClassId === child?.classId) e.toClassId = 'Lớp đến trùng lớp hiện tại.';
      if (!v.effectiveDate) e.effectiveDate = 'Chọn ngày hiệu lực.';
      else if (v.effectiveDate < today) e.effectiveDate = 'Ngày hiệu lực không được ở quá khứ.';
      return e;
    },
  });
  const v = form.values;
  const cross = v.toCampusId !== cid;
  const other = useClassesOf(v.toCampusId, cross);
  const destClasses = cross ? other.data : myClasses.data.filter((c) => c.id !== child?.classId);
  const destOcc = (c: ClassRow) => (cross ? c.enrolledCount ?? 0 : occupancy(c));
  const dest = destClasses.find((c) => c.id === v.toClassId);
  const seatsLeft = dest ? dest.capacity - destOcc(dest) : null;
  const full = seatsLeft !== null && seatsLeft <= 0;

  const openDebt = (rcv.data ?? []).filter((r) => !['paid', 'cancelled', 'draft'].includes(r.status));
  const debtAmount = openDebt.reduce((s, r) => s + r.balance, 0);
  const held = (dep.data ?? []).filter((d) => d.status === 'held');
  const heldAmount = held.reduce((s, d) => s + d.amount, 0);
  const destCampusName = campuses.find((c) => c.id === v.toCampusId)?.name ?? v.toCampusId;

  const submit = form.onSubmit(async (val, opId) => {
    const res = await callApi<Record<string, unknown>>('transfer.request', { orgId, campusId: cid ?? undefined, opId, payload: {
      childId: id, toClassId: val.toClassId, toCampusId: val.toCampusId, effectiveDate: val.effectiveDate, reason: val.reason.trim(),
      ...(cross ? { debtHandling: val.debtHandling, depositHandling: val.depositHandling } : {}),
    } });
    form.reset(val);
    const sides = Object.entries((res.sides ?? {}) as Record<string, { status?: string }>).map(([campusId, s]) => ({ campusId, status: str(s?.status) }));
    setResult({ id: str(res.id), sides, impact: (res.impact ?? {}) as Record<string, unknown> });
    setConfirming(false);
    toast.success('Đã gửi yêu cầu chuyển để phê duyệt.');
  });

  if (cq.status === 'loading') return <><PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" /><SkeletonText lines={5} /></>;
  if (cq.status === 'error') return <><PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" /><ErrorState message={cq.error?.message} onRetry={cq.retry} /></>;
  if (cq.status === 'empty' || !child || child.campusId !== cid) return <><PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" /><NotInCampus what="hồ sơ trẻ" backHref="/tre" backLabel="Về danh sách trẻ" /></>;

  const crumbs = [{ label: 'Trẻ và phụ huynh', href: '/tre' }, { label: child.fullName, href: `/tre/${child.id}` }, { label: 'Chuyển lớp hoặc cơ sở' }];
  const curClass = myClasses.byId.get(child.classId ?? '')?.name ?? '';

  if (result) {
    return (
      <div className="stack">
        <PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" breadcrumbs={crumbs} />
        <Card>
          <div className="stack">
            <Banner tone="success" title="Đã gửi yêu cầu chuyển">
              Trẻ chưa được chuyển cho tới khi {result.sides.length > 1 ? 'cả hai cơ sở (cơ sở cũ và cơ sở mới)' : 'người có thẩm quyền'} duyệt. Dữ liệu và quyền của giáo viên cũ giữ nguyên đến ngày hiệu lực.
            </Banner>
            <Kv items={result.sides.map((s) => [`Cơ sở ${campuses.find((c) => c.id === s.campusId)?.name ?? s.campusId}`, s.status === 'pending' ? 'Chờ duyệt' : s.status])} />
            <div className="row"><LinkButton href="/phe-duyet">Mở trung tâm phê duyệt</LinkButton><LinkButton href={`/tre/${child.id}`} variant="secondary">Về hồ sơ trẻ</LinkButton></div>
          </div>
        </Card>
      </div>
    );
  }

  if (!IN_SCHOOL.includes(child.status) || !child.classId) {
    return <><PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" breadcrumbs={crumbs} /><Banner tone="warning">Chỉ chuyển được trẻ đang học và đã có lớp. Trạng thái hiện tại không cho phép chuyển.</Banner></>;
  }

  const impact = [
    `${child.fullName} chuyển từ lớp ${curClass || '—'} sang lớp ${dest?.name ?? '—'}${cross ? ` tại ${destCampusName}` : ''} từ ${v.effectiveDate ? formatDate(v.effectiveDate) : '—'}.`,
    `Sĩ số lớp đến: ${dest ? `${destOcc(dest)}/${dest.capacity}` : '—'}; đợt phân lớp cũ kết thúc trước ngày hiệu lực, đợt mới bắt đầu từ ngày hiệu lực.`,
    ...(cross ? [
      `Công nợ: ${v.debtHandling === 'move' ? 'chuyển sang cơ sở mới' : 'cơ sở cũ tiếp tục thu'}${can('payments.read') ? ` (${openDebt.length} khoản, ${formatVnd(debtAmount)})` : ''}.`,
      `Đặt cọc: ${v.depositHandling === 'move' ? 'điều chuyển bằng giao dịch riêng sang cơ sở mới' : v.depositHandling === 'refund' ? 'tạo yêu cầu hoàn cho phụ huynh' : 'giữ tại cơ sở cũ'}${can('payments.read') ? ` (${formatVnd(heldAmount)})` : ''}. Không tự coi là đã thanh toán.`,
      'Liên kết người giám hộ và ủy quyền đón chuyển theo trẻ.',
    ] : []),
    `Yêu cầu cần ${cross ? 'cả hai cơ sở' : 'người có quyền chuyển'} duyệt; sau khi duyệt, giáo viên cũ hết quyền nhập dữ liệu cho trẻ từ ngày hiệu lực.`,
  ];

  return (
    <div className="stack">
      <PageHeader title="Chuyển lớp hoặc cơ sở" code="W13" breadcrumbs={crumbs} description={`${child.fullName} (${child.code}) · lớp hiện tại: ${curClass || '—'}`} />
      {pending.data.length > 0 ? <Banner tone="warning" title="Trẻ đang có yêu cầu chuyển chờ duyệt">Hoàn tất hoặc hủy yêu cầu hiện có tại trung tâm phê duyệt trước khi gửi yêu cầu mới. <LinkButton href="/phe-duyet" variant="tertiary" size="sm">Mở phê duyệt</LinkButton></Banner> : null}
      <form className="stack" noValidate style={{ maxWidth: 880 }} onSubmit={(e) => {
        e.preventDefault();
        const bad = !v.toClassId || v.toClassId === child.classId || !v.effectiveDate || v.effectiveDate < today;
        if (bad) { void form.onSubmit(async () => undefined)(); return; }
        setConfirming(true);
      }}>
        <Card title="Nơi chuyển đến">
          <div className="grid-2">
            {campuses.length > 1 ? (
              <FormField name="toCampusId" label="Cơ sở đến" required {...form.field('toCampusId')}>
                <Select name="toCampusId" value={v.toCampusId} onValueChange={(c) => { form.setValue('toCampusId', c); form.setValue('toClassId', ''); }} options={campuses.map((c) => ({ value: c.id, label: `${c.name}${c.id === cid ? ' (cơ sở hiện tại)' : ''}` }))} />
              </FormField>
            ) : null}
            <FormField name="toClassId" label="Lớp đến" required {...form.field('toClassId')}>
              <ClassSelect {...form.bind('toClassId')} classes={destClasses} occupancy={destOcc} />
            </FormField>
            <FormField name="effectiveDate" label="Ngày hiệu lực" required {...form.field('effectiveDate')}><DateInput {...form.bind('effectiveDate')} /></FormField>
          </div>
          {cross && other.status === 'error' ? <Banner tone="warning">Không xem được danh sách lớp của cơ sở đích (cần quyền xem lớp ở đó). {other.error?.message}</Banner> : null}
          {dest ? (
            <div style={{ marginTop: 'var(--space-3)' }}>
              {full ? <Banner tone="error" title={`Lớp ${dest.name} đã đủ sĩ số (${destOcc(dest)}/${dest.capacity})`}>Chọn lớp khác còn chỗ; máy chủ cũng từ chối nếu lớp đầy.</Banner>
                : <Banner tone="success" title={`Lớp ${dest.name} còn ${seatsLeft} chỗ trống (${destOcc(dest)}/${dest.capacity})`}>{cross ? 'Sĩ số lấy từ số liệu đồng bộ của máy chủ.' : 'Sĩ số tính từ danh sách trẻ đang học.'}</Banner>}
            </div>
          ) : null}
        </Card>
        {cross ? (
          <Card title="Công nợ và đặt cọc">
            <div className="stack">
              {can('payments.read') ? (
                <p className="text-small">Hiện còn <strong>{openDebt.length}</strong> khoản chưa thanh toán ({formatVnd(debtAmount)}) và đặt cọc đang giữ {formatVnd(heldAmount)}.</p>
              ) : <p className="text-small text-secondary">Bạn không có quyền xem công nợ; số liệu cụ thể sẽ nằm trong yêu cầu phê duyệt.</p>}
              <div className="grid-2">
                <FormField name="debtHandling" label="Xử lý công nợ cũ" {...form.field('debtHandling')}><Select {...form.bind('debtHandling')} options={DEBT_OPTS} /></FormField>
                <FormField name="depositHandling" label="Xử lý tiền đặt cọc" {...form.field('depositHandling')}><Select {...form.bind('depositHandling')} options={DEPOSIT_OPTS} /></FormField>
              </div>
            </div>
          </Card>
        ) : null}
        <Card title="Lý do">
          <FormField name="reason" label="Lý do chuyển" {...form.field('reason')}><Textarea {...form.bind('reason')} /></FormField>
        </Card>
        <div className="row">
          <Button type="submit" size="lg" disabled={pending.data.length > 0 || full}>Xem tác động và gửi phê duyệt</Button>
          <LinkButton href={`/tre/${child.id}`} variant="tertiary" size="lg">Quay lại hồ sơ</LinkButton>
        </div>
      </form>
      <ConfirmDialog open={confirming} title="Gửi yêu cầu chuyển" subject={`${child.code} · ${child.fullName}`} impact={impact} confirmLabel={`Gửi yêu cầu chuyển ${child.fullName}`}
        busy={form.submitting} error={form.formError} onCancel={() => setConfirming(false)} onConfirm={() => void submit()}>
        <EnrollProblems error={form.apiError} onPickClass={(cl) => { form.setValue('toClassId', cl); setConfirming(false); }} />
      </ConfirmDialog>
    </div>
  );
}

