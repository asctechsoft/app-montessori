'use client';
import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useForm } from '@/lib/hooks/useForm';
import { useDirtyGuard } from '@/lib/hooks/dirtyStore';
import { useScope } from '@/providers/ScopeProvider';
import { PERMISSION_GROUPS, PRINCIPAL_EXCLUDED, SYSTEM_ROLES, SYSTEM_ROLE_LABELS, permissionLabel } from '@/lib/permissions';
import { PageHeader, SkeletonText } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FormField, Input, Textarea, Checkbox } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';

interface CustomRole {
  id: string;
  name: string;
  description: string;
  perms: string[];
  version?: number;
}

interface RoleForm extends Record<string, unknown> {
  name: string;
  description: string;
  perms: string[];
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);

function RoleEditor({ role, existingNames, memberCount, onClose }: { role: CustomRole | null; existingNames: string[]; memberCount: number | null; onClose: () => void }) {
  const { org, canOrg } = useScope();
  const { confirmDiscard } = useDirtyGuard();
  const toast = useToast();
  const [pending, setPending] = useState<RoleForm | null>(null);

  const form = useForm<RoleForm>({
    initial: { name: role?.name ?? '', description: role?.description ?? '', perms: role?.perms ?? [] },
    validate: (v) => {
      const e: Record<string, string> = {};
      const n = v.name.trim();
      if (n.length < 2) e.name = 'Tên vai trò tối thiểu 2 ký tự.';
      else if (existingNames.some((x) => x.toLowerCase() === n.toLowerCase())) e.name = 'Tên vai trò đã được dùng.';
      if (v.perms.length === 0) e.perms = 'Chọn ít nhất một quyền cho vai trò.';
      return e;
    },
  });

  const save = useAsyncAction(async (opId: string, v: RoleForm) => {
    const id = role?.id;
    return callApi('role.save', {
      orgId: org!.orgId,
      opId,
      payload: { id, key: id ? undefined : slug(v.name) || undefined, name: v.name.trim(), description: v.description.trim(), perms: v.perms, expectedVersion: role?.version },
    });
  });

  const close = async () => {
    if (form.dirty && !(await confirmDiscard('đóng biểu mẫu vai trò'))) return;
    onClose();
  };

  const toggle = (id: string, on: boolean) => form.setValue('perms', on ? [...form.values.perms, id] : form.values.perms.filter((p) => p !== id));
  const title = role ? `Sửa vai trò ${role.name}` : 'Tạo vai trò mới';

  return (
    <>
      <Drawer
        open={!pending}
        title={title}
        onClose={() => void close()}
        footer={
          <>
            <Button variant="secondary" onClick={() => void close()}>Đóng</Button>
            <Button type="submit" form="role-form" loading={form.submitting}>{role ? 'Xem tác động và lưu' : 'Lưu vai trò mới'}</Button>
          </>
        }
      >
        <form id="role-form" className="stack" noValidate onSubmit={form.onSubmit(async (v) => { setPending(v); })}>
          {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
          <FormField name="name" label="Tên vai trò" required {...form.field('name')}>
            <Input {...form.bind('name')} />
          </FormField>
          <FormField name="description" label="Mô tả" {...form.field('description')}>
            <Textarea {...form.bind('description')} />
          </FormField>
          <FormField name="perms" label="Quyền của vai trò" required helper="Bạn chỉ đưa được vào vai trò những quyền chính bạn đang có ở phạm vi toàn tổ chức." {...form.field('perms')}>
            <div id="field-perms" tabIndex={-1} className="stack-sm">
              {PERMISSION_GROUPS.map((g) => (
                <fieldset key={g.title} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label" style={{ margin: 'var(--space-2) 0' }}>{g.title}</legend>
                  {g.perms.map((p) => (
                    <Checkbox key={p.id} checked={form.values.perms.includes(p.id)} disabled={!canOrg(p.id) && !form.values.perms.includes(p.id)} onChange={(on) => toggle(p.id, on)}>
                      {p.label} {PRINCIPAL_EXCLUDED.includes(p.id) ? <Badge tone="warning">Nhạy cảm</Badge> : null}
                    </Checkbox>
                  ))}
                </fieldset>
              ))}
            </div>
          </FormField>
        </form>
      </Drawer>
      <ConfirmDialog
        open={!!pending}
        title={role ? `Lưu thay đổi vai trò ${role.name}?` : 'Tạo vai trò mới?'}
        subject={pending?.name}
        impact={[
          `Vai trò có ${pending?.perms.length ?? 0} quyền.`,
          role
            ? memberCount === null
              ? 'Quyền của mọi nhân sự đang giữ vai trò này sẽ được tính lại ngay khi lưu.'
              : `Quyền của ${memberCount} tài khoản đang giữ vai trò này sẽ được tính lại ngay khi lưu.`
            : 'Vai trò chưa có hiệu lực cho tới khi được gán cho một tài khoản.',
          'Thay đổi được ghi vào nhật ký thao tác.',
        ]}
        confirmLabel={role ? 'Lưu vai trò' : 'Tạo vai trò'}
        cancelLabel="Quay lại chỉnh sửa"
        busy={save.busy}
        error={save.error?.message}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          const ok = await save.run(pending);
          if (ok) {
            toast.success(role ? 'Đã lưu vai trò.' : 'Đã tạo vai trò.');
            form.reset(pending);
            setPending(null);
            onClose();
          }
        }}
      />
    </>
  );
}

