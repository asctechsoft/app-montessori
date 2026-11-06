'use client';
import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { dayKey as dayKeyOf, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, Textarea, DateInput, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { ScreenProps } from '../registry';
import { KV, useCall, useCampusCtx, useCampusDocs, useOrgDoc, num, text, toDate } from './parts/kit';
import { Tag } from './parts/statuses';
import { FormAction } from './parts/opsKit';

interface Dish { name: string; allergens: string[] }
interface Meal { session: string; dishes: Dish[] }
interface Conflict { childId: string; childName: string; classId?: string; session: string; dish: string; allergen: string }
interface Sub { childId: string; dish: string; replacement: string }
interface MenuRow {
  id: string; dayKey: string; title: string; ageGroup: string; classIds: string[]; meals: Meal[]; status: string; note: string;
  allergyWarnings: Conflict[]; substitutions: Sub[]; decisionNote: string; version?: number;
}

const SESSIONS: Record<string, string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', afternoon: 'Bữa phụ chiều', snack: 'Bữa phụ' };
const sessionLabel = (s: string) => SESSIONS[s] ?? s;

const toMenu = (id: string, d: Record<string, unknown>): MenuRow => ({
  id,
  dayKey: text(d.dayKey),
  title: text(d.title),
  ageGroup: text(d.ageGroup),
  classIds: Array.isArray(d.classIds) ? (d.classIds as string[]) : [],
  meals: Array.isArray(d.meals)
    ? (d.meals as Record<string, unknown>[]).map((m) => ({
        session: text(m.session),
        dishes: Array.isArray(m.dishes) ? (m.dishes as Record<string, unknown>[]).map((x) => ({ name: text(x.name), allergens: Array.isArray(x.allergens) ? (x.allergens as string[]) : [] })) : [],
      }))
    : [],
  status: text(d.status, 'draft'),
  note: text(d.note),
  allergyWarnings: Array.isArray(d.allergyWarnings) ? (d.allergyWarnings as Conflict[]) : [],
  substitutions: Array.isArray(d.substitutions) ? (d.substitutions as Sub[]) : [],
  decisionNote: text(d.decisionNote),
  version: typeof d.version === 'number' ? d.version : undefined,
});

const dishesToText = (dishes: Dish[]) => dishes.map((d) => (d.allergens.length ? `${d.name} | ${d.allergens.join(', ')}` : d.name)).join('\n');
const textToDishes = (t: string): Dish[] =>
  t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, al] = l.split('|');
    return { name: name.trim(), allergens: (al ?? '').split(',').map((x) => x.trim()).filter(Boolean) };
  });

interface MealDraft { session: string; text: string }

/* ------------------------------------------------------------------ soạn thực đơn */

