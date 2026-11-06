'use client';
import { useMemo, useState, type FormEvent } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { formatDate, formatVnd } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { DateInput, FormField, Input, MoneyInput, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { ActionDialog, KV, arr, num, obj, str, useCampus, useScopedQuery, moneyStyle } from './parts/common';
import type { Tone } from '@/lib/status';

interface Item { code: string; type: string; name: string; amount: number | null }
interface Disc { code: string; name: string; amount: number | null }
interface Policy {
  id: string; name: string; code: string; seriesId: string; versionNo: number; status: string;
  effectiveFrom: string; effectiveTo: string; items: { code: string; type: string; name: string; amount: number }[];
  discounts: { code: string; name: string; amount: number }[];
  meal: { unitPrice: number; mode: string; daysPerMonth: number | null } | null;
  proration: string; dueDay: number | null; includeTrial: boolean; note: string; version: number;
}

const toPolicy = (id: string, d: DocumentData): Policy => {
  const meal = obj(d.meal);
  return {
    id, name: str(d.name, id), code: str(d.code), seriesId: str(d.seriesId, id), versionNo: num(d.versionNo) || 1, status: str(d.status, 'draft'),
    effectiveFrom: str(d.effectiveFrom), effectiveTo: str(d.effectiveTo),
    items: arr(d.items).map((i) => ({ code: str(i.code), type: str(i.type, 'service'), name: str(i.name), amount: num(i.amount) })),
    discounts: arr(d.discounts).map((i) => ({ code: str(i.code), name: str(i.name), amount: num(i.amount) })),
    meal: d.meal ? { unitPrice: num(meal.unitPrice), mode: str(meal.mode, 'provisional'), daysPerMonth: typeof meal.daysPerMonth === 'number' ? meal.daysPerMonth : null } : null,
    proration: str(d.proration, 'none'), dueDay: typeof d.dueDay === 'number' ? d.dueDay : null, includeTrial: d.includeTrial === true, note: str(d.note), version: num(d.version),
  };
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Bản nháp', tone: 'neutral' },
  published: { label: 'Đang áp dụng', tone: 'success' },
  superseded: { label: 'Đã được thay thế', tone: 'info' },
};
const TYPE_OPTIONS = [
  { value: 'tuition', label: 'Học phí' },
  { value: 'service', label: 'Dịch vụ' },
  { value: 'other', label: 'Khác' },
];
const TYPE_LABEL: Record<string, string> = { tuition: 'Học phí', service: 'Dịch vụ', other: 'Khác' };
const MEAL_MODE: Record<string, string> = {
  provisional: 'Tạm thu theo ngày học dự kiến, hoàn trừ kỳ sau cho suất đã hủy đủ điều kiện',
  actual: 'Thu theo số suất thực tế đã phục vụ và đủ điều kiện tính tiền',
};

type Mode = 'create' | 'edit' | 'version';

interface FormProps { policy: Policy | null; mode: Mode; onClose: () => void }

function PolicyForm({ policy, mode, onClose }: FormProps) {
  const ctx = useCampus();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const [items, setItems] = useState<Item[]>(policy?.items.length ? policy.items.map((i) => ({ ...i })) : [{ code: '', type: 'tuition', name: '', amount: null }]);
  const [discs, setDiscs] = useState<Disc[]>(policy ? policy.discounts.map((d) => ({ ...d })) : []);
  const [listErr, setListErr] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);

  const form = useForm({
    initial: {
      name: policy?.name ?? '', code: policy?.code ?? '', effectiveFrom: mode === 'edit' ? policy?.effectiveFrom ?? '' : '',
      dueDay: policy?.dueDay ? String(policy.dueDay) : '10', proration: policy?.proration ?? 'daily', includeTrial: policy?.includeTrial ? 'yes' : 'no',
      mealOn: policy ? (policy.meal ? 'yes' : 'no') : 'yes', mealUnit: (policy?.meal?.unitPrice ?? null) as number | null,
      mealMode: policy?.meal?.mode ?? 'provisional', mealDays: policy?.meal?.daysPerMonth ? String(policy.meal.daysPerMonth) : '', note: policy?.note ?? '',
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.name.trim()) e.name = 'Nhập tên biểu phí.';
      if (mode !== 'edit' && !v.effectiveFrom) e.effectiveFrom = 'Chọn ngày hiệu lực.';
      const dd = Number(v.dueDay);
      if (!Number.isInteger(dd) || dd < 1 || dd > 28) e.dueDay = 'Hạn đóng là ngày từ 1 đến 28 của tháng.';
      if (v.mealOn === 'yes') {
        if (v.mealUnit === null || v.mealUnit < 0) e.mealUnit = 'Nhập đơn giá một suất ăn.';
        if (v.mealDays && (!Number.isInteger(Number(v.mealDays)) || Number(v.mealDays) < 1 || Number(v.mealDays) > 31)) e.mealDays = 'Số ngày ăn dự kiến từ 1 đến 31.';
      }
      return e;
    },
  });

  const validateLists = (): boolean => {
    const e: Record<string, string> = {};
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (!it.code.trim()) e[`i${i}code`] = 'Nhập mã khoản.';
      else if (seen.has(it.code.trim().toUpperCase())) e[`i${i}code`] = 'Mã khoản bị trùng.';
      else seen.add(it.code.trim().toUpperCase());
      if (!it.name.trim()) e[`i${i}name`] = 'Nhập tên khoản.';
      if (it.amount === null || it.amount < 0) e[`i${i}amount`] = 'Nhập số tiền (đồng).';
    });
    discs.forEach((d, i) => {
      if (!d.code.trim()) e[`d${i}code`] = 'Nhập mã ưu đãi.';
      if (!d.name.trim()) e[`d${i}name`] = 'Nhập tên ưu đãi.';
      if (d.amount === null || d.amount < 0) e[`d${i}amount`] = 'Nhập số tiền (đồng).';
    });
    setListErr(e);
    return Object.keys(e).length === 0;
  };

  const buildData = (v: typeof form.values): Record<string, unknown> => ({
    name: v.name.trim(), code: v.code.trim() || undefined, effectiveFrom: v.effectiveFrom || undefined,
    items: items.map((i) => ({ code: i.code.trim(), type: i.type, name: i.name.trim(), amount: i.amount ?? 0 })),
    discounts: discs.map((d) => ({ code: d.code.trim(), name: d.name.trim(), amount: d.amount ?? 0 })),
    meal: v.mealOn === 'yes' ? { unitPrice: v.mealUnit ?? 0, mode: v.mealMode, ...(v.mealDays ? { daysPerMonth: Number(v.mealDays) } : {}) } : null,
    proration: v.proration, dueDay: Number(v.dueDay), includeTrial: v.includeTrial === 'yes', note: v.note.trim() || undefined,
  });

  const send = form.onSubmit(async (v, opId) => {
    const data = buildData(v);
    if (mode === 'version') {
      setPending(data);
      return;
    }
    await callApi('entity.save', {
      orgId: ctx!.orgId, campusId: ctx!.campusId, opId,
      payload: { collection: 'feePolicies', id: mode === 'edit' ? policy!.id : undefined, expectedVersion: mode === 'edit' ? policy!.version : undefined, data: { ...data, campusId: ctx!.campusId } },
    });
    toast.success(mode === 'edit' ? 'Đã lưu biểu phí nháp.' : 'Đã tạo biểu phí nháp. Phát hành để áp dụng.');
    onClose();
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validateLists()) {
      form.setFormError('Kiểm tra lại các khoản thu và ưu đãi được đánh dấu.');
      return;
    }
    void send(e);
  };

  const dirty = form.dirty || JSON.stringify(items) !== JSON.stringify(policy?.items ?? []) || discs.length !== (policy?.discounts.length ?? 0);
  const close = async () => {
    if (dirty && !(await confirmDiscard('đóng biểu phí đang soạn'))) return;
    onClose();
  };

  const title = mode === 'create' ? 'Tạo biểu phí' : mode === 'edit' ? `Sửa biểu phí nháp ${policy?.name}` : `Phiên bản mới của ${policy?.name}`;
  const setItem = (i: number, patch: Partial<Item>) => setItems((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setDisc = (i: number, patch: Partial<Disc>) => setDiscs((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <>
      <Drawer
        open={!pending}
        title={title}
        onClose={() => void close()}
        footer={
          <>
            <Button variant="secondary" onClick={() => void close()}>Đóng</Button>
            <Button type="submit" form="policy-form" loading={form.submitting}>{mode === 'version' ? 'Xem tác động và phát hành' : 'Lưu bản nháp'}</Button>
          </>
        }
      >
        <form id="policy-form" className="stack" noValidate onSubmit={submit}>
          {mode === 'version' ? (
            <Banner tone="info" title="Tạo phiên bản mới">Phiên bản cũ được giữ nguyên cho các khoản phải thu đã lập. Phiên bản mới chỉ áp dụng cho kỳ có ngày bắt đầu từ ngày hiệu lực trở đi.</Banner>
          ) : null}
          {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
          <FormField name="name" label="Tên biểu phí" required {...form.field('name')}><Input {...form.bind('name')} /></FormField>
          <div className="grid-2">
            <FormField name="code" label="Mã biểu phí" {...form.field('code')}><Input {...form.bind('code')} /></FormField>
            <FormField name="effectiveFrom" label="Ngày hiệu lực" required={mode !== 'edit'} helper={mode === 'edit' ? 'Có thể để trống khi lưu nháp; cần khi phát hành.' : undefined} {...form.field('effectiveFrom')}>
              <DateInput {...form.bind('effectiveFrom')} />
            </FormField>
          </div>
          <div className="field-label">Khoản thu</div>
          {items.map((it, i) => (
            <div key={i} className="grid-4" style={{ alignItems: 'start' }}>
              <FormField name={`i${i}code`} label="Mã" error={listErr[`i${i}code`]}><Input name={`i${i}code`} value={it.code} onValueChange={(v) => setItem(i, { code: v })} /></FormField>
              <FormField name={`i${i}type`} label="Loại"><Select name={`i${i}type`} value={it.type} onValueChange={(v) => setItem(i, { type: v })} options={TYPE_OPTIONS} /></FormField>
              <FormField name={`i${i}name`} label="Tên khoản" error={listErr[`i${i}name`]}><Input name={`i${i}name`} value={it.name} onValueChange={(v) => setItem(i, { name: v })} /></FormField>
              <FormField name={`i${i}amount`} label="Số tiền" error={listErr[`i${i}amount`]}>
                <MoneyInput name={`i${i}amount`} value={it.amount} onValueChange={(v) => setItem(i, { amount: v })} />
              </FormField>
              {items.length > 1 ? <Button size="sm" variant="tertiary" onClick={() => setItems((a) => a.filter((_, k) => k !== i))}>Bỏ khoản {i + 1}</Button> : null}
            </div>
          ))}
          <div><Button size="sm" variant="secondary" icon="plus" onClick={() => setItems((a) => [...a, { code: '', type: 'service', name: '', amount: null }])}>Thêm khoản thu</Button></div>

          <div className="field-label">Ưu đãi, giảm trừ</div>
          {discs.map((d, i) => (
            <div key={i} className="grid-3" style={{ alignItems: 'start' }}>
              <FormField name={`d${i}code`} label="Mã" error={listErr[`d${i}code`]}><Input name={`d${i}code`} value={d.code} onValueChange={(v) => setDisc(i, { code: v })} /></FormField>
              <FormField name={`d${i}name`} label="Tên ưu đãi" error={listErr[`d${i}name`]}><Input name={`d${i}name`} value={d.name} onValueChange={(v) => setDisc(i, { name: v })} /></FormField>
              <FormField name={`d${i}amount`} label="Số tiền giảm" error={listErr[`d${i}amount`]}>
                <MoneyInput name={`d${i}amount`} value={d.amount} onValueChange={(v) => setDisc(i, { amount: v })} />
              </FormField>
              <Button size="sm" variant="tertiary" onClick={() => setDiscs((a) => a.filter((_, k) => k !== i))}>Bỏ ưu đãi {i + 1}</Button>
            </div>
          ))}
          <div><Button size="sm" variant="secondary" icon="plus" onClick={() => setDiscs((a) => [...a, { code: '', name: '', amount: null }])}>Thêm ưu đãi</Button></div>

          <div className="field-label">Quy tắc tính tiền ăn</div>
          <FormField name="mealOn" label="Thu tiền ăn theo biểu phí này"><Select {...form.bind('mealOn')} options={[{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }]} /></FormField>
          {form.values.mealOn === 'yes' ? (
            <>
              <div className="grid-2">
                <FormField name="mealUnit" label="Đơn giá một suất" required {...form.field('mealUnit')}><MoneyInput {...form.bind('mealUnit')} /></FormField>
                <FormField name="mealDays" label="Số ngày ăn dự kiến mỗi tháng" helper="Để trống = theo số ngày học của kỳ." {...form.field('mealDays')}><Input {...form.bind('mealDays')} inputMode="numeric" /></FormField>
              </div>
              <FormField name="mealMode" label="Cách tính" helper={MEAL_MODE[form.values.mealMode]}>
                <Select {...form.bind('mealMode')} options={[{ value: 'provisional', label: 'Tạm thu, hoàn trừ kỳ sau' }, { value: 'actual', label: 'Theo suất thực tế' }]} />
              </FormField>
            </>
          ) : null}
          <div className="grid-3">
            <FormField name="proration" label="Nhập học giữa kỳ"><Select {...form.bind('proration')} options={[{ value: 'daily', label: 'Tính theo ngày' }, { value: 'none', label: 'Thu đủ tháng' }]} /></FormField>
            <FormField name="dueDay" label="Hạn đóng (ngày trong tháng)" required {...form.field('dueDay')}><Input {...form.bind('dueDay')} inputMode="numeric" /></FormField>
            <FormField name="includeTrial" label="Áp dụng cho trẻ học thử"><Select {...form.bind('includeTrial')} options={[{ value: 'no', label: 'Không' }, { value: 'yes', label: 'Có' }]} /></FormField>
          </div>
          <FormField name="note" label="Ghi chú" {...form.field('note')}><Textarea {...form.bind('note')} /></FormField>
        </form>
      </Drawer>
      {pending && policy ? (
        <ActionDialog
          title={`Phát hành phiên bản mới của ${policy.name}`}
          subject={`Hiệu lực từ ${formatDate(str(pending.effectiveFrom))}`}
          impact={[
            `Tạo phiên bản ${policy.versionNo + 1} và phát hành; phiên bản ${policy.versionNo} hết hiệu lực vào ngày liền trước ${formatDate(str(pending.effectiveFrom))}.`,
            'Khoản phải thu đã lập theo phiên bản cũ không thay đổi; kỳ thu từ ngày hiệu lực trở đi dùng phiên bản mới.',
            'Ngày hiệu lực phải sau ngày hiệu lực của phiên bản đang áp dụng; nếu không máy chủ sẽ từ chối.',
          ]}
          confirmLabel="Phát hành phiên bản mới"
          success="Đã phát hành phiên bản biểu phí mới."
          run={(opId) => callApi('feePolicy.publish', { orgId: ctx!.orgId, campusId: ctx!.campusId, opId, payload: { id: policy.id, effectiveFrom: pending.effectiveFrom, changes: { ...pending, effectiveFrom: undefined, code: pending.code ?? policy.code } } })}
          onClose={() => setPending(null)}
          onDone={onClose}
        />
      ) : null}
    </>
  );
}

function PolicyDetail({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const tuition = policy.items.filter((i) => i.type === 'tuition').reduce((s, i) => s + i.amount, 0);
  return (
    <Drawer open title={`${policy.name} · phiên bản ${policy.versionNo}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="stack">
        <KV items={[
          ['Hiệu lực', `${policy.effectiveFrom ? formatDate(policy.effectiveFrom) : 'Chưa đặt'}${policy.effectiveTo ? ` đến ${formatDate(policy.effectiveTo)}` : ''}`],
          ['Hạn đóng', policy.dueDay ? `Ngày ${policy.dueDay} hằng tháng` : '—'],
          ['Nhập học giữa kỳ', policy.proration === 'daily' ? 'Tính theo ngày' : 'Thu đủ tháng'],
          ['Học thử', policy.includeTrial ? 'Có thu' : 'Không thu'],
          ['Tổng học phí cơ bản', <span key="t" style={moneyStyle}>{formatVnd(tuition)}</span>],
        ]} />
        <Card title="Khoản thu">
          {policy.items.length === 0 ? <p className="text-secondary">Chưa có khoản thu.</p> : (
            <table className="dt"><caption className="sr-only">Khoản thu của biểu phí</caption>
              <thead><tr><th scope="col">Mã</th><th scope="col">Khoản</th><th scope="col">Loại</th><th scope="col" className="num">Số tiền</th></tr></thead>
              <tbody>{policy.items.map((i) => <tr key={i.code}><td>{i.code}</td><td>{i.name}</td><td>{TYPE_LABEL[i.type] ?? i.type}</td><td className="num" style={moneyStyle}>{formatVnd(i.amount)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card title="Ưu đãi, giảm trừ">
          {policy.discounts.length === 0 ? <p className="text-secondary">Không có ưu đãi.</p> : (
            <table className="dt"><caption className="sr-only">Ưu đãi của biểu phí</caption>
              <thead><tr><th scope="col">Mã</th><th scope="col">Ưu đãi</th><th scope="col" className="num">Số tiền giảm</th></tr></thead>
              <tbody>{policy.discounts.map((i) => <tr key={i.code}><td>{i.code}</td><td>{i.name}</td><td className="num" style={moneyStyle}>-{formatVnd(i.amount)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card title="Tiền ăn">
          {policy.meal ? (
            <KV columns={1} items={[
              ['Đơn giá', <span key="p" style={moneyStyle}>{formatVnd(policy.meal.unitPrice)} / suất</span>],
              ['Cách tính', MEAL_MODE[policy.meal.mode] ?? policy.meal.mode],
              ['Số ngày ăn dự kiến', policy.meal.daysPerMonth ? `${policy.meal.daysPerMonth} ngày/tháng` : 'Theo số ngày học của kỳ'],
            ]} />
          ) : <p className="text-secondary">Biểu phí này không thu tiền ăn.</p>}
        </Card>
        {policy.note ? <p className="text-small">{policy.note}</p> : null}
      </div>
    </Drawer>
  );
}

/** W29 — Biểu phí và dịch vụ: phiên bản + ngày hiệu lực; sửa biểu phí đã phát hành = tạo phiên bản mới. */
export function W29FeeSchedule(_props: ScreenProps) {
  void _props;
  const { can } = useScope();
  const ctx = useCampus();
  const q = useScopedQuery<Policy>('feePolicies', 'fees.read', toPolicy);
  const [form, setForm] = useState<{ policy: Policy | null; mode: Mode } | null>(null);
  const [detail, setDetail] = useState<Policy | null>(null);
  const [publish, setPublish] = useState<Policy | null>(null);
  const [pubDate, setPubDate] = useState('');
  const canWrite = !!ctx && can('fees.write', ctx.campusId);

  const rows = useMemo(() => [...q.data].sort((a, b) => a.seriesId.localeCompare(b.seriesId) || b.versionNo - a.versionNo), [q.data]);
  const columns: Column<Policy>[] = [
    { key: 'name', header: 'Biểu phí', value: (r) => r.name, sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'version', header: 'Phiên bản', value: (r) => r.versionNo, render: (r) => `v${r.versionNo}` },
    { key: 'from', header: 'Hiệu lực', value: (r) => r.effectiveFrom, sortable: true, render: (r) => (r.effectiveFrom ? `${formatDate(r.effectiveFrom)}${r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : ' – nay'}` : 'Chưa đặt') },
    { key: 'items', header: 'Khoản thu', value: (r) => r.items.length, render: (r) => `${r.items.length} khoản${r.discounts.length ? `, ${r.discounts.length} ưu đãi` : ''}` },
    { key: 'meal', header: 'Tiền ăn', value: (r) => r.meal?.unitPrice ?? 0, align: 'right', render: (r) => (r.meal ? <span style={moneyStyle}>{formatVnd(r.meal.unitPrice)}/suất</span> : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => { const s = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone }; return <Badge tone={s.tone}>{s.label}</Badge>; } },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>Xem</Button>
          {canWrite && r.status === 'draft' ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setForm({ policy: r, mode: 'edit' }); }}>Sửa</Button> : null}
          {canWrite && r.status === 'draft' ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setPubDate(r.effectiveFrom); setPublish(r); }}>Phát hành</Button> : null}
          {canWrite && r.status === 'published' ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setForm({ policy: r, mode: 'version' }); }}>Tạo phiên bản mới</Button> : null}
        </div>
      ),
    },
  ];
  const filters: TableFilter<Policy>[] = [{ key: 'status', label: 'Trạng thái', options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }];

  return (
    <div>
      <PageHeader
        title="Biểu phí và dịch vụ"
        code="W29"
        description="Mỗi lần thay đổi biểu phí đã phát hành tạo một phiên bản mới có ngày hiệu lực. Khoản phải thu đã lập không bị đổi."
        actions={canWrite ? <Button icon="plus" onClick={() => setForm({ policy: null, mode: 'create' })}>Tạo biểu phí</Button> : undefined}
      />
      <div className="stack">
        <Banner tone="info" title="Quy tắc tính tiền ăn">
          Tạm thu: tính theo số ngày ăn dự kiến, kỳ sau hoàn trừ suất đã hủy kịp giờ chốt. Thực tế: tính theo suất đã phục vụ và đủ điều kiện. Mỗi suất chỉ tính hoặc hoàn một lần; báo nghỉ muộn hơn giờ chốt không tự hoàn tiền.
        </Banner>
        <DataTable
          caption="Biểu phí và phiên bản"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          status={q.status}
          error={q.error?.message}
          onRetry={q.retry}
          onRowClick={setDetail}
          searchText={(r) => `${r.name} ${r.code}`}
          searchPlaceholder="Tìm theo tên hoặc mã biểu phí"
          filters={filters}
          emptyTitle="Chưa có biểu phí nào"
          emptyDescription="Tạo biểu phí đầu tiên với học phí, dịch vụ, ưu đãi và quy tắc tiền ăn trước khi lập kỳ thu."
          emptyAction={canWrite ? <Button icon="plus" onClick={() => setForm({ policy: null, mode: 'create' })}>Tạo biểu phí</Button> : undefined}
        />
      </div>
      {form ? <PolicyForm key={`${form.mode}-${form.policy?.id ?? 'new'}`} policy={form.policy} mode={form.mode} onClose={() => setForm(null)} /> : null}
      {detail ? <PolicyDetail policy={detail} onClose={() => setDetail(null)} /> : null}
      {publish && ctx ? (
        <ActionDialog
          title={`Phát hành biểu phí ${publish.name}`}
          subject={`Phiên bản ${publish.versionNo}`}
          impact={[
            `Biểu phí có hiệu lực từ ${pubDate ? formatDate(pubDate) : 'ngày bạn chọn'}; phiên bản đang áp dụng (nếu có) kết thúc vào ngày liền trước.`,
            'Sau khi phát hành không sửa trực tiếp được nữa; muốn đổi phải tạo phiên bản mới.',
            'Khoản phải thu đã lập không bị thay đổi.',
          ]}
          confirmLabel="Phát hành biểu phí"
          success="Đã phát hành biểu phí."
          validate={() => (pubDate ? null : 'Chọn ngày hiệu lực.')}
          run={(opId) => callApi('feePolicy.publish', { orgId: ctx.orgId, campusId: ctx.campusId, opId, payload: { id: publish.id, effectiveFrom: pubDate } })}
          onClose={() => setPublish(null)}
        >
          <FormField name="pubDate" label="Ngày hiệu lực" required><DateInput name="pubDate" value={pubDate} onValueChange={setPubDate} /></FormField>
        </ActionDialog>
      ) : null}
    </div>
  );
}