/** W06 — Vai trò và ma trận phân quyền. Vai trò hệ thống chỉ xem; vai trò tùy biến lưu qua role.save. */
export function W06Roles() {
  const { org, canOrg, canAnywhere } = useScope();
  const canEdit = canOrg('roles.manage');
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);

  const roles = useFirestoreQuery<CustomRole>(
    org && canAnywhere('members.read') ? `roles|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'roles'),
    (id, d) => ({ id, name: String(d.name ?? id), description: String(d.description ?? ''), perms: Array.isArray(d.perms) ? (d.perms as string[]) : [], version: d.version as number | undefined }),
  );
  const members = useFirestoreQuery<{ id: string; roleIds: string[] }>(
    org && canAnywhere('members.read') ? `members-roles|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'members'),
    (id, d) => ({ id, roleIds: ((d.grants as { roleId: string }[]) ?? []).map((g) => g.roleId) }),
  );

  const columns = useMemo(
    () => [
      ...Object.keys(SYSTEM_ROLES).filter((r) => r !== 'parent').map((id) => ({ id, label: SYSTEM_ROLE_LABELS[id] ?? id, perms: SYSTEM_ROLES[id], custom: null as CustomRole | null })),
      ...roles.data.map((r) => ({ id: r.id, label: r.name, perms: r.perms, custom: r })),
    ],
    [roles.data],
  );

  const memberCount = (roleId: string) => (members.status === 'ready' || members.status === 'empty' ? members.data.filter((m) => m.roleIds.includes(roleId)).length : null);

  return (
    <div>
      <PageHeader
        title="Vai trò và ma trận phân quyền"
        code="W06"
        description="Quyền thật do máy chủ kiểm tra cho từng yêu cầu. Bảng dưới là bản xem để đối chiếu."
        actions={canEdit ? <Button icon="plus" onClick={() => setEditing('new')}>Tạo vai trò</Button> : undefined}
      />
      <div className="stack">
        <Banner tone="info" title="Hiệu trưởng không mặc định có các quyền nhạy cảm">
          {PRINCIPAL_EXCLUDED.map(permissionLabel).join(', ')}. Cấp riêng theo từng người bằng quyền bổ sung tại «Tài khoản và lời mời».
        </Banner>
        {!canEdit ? <Banner tone="warning">Bạn chỉ có quyền xem. Tạo hoặc sửa vai trò cần quyền «Quản lý vai trò» ở phạm vi toàn tổ chức.</Banner> : null}
        {roles.status === 'error' ? (
          <Banner tone="error" title="Không tải được vai trò tùy biến" action={<Button size="sm" variant="secondary" onClick={roles.retry}>Thử lại</Button>}>{roles.error?.message}</Banner>
        ) : null}
        {roles.status === 'loading' ? <div className="card"><SkeletonText lines={2} /></div> : null}

        <div className="card card-flush">
          <div className="dt-scroll">
            <table className="dt matrix">
              <caption className="sr-only">Ma trận quyền theo vai trò</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ minWidth: 240 }}>Quyền</th>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" style={{ minWidth: 112 }}>
                      <div>{c.label}</div>
                      {c.custom ? (
                        <div className="text-caption">
                          Tùy biến{memberCount(c.id) !== null ? ` · ${memberCount(c.id)} người` : ''}
                          {canEdit ? <Button size="sm" variant="tertiary" onClick={() => setEditing(c.custom!)}>Sửa</Button> : null}
                        </div>
                      ) : (
                        <div className="text-caption">Hệ thống{memberCount(c.id) !== null ? ` · ${memberCount(c.id)} người` : ''}</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((g) => (
                  <GroupRows key={g.title} group={g} columns={columns} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {editing ? (
        <RoleEditor
          key={editing === 'new' ? 'new' : editing.id}
          role={editing === 'new' ? null : editing}
          existingNames={[...Object.values(SYSTEM_ROLE_LABELS), ...roles.data.filter((r) => editing === 'new' || r.id !== editing.id).map((r) => r.name)]}
          memberCount={editing === 'new' ? 0 : memberCount(editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function GroupRows({ group, columns }: { group: (typeof PERMISSION_GROUPS)[number]; columns: { id: string; perms: string[] }[] }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={columns.length + 1}>{group.title}</td>
      </tr>
      {group.perms.map((p) => (
        <tr key={p.id}>
          <th scope="row" style={{ background: 'var(--color-surface)', color: 'var(--color-textPrimary)', fontSize: 'var(--fs-small)', fontWeight: 400, textAlign: 'left' }}>
            {p.label}
            <div className="text-caption">{p.id}</div>
          </th>
          {columns.map((c) => {
            const yes = c.perms.includes(p.id);
            return (
              <td key={c.id}>
                {yes ? <span className="yes"><Icon name="check-circle" size={20} /><span className="sr-only">Có</span></span> : <span className="no"><Icon name="minus" size={20} /><span className="sr-only">Không</span></span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