function MenuEditor({ menu, onClose, classes }: { menu: MenuRow | null; onClose: () => void; classes: { id: string; name: string }[] }) {
  const call = useCall();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const [meals, setMeals] = useState<MealDraft[]>(
    menu?.meals.length ? menu.meals.map((m) => ({ session: m.session, text: dishesToText(m.dishes) })) : [{ session: 'lunch', text: '' }],
  );
  const [classIds, setClassIds] = useState<string[]>(menu?.classIds ?? []);
  const [mealErr, setMealErr] = useState('');
  const form = useForm({
    initial: { dayKey: menu?.dayKey ?? '', title: menu?.title ?? '', ageGroup: menu?.ageGroup ?? '', note: menu?.note ?? '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.dayKey) e.dayKey = 'Chọn ngày áp dụng.';
      return e;
    },
  });
  const submit = form.onSubmit(async (v, opId) => {
    const used = meals.filter((m) => m.text.trim());
    if (used.length === 0) {
      setMealErr('Nhập ít nhất một bữa có món ăn.');
      throw new ApiError('VALIDATION', 'Thực đơn cần ít nhất một bữa có món ăn.');
    }
    if (new Set(used.map((m) => m.session)).size !== used.length) {
      setMealErr('Mỗi bữa chỉ khai báo một lần.');
      throw new ApiError('VALIDATION', 'Mỗi bữa chỉ khai báo một lần.');
    }
    setMealErr('');
    const data: Record<string, unknown> = {
      dayKey: v.dayKey, title: v.title.trim() || undefined, ageGroup: v.ageGroup.trim() || undefined, note: v.note.trim() || undefined,
      classIds, meals: used.map((m) => ({ session: m.session, dishes: textToDishes(m.text) })),
    };
    await call('entity.save', { collection: 'menus', id: menu?.id, data, expectedVersion: menu?.version }, opId);
    toast.success(menu ? 'Đã lưu thực đơn nháp.' : 'Đã tạo thực đơn nháp.');
    form.reset();
    onClose();
  });
  const dirty = form.dirty || meals.length !== 1 || meals[0].text !== (menu ? dishesToText(menu.meals[0]?.dishes ?? []) : '');
  const close = async () => {
    if (dirty && !(await confirmDiscard('đóng biểu mẫu thực đơn'))) return;
    onClose();
  };
  return (
    <Drawer
      open
      title={menu ? 'Sửa thực đơn nháp' : 'Soạn thực đơn'}
      onClose={() => void close()}
      locked={form.submitting}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()} disabled={form.submitting}>Hủy</Button>
          <Button onClick={() => void submit()} loading={form.submitting}>Lưu nháp</Button>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={submit}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        {form.apiError?.code === 'VERSION_CONFLICT' ? <Banner tone="warning">Thực đơn vừa được người khác sửa. Đóng biểu mẫu để xem bản mới nhất rồi sửa lại.</Banner> : null}
        <FormField name="dayKey" label="Ngày áp dụng" required {...form.field('dayKey')}>
          <DateInput {...form.bind('dayKey')} />
        </FormField>
        <FormField name="title" label="Tên thực đơn" {...form.field('title')}>
          <Input {...form.bind('title')} />
        </FormField>
        <FormField name="ageGroup" label="Nhóm tuổi" {...form.field('ageGroup')}>
          <Input {...form.bind('ageGroup')} />
        </FormField>
        {classes.length ? (
          <FormField name="classIds" label="Áp dụng cho lớp" helper="Không chọn = toàn cơ sở.">
            <div id="field-classIds">
              {classes.map((c) => (
                <Checkbox key={c.id} checked={classIds.includes(c.id)} onChange={(on) => setClassIds(on ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))}>{c.name}</Checkbox>
              ))}
            </div>
          </FormField>
        ) : null}
        <div className="stack-sm">
          <strong>Các bữa ăn</strong>
          {mealErr ? <Banner tone="error">{mealErr}</Banner> : null}
          {meals.map((m, i) => (
            <Card key={i}>
              <div className="stack-sm">
                <div className="row">
                  <div style={{ minWidth: 180 }}>
                    <FormField name={`session-${i}`} label="Bữa">
                      <Select name={`session-${i}`} value={m.session} onValueChange={(v) => setMeals(meals.map((x, j) => (j === i ? { ...x, session: v } : x)))} options={Object.entries(SESSIONS).map(([value, label]) => ({ value, label }))} />
                    </FormField>
                  </div>
                  {meals.length > 1 ? <Button size="sm" variant="tertiary" onClick={() => setMeals(meals.filter((_, j) => j !== i))}>Bỏ bữa này</Button> : null}
                </div>
                <FormField name={`dishes-${i}`} label="Món ăn" helper="Mỗi dòng một món. Ghi chất dị ứng sau dấu |, cách nhau dấu phẩy. Ví dụ: Cháo thịt | sữa, trứng">
                  <Textarea name={`dishes-${i}`} value={m.text} onValueChange={(v) => setMeals(meals.map((x, j) => (j === i ? { ...x, text: v } : x)))} rows={4} />
                </FormField>
              </div>
            </Card>
          ))}
          {meals.length < 4 ? <Button size="sm" variant="secondary" icon="plus" onClick={() => setMeals([...meals, { session: 'breakfast', text: '' }])}>Thêm bữa</Button> : null}
        </div>
        <FormField name="note" label="Ghi chú" {...form.field('note')}>
          <Textarea {...form.bind('note')} />
        </FormField>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ gửi duyệt (kiểm tra dị ứng) */

function SubmitDialog({ menu, onClose, onReload }: { menu: MenuRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [conflicts, setConflicts] = useState<Conflict[]>(menu.allergyWarnings);
  const [repl, setRepl] = useState<Record<string, string>>(() => Object.fromEntries(menu.substitutions.map((s) => [`${s.childId}|${s.dish}`, s.replacement])));
  const keyOf = (c: Conflict) => `${c.childId}|${c.dish}`;
  return (
    <FormAction
      title="Gửi duyệt thực đơn"
      subject={`Ngày ${formatDate(menu.dayKey)}${menu.title ? ` · ${menu.title}` : ''}`}
      impact={[
        'Hệ thống kiểm tra dị ứng và chế độ ăn của trẻ đang học trong phạm vi thực đơn.',
        'Trẻ không dùng được món phải có món thay thế trước khi gửi.',
        'Thực đơn chuyển sang «Chờ duyệt» và không sửa được cho đến khi được xử lý.',
      ]}
      confirmLabel="Gửi duyệt"
      success="Đã gửi duyệt thực đơn."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        for (const c of conflicts) if (!(repl[keyOf(c)] ?? '').trim()) e[keyOf(c)] = 'Nhập món thay thế.';
        return e;
      }}
      run={async (opId) => {
        const substitutions = Object.entries(repl)
          .filter(([, r]) => r.trim())
          .map(([k, r]) => {
            const [childId, ...rest] = k.split('|');
            return { childId, dish: rest.join('|'), replacement: r.trim() };
          });
        try {
          return await call('menu.submit', { id: menu.id, substitutions }, opId);
        } catch (e) {
          if (e instanceof ApiError && e.details.reason === 'ALLERGY_SUBSTITUTION_REQUIRED' && Array.isArray(e.details.conflicts)) setConflicts(e.details.conflicts as Conflict[]);
          throw e;
        }
      }}
    >
      {(errs) =>
        conflicts.length ? (
          <div className="stack-sm">
            <Banner tone="warning" title={`${conflicts.length} trường hợp trẻ không dùng được món`}>Nhập món thay thế cho từng trẻ rồi gửi lại.</Banner>
            {conflicts.map((c) => (
              <FormField key={keyOf(c)} name={`sub-${keyOf(c)}`} label={`${c.childName}: ${sessionLabel(c.session)} · món «${c.dish}» (chứa ${c.allergen})`} error={errs[keyOf(c)]}>
                <Input name={`sub-${keyOf(c)}`} value={repl[keyOf(c)] ?? ''} onValueChange={(v) => setRepl({ ...repl, [keyOf(c)]: v })} placeholder="Món thay thế" />
              </FormField>
            ))}
          </div>
        ) : null
      }
    </FormAction>
  );
}

function DecideDialog({ menu, decision, onClose, onReload }: { menu: MenuRow; decision: 'approved' | 'rejected'; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [note, setNote] = useState('');
  const ok = decision === 'approved';
  return (
    <FormAction
      title={ok ? 'Duyệt thực đơn' : 'Từ chối thực đơn'}
      subject={`Ngày ${formatDate(menu.dayKey)}${menu.title ? ` · ${menu.title}` : ''}`}
      impact={ok ? ['Thực đơn chuyển sang «Đã duyệt»; bếp có thể công bố cho phụ huynh.', 'Người gửi duyệt không được tự duyệt.'] : ['Thực đơn trả về cho bếp chỉnh sửa.', 'Lý do từ chối được lưu và ghi nhật ký.']}
      confirmLabel={ok ? 'Duyệt thực đơn' : 'Từ chối thực đơn'}
      tone={ok ? 'primary' : 'destructive'}
      success={ok ? 'Đã duyệt thực đơn.' : 'Đã từ chối thực đơn.'}
      onClose={onClose}
      onReload={onReload}
      check={(): Record<string, string> => (!ok && note.trim().length < 3 ? { note: 'Nhập lý do từ chối.' } : {})}
      run={(opId) => call('menu.approve', { id: menu.id, decision, note: note.trim() || undefined }, opId)}
    >
      {(errs) => (
        <FormField name="note" label={ok ? 'Ghi chú (tùy chọn)' : 'Lý do'} required={!ok} error={errs.note}>
          <Textarea name="note" value={note} onValueChange={setNote} />
        </FormField>
      )}
    </FormAction>
  );
}

function PublishDialog({ menu, onClose, onReload }: { menu: MenuRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const kids = new Set(menu.substitutions.map((s) => s.childId)).size;
  return (
    <FormAction
      title="Công bố thực đơn"
      subject={`Ngày ${formatDate(menu.dayKey)}${menu.title ? ` · ${menu.title}` : ''}`}
      impact={[
        'Phụ huynh của cơ sở sẽ xem được thực đơn này.',
        kids ? `${kids} trẻ dị ứng đã có món thay thế được ghi nhận.` : 'Không có trẻ nào cần món thay thế.',
        'Hệ thống kiểm tra lại dị ứng lúc công bố; nếu có trẻ mới cần món thay thế sẽ yêu cầu gửi duyệt lại.',
      ]}
      confirmLabel="Công bố"
      success="Đã công bố thực đơn."
      onClose={onClose}
      onReload={onReload}
      check={() => ({})}
      run={(opId) => call('menu.publish', { id: menu.id }, opId)}
    >
      {() => null}
    </FormAction>
  );
}

function MenuDetail({ menu, onClose }: { menu: MenuRow; onClose: () => void }) {
  return (
    <Drawer open title={`Thực đơn ngày ${formatDate(menu.dayKey)}`} onClose={onClose}>
      <div className="stack">
        <KV items={[['Trạng thái', <Tag key="s" domain="menu" value={menu.status} />], ['Tên', menu.title], ['Nhóm tuổi', menu.ageGroup], ['Ghi chú', menu.note]]} />
        {menu.decisionNote ? <Banner tone={menu.status === 'rejected' ? 'error' : 'info'} title="Ý kiến người duyệt">{menu.decisionNote}</Banner> : null}
        {menu.meals.map((m) => (
          <Card key={m.session} title={sessionLabel(m.session)}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {m.dishes.map((d, i) => (
                <li key={i}>{d.name}{d.allergens.length ? <span className="text-secondary"> — chứa: {d.allergens.join(', ')}</span> : null}</li>
              ))}
            </ul>
          </Card>
        ))}
        {menu.allergyWarnings.length ? (
          <Card title="Cảnh báo dị ứng khi gửi duyệt">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {menu.allergyWarnings.map((c, i) => {
                const sub = menu.substitutions.find((s) => s.childId === c.childId && s.dish === c.dish);
                return <li key={i}>{c.childName}: «{c.dish}» chứa {c.allergen} → {sub ? `thay bằng «${sub.replacement}»` : 'chưa có món thay thế'}</li>;
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ tab thực đơn */

function MenusTab() {
  const c = useCampusCtx();
  const q = useCampusDocs<MenuRow>('menus', toMenu);
  const cls = useCampusDocs<{ id: string; name: string }>('classes', (id, d) => ({ id, name: text(d.name, id) }), { tag: 'menu-classes' });
  const [edit, setEdit] = useState<MenuRow | 'new' | null>(null);
  const [submitFor, setSubmitFor] = useState<MenuRow | null>(null);
  const [decide, setDecide] = useState<{ menu: MenuRow; decision: 'approved' | 'rejected' } | null>(null);
  const [publishFor, setPublishFor] = useState<MenuRow | null>(null);
  const [view, setView] = useState<MenuRow | null>(null);
  const canWrite = c.can('kitchen.write');
  const canDecide = c.can('campus.manage');
  const rows = useMemo(() => [...q.data].sort((a, b) => b.dayKey.localeCompare(a.dayKey)), [q.data]);

  const columns: Column<MenuRow>[] = [
    { key: 'day', header: 'Ngày', value: (r) => r.dayKey, sortable: true, render: (r) => <strong>{formatDate(r.dayKey)}</strong> },
    { key: 'title', header: 'Thực đơn', value: (r) => r.title || r.ageGroup, render: (r) => r.title || r.ageGroup || '—' },
    { key: 'meals', header: 'Bữa ăn', render: (r) => r.meals.map((m) => `${sessionLabel(m.session)} (${m.dishes.length} món)`).join(', ') || '—' },
    { key: 'warn', header: 'Dị ứng', render: (r) => (r.allergyWarnings.length ? <Badge tone="warning">{new Set(r.allergyWarnings.map((w) => w.childId)).size} trẻ cần thay món</Badge> : <span className="text-secondary">—</span>) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <Tag domain="menu" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (
        <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
          {canWrite && (r.status === 'draft' || r.status === 'rejected') ? <Button size="sm" variant="tertiary" onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Sửa</Button> : null}
          {canWrite && (r.status === 'draft' || r.status === 'rejected') ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setSubmitFor(r); }}>Gửi duyệt</Button> : null}
          {canDecide && r.status === 'submitted' ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setDecide({ menu: r, decision: 'approved' }); }}>Duyệt</Button> : null}
          {canDecide && r.status === 'submitted' ? <Button size="sm" variant="destructiveOutline" onClick={(e) => { e.stopPropagation(); setDecide({ menu: r, decision: 'rejected' }); }}>Từ chối</Button> : null}
          {canWrite && r.status === 'approved' ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setPublishFor(r); }}>Công bố</Button> : null}
        </div>
      ),
    },
  ];
  const filters: TableFilter<MenuRow>[] = [
    { key: 'status', label: 'Trạng thái', options: Object.entries({ draft: 'Nháp', submitted: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', published: 'Đã công bố' }).map(([value, label]) => ({ value, label })), predicate: (r, v) => r.status === v },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Danh sách thực đơn"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={q.status}
        error={q.error?.message}
        onRetry={q.retry}
        onRowClick={setView}
        searchText={(r) => `${r.dayKey} ${r.title} ${r.ageGroup}`}
        searchPlaceholder="Tìm theo ngày, tên thực đơn"
        filters={filters}
        toolbarExtra={canWrite ? <Button icon="plus" onClick={() => setEdit('new')}>Soạn thực đơn</Button> : undefined}
        emptyTitle="Chưa có thực đơn"
        emptyDescription="Soạn thực đơn nháp, gửi duyệt rồi công bố cho phụ huynh."
      />
      {edit ? <MenuEditor key={edit === 'new' ? 'new' : edit.id} menu={edit === 'new' ? null : edit} classes={cls.data} onClose={() => setEdit(null)} /> : null}
      {submitFor ? <SubmitDialog key={submitFor.id} menu={submitFor} onClose={() => setSubmitFor(null)} onReload={q.retry} /> : null}
      {decide ? <DecideDialog key={decide.menu.id + decide.decision} menu={decide.menu} decision={decide.decision} onClose={() => setDecide(null)} onReload={q.retry} /> : null}
      {publishFor ? <PublishDialog key={publishFor.id} menu={publishFor} onClose={() => setPublishFor(null)} onReload={q.retry} /> : null}
      {view ? <MenuDetail menu={view} onClose={() => setView(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ tab chốt suất ăn */

interface Adj { at: unknown; by: string; from: boolean; to: boolean; reason: string }
interface OrderRow {
  id: string; childId: string; childName: string; classId: string; expected: boolean; locked: boolean; served: boolean | null; billable: boolean;
  cancelled: boolean; afterCutoffLeaveId: string; adjustments: Adj[]; version?: number;
}
const toOrder = (id: string, d: Record<string, unknown>): OrderRow => ({
  id, childId: text(d.childId), childName: text(d.childName, id), classId: text(d.classId), expected: d.expected === true, locked: d.locked === true,
  served: typeof d.served === 'boolean' ? d.served : null, billable: d.billable === true, cancelled: d.cancelled === true,
  afterCutoffLeaveId: text(d.afterCutoffLeaveId), adjustments: Array.isArray(d.adjustments) ? (d.adjustments as Adj[]) : [],
  version: typeof d.version === 'number' ? d.version : undefined,
});

function LockDialog({ dayKey, cutoff, onClose, onReload }: { dayKey: string; cutoff: string; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  return (
    <FormAction
      title="Chốt suất ăn"
      subject={`Ngày ${formatDate(dayKey)}`}
      impact={[
        `Hệ thống lập danh sách suất DỰ KIẾN từ trẻ đang học (có ăn bán trú) và ĐÃ CHỐT cho bếp; đơn nghỉ được duyệt trước giờ chốt${cutoff ? ` (${cutoff})` : ''} sẽ hủy suất.`,
        'Đơn nghỉ gửi/duyệt sau giờ chốt vẫn tính suất vì bếp đã chuẩn bị.',
        'Chốt xong KHÔNG chốt lại được; mọi sửa đổi sau đó là điều chỉnh có lý do và được lưu vết.',
        'Suất dự kiến, đã chốt, thực tế và tính tiền là bốn giá trị riêng.',
      ]}
      confirmLabel="Chốt suất"
      success="Đã chốt suất ăn."
      onClose={onClose}
      onReload={onReload}
      check={() => ({})}
      run={(opId) => call('meal.lock', { dayKey }, opId)}
    >
      {() => null}
    </FormAction>
  );
}

function ServedDialog({ dayKey, order, onClose, onReload }: { dayKey: string; order: OrderRow; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  const [served, setServed] = useState(order.served === null ? '' : order.served ? 'yes' : 'no');
  const [billable, setBillable] = useState(order.billable ? 'yes' : 'no');
  const [reason, setReason] = useState('');
  const changed = (billable === 'yes') !== order.billable;
  return (
    <FormAction
      title="Ghi suất thực tế"
      subject={`${order.childName} · ${formatDate(dayKey)}`}
      impact={[
        'Ghi nhận trẻ có ăn thực tế hay không (không đổi suất đã chốt).',
        changed ? 'Đổi kết quả TÍNH TIỀN sau chốt: lưu lịch sử (từ → sang, lý do, người, thời điểm), không xóa dấu vết.' : 'Kết quả tính tiền giữ nguyên.',
      ]}
      confirmLabel="Lưu"
      success="Đã ghi suất thực tế."
      onClose={onClose}
      onReload={onReload}
      check={() => {
        const e: Record<string, string> = {};
        if (served === '' && !changed) e.served = 'Chọn tình trạng ăn thực tế hoặc đổi kết quả tính tiền.';
        if (changed && reason.trim().length < 5) e.reason = 'Nhập lý do (tối thiểu 5 ký tự).';
        return e;
      }}
      run={(opId) => {
        const item: Record<string, unknown> = { childId: order.childId };
        if (served) item.served = served === 'yes';
        if (changed) { item.billable = billable === 'yes'; item.reason = reason.trim(); }
        return call('meal.recordServed', { dayKey, items: [item] }, opId);
      }}
    >
      {(errs) => (
        <div className="stack-sm">
          <FormField name="served" label="Thực tế" error={errs.served}>
            <Select name="served" value={served} onValueChange={setServed} placeholder="Chưa ghi" options={[{ value: 'yes', label: 'Có ăn' }, { value: 'no', label: 'Không ăn' }]} />
          </FormField>
          <FormField name="billable" label="Tính tiền">
            <Select name="billable" value={billable} onValueChange={setBillable} options={[{ value: 'yes', label: 'Tính tiền' }, { value: 'no', label: 'Không tính tiền' }]} />
          </FormField>
          {changed ? (
            <FormField name="reason" label="Lý do điều chỉnh" required error={errs.reason}>
              <Textarea name="reason" value={reason} onValueChange={setReason} />
            </FormField>
          ) : null}
          {order.adjustments.length ? (
            <div>
              <div className="text-caption text-secondary">Lịch sử điều chỉnh</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {order.adjustments.map((a, i) => (
                  <li key={i}>{formatDateTime(toDate(a.at as never))}: {a.from ? 'tính tiền' : 'không tính'} → {a.to ? 'tính tiền' : 'không tính'} — {a.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </FormAction>
  );
}

function BulkServedDialog({ dayKey, ids, onClose, onReload }: { dayKey: string; ids: string[]; onClose: () => void; onReload: () => void }) {
  const call = useCall();
  return (
    <FormAction
      title="Ghi tất cả suất đã chốt là đã phục vụ"
      subject={`Ngày ${formatDate(dayKey)} · ${ids.length} suất`}
      impact={['Đánh dấu «Có ăn» cho các suất đã chốt mà chưa ghi thực tế.', 'Không đổi kết quả tính tiền. Sau đó vẫn sửa riêng từng trẻ được.']}
      confirmLabel={`Ghi ${ids.length} suất`}
      success="Đã ghi suất thực tế."
      onClose={onClose}
      onReload={onReload}
      check={() => ({})}
      run={(opId) => call('meal.recordServed', { dayKey, items: ids.map((childId) => ({ childId, served: true })) }, opId)}
    >
      {() => null}
    </FormAction>
  );
}

function MealsTab() {
  const c = useCampusCtx();
  const [day, setDay] = useState(() => dayKeyOf(new Date(), c.tz));
  const lock = useOrgDoc(day && c.campusId ? ['mealLocks', `${c.campusId}_${day}`] : null, (id, d) => d as Record<string, unknown>);
  const orders = useCampusDocs<OrderRow>('mealOrders', toOrder, { where: [['dayKey', '==', day]], enabled: !!day, tag: day });
  const classes = useCampusDocs<{ id: string; name: string }>('classes', (id, d) => ({ id, name: text(d.name, id) }), { tag: 'meal-classes' });
  const clsName = (id: string) => classes.data.find((x) => x.id === id)?.name ?? id;
  const [lockOpen, setLockOpen] = useState(false);
  const [recFor, setRecFor] = useState<OrderRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const locked = lock.status === 'ready';
  const canWrite = c.can('kitchen.write');
  const stats = useMemo(() => {
    const o = orders.data;
    return {
      expected: o.filter((x) => x.expected).length, locked: o.filter((x) => x.locked).length, cancelled: o.filter((x) => x.cancelled).length,
      served: o.filter((x) => x.served === true).length, billable: o.filter((x) => x.billable).length, pending: o.filter((x) => x.locked && x.served === null).map((x) => x.childId),
    };
  }, [orders.data]);
  const cutoff = text(lock.data?.cutoff);

  const columns: Column<OrderRow>[] = [
    { key: 'child', header: 'Trẻ', value: (r) => r.childName, sortable: true, render: (r) => <strong>{r.childName}</strong> },
    { key: 'class', header: 'Lớp', value: (r) => clsName(r.classId), render: (r) => clsName(r.classId) || '—' },
    { key: 'expected', header: 'Dự kiến', value: (r) => (r.expected ? 1 : 0), render: (r) => (r.expected ? 'Có' : 'Không') },
    { key: 'locked', header: 'Đã chốt', value: (r) => (r.locked ? 1 : 0), render: (r) => (r.locked ? <Badge tone="success">Đã chốt</Badge> : <Badge tone="neutral">Hủy suất</Badge>) },
    { key: 'served', header: 'Thực tế', value: (r) => (r.served === null ? -1 : r.served ? 1 : 0), render: (r) => (r.served === null ? <span className="text-secondary">Chưa ghi</span> : r.served ? 'Có ăn' : 'Không ăn') },
    { key: 'billable', header: 'Tính tiền', value: (r) => (r.billable ? 1 : 0), render: (r) => (r.billable ? 'Tính tiền' : 'Không tính') },
    {
      key: 'note', header: 'Ghi chú',
      render: (r) => (
        <div className="stack-sm" style={{ gap: 2 }}>
          {r.cancelled ? <span className="text-small">Nghỉ được duyệt trước giờ chốt</span> : null}
          {r.afterCutoffLeaveId ? <span className="text-small">Nghỉ sau giờ chốt: vẫn tính suất</span> : null}
          {r.adjustments.length ? <Badge tone="info">{r.adjustments.length} lần điều chỉnh</Badge> : null}
        </div>
      ),
    },
    { key: 'actions', header: 'Thao tác', render: (r) => (canWrite ? <Button size="sm" variant="tertiary" onClick={() => setRecFor(r)}>Ghi thực tế</Button> : null) },
  ];

  return (
    <div className="stack">
      <div className="row">
        <div style={{ width: 200 }}>
          <FormField name="mealDay" label="Ngày">
            <DateInput name="mealDay" value={day} onValueChange={setDay} />
          </FormField>
        </div>
        {canWrite && day && lock.status === 'empty' ? <Button onClick={() => setLockOpen(true)}>Chốt suất ngày này</Button> : null}
        {canWrite && locked && stats.pending.length ? <Button variant="secondary" onClick={() => setBulk(true)}>Ghi tất cả đã phục vụ ({stats.pending.length})</Button> : null}
      </div>
      {lock.status === 'error' ? <Banner tone="error" title="Không đọc được trạng thái chốt">{lock.error?.message}</Banner> : null}
      {lock.status === 'empty' ? <Banner tone="info">Ngày {formatDate(day)} chưa chốt suất. Suất dự kiến, đã chốt, thực tế và tính tiền sẽ hiện sau khi chốt.</Banner> : null}
      {locked ? (
        <Banner tone="success">Đã chốt lúc {formatDateTime(toDate(lock.data?.lockedAt as never), c.tz)}{cutoff ? ` · giờ chốt nghỉ ${cutoff}` : ''}. Sửa sau chốt phải kèm lý do và được lưu vết.</Banner>
      ) : null}
      <div className="grid-4">
        <Stat label="Dự kiến" value={num(lock.data?.expected, stats.expected)} hint="Trẻ đang học có ăn bán trú" />
        <Stat label="Đã chốt cho bếp" value={num(lock.data?.locked, stats.locked)} hint={`${num(lock.data?.cancelled, stats.cancelled)} suất hủy do nghỉ`} />
        <Stat label="Thực tế đã phục vụ" value={stats.served} hint="Do bếp ghi nhận" />
        <Stat label="Tính tiền" value={stats.billable} hint="Kết quả cuối cùng để tính phí" />
      </div>
      <DataTable
        caption="Suất ăn theo trẻ"
        columns={columns}
        rows={orders.data}
        rowKey={(r) => r.id}
        status={orders.status}
        error={orders.error?.message}
        onRetry={orders.retry}
        searchText={(r) => r.childName}
        searchPlaceholder="Tìm theo tên trẻ"
        emptyTitle="Chưa có suất ăn nào"
        emptyDescription="Danh sách suất được tạo khi chốt suất ăn của ngày này."
      />
      {lockOpen ? <LockDialog dayKey={day} cutoff={cutoff} onClose={() => setLockOpen(false)} onReload={lock.retry} /> : null}
      {recFor ? <ServedDialog key={recFor.id} dayKey={day} order={recFor} onClose={() => setRecFor(null)} onReload={orders.retry} /> : null}
      {bulk ? <BulkServedDialog dayKey={day} ids={stats.pending} onClose={() => setBulk(false)} onReload={orders.retry} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ trang */

export function W37Menu({ screen }: ScreenProps) {
  const [tab, setTab] = useState('menus');
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} description="Soạn và duyệt thực đơn có kiểm tra dị ứng, chốt suất ăn theo giờ chốt, ghi suất thực tế." />
      <Tabs items={[{ id: 'menus', label: 'Thực đơn' }, { id: 'meals', label: 'Chốt suất ăn' }]} active={tab} onChange={setTab} />
      <div style={{ marginTop: 'var(--space-4)' }}>{tab === 'menus' ? <MenusTab /> : <MealsTab />}</div>
    </div>
  );
}
