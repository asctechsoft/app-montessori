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
import { useAuth } from '@/providers/AuthProvider';
import { SYSTEM_ROLES, SYSTEM_ROLE_LABELS, type Grant } from '@/lib/permissions';
import { MEMBER_KIND_LABELS, STATUS_MAPS } from '@/lib/status';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FormField, Input, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import {
  GrantsEditor, draftToGrant, grantToDraft, newDraft, validateDrafts, type GrantDraft,
} from './parts/GrantsEditor';

interface MemberRow {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  kind: string;
  status: string;
  grants: Grant[];
  version?: number;
}

interface InviteRow {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  kind: string;
  status: string;
  grants: Grant[];
  expiresAt: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useRoleOptions() {
  const { org, canAnywhere } = useScope();
  const custom = useFirestoreQuery<{ id: string; name: string }>(
    org && canAnywhere('members.read') ? `roles|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'roles'),
    (id, d) => ({ id, name: String(d.name ?? id) }),
  );
  const labelOf = (id: string) => SYSTEM_ROLE_LABELS[id] ?? custom.data.find((r) => r.id === id)?.name ?? id;
  const options = [
    ...Object.keys(SYSTEM_ROLES).filter((r) => r !== 'owner' && r !== 'parent').map((id) => ({ value: id, label: SYSTEM_ROLE_LABELS[id] ?? id })),
    ...custom.data.map((r) => ({ value: r.id, label: `${r.name} (tùy biến)` })),
  ];
  return { options, labelOf };
}

function grantSummary(grants: Grant[], labelOf: (id: string) => string, campusName: (id: string) => string): string {
  if (!grants?.length) return '—';
  return grants.map((g) => `${labelOf(g.roleId)}: ${g.campusIds.includes('*') ? 'toàn tổ chức' : g.campusIds.map(campusName).join(', ')}`).join(' · ');
}

/* ------------------------------------------------------------------ mời thành viên */

function InviteDrawer({ onClose, roleOptions }: { onClose: () => void; roleOptions: { value: string; label: string }[] }) {
  const { org, campuses, canOrg, can } = useScope();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const [drafts, setDrafts] = useState<GrantDraft[]>([newDraft()]);
  const [done, setDone] = useState<{ code: string; merged?: boolean } | null>(null);

  const form = useForm({
    initial: { displayName: '', email: '', phone: '' },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (!v.displayName.trim()) e.displayName = 'Nhập họ tên.';
      if (!v.email.trim() && !v.phone.trim()) {
        e.email = 'Nhập email hoặc số điện thoại.';
      } else if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = 'Email chưa đúng định dạng.';
      if (v.phone.trim() && !/^[0-9+\s().-]{8,20}$/.test(v.phone.trim())) e.phone = 'Số điện thoại chưa đúng định dạng.';
      return { ...e, ...validateDrafts(drafts) };
    },
  });
  const dirty = form.dirty || drafts.length !== 1 || drafts[0].roleId !== '' || drafts[0].campusIds.length > 0;

  const submit = form.onSubmit(async (v, opId) => {
    const res = await callApi<{ code: string; merged?: boolean }>('member.invite', {
      orgId: org!.orgId,
      opId,
      payload: { kind: 'staff', displayName: v.displayName.trim(), email: v.email.trim(), phone: v.phone.trim(), grants: drafts.map(draftToGrant) },
    });
    setDone(res);
    toast.success('Đã tạo lời mời.');
  });

  const close = async () => {
    if (!done && dirty && !(await confirmDiscard('đóng biểu mẫu mời'))) return;
    onClose();
  };

  const campusOptions = campuses.filter((c) => canOrg('members.manage') || can('members.manage', c.id)).map((c) => ({ id: c.id, name: c.name }));

  return (
    <Drawer
      open
      title="Mời thành viên"
      onClose={() => void close()}
      footer={
        done ? (
          <Button onClick={onClose}>Xong</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void close()}>Đóng</Button>
            <Button type="submit" form="invite-form" loading={form.submitting}>Gửi lời mời</Button>
          </>
        )
      }
    >
      {done ? (
        <div className="stack">
          <Banner tone="success" title="Đã tạo lời mời">
            {done.merged ? 'Đã cập nhật lời mời đang chờ của người này. ' : ''}Mã mời: <strong>{done.code}</strong>. Người được mời đăng nhập bằng đúng email hoặc số điện thoại đã nhập để nhận quyền.
          </Banner>
        </div>
      ) : (
        <form id="invite-form" className="stack" noValidate onSubmit={submit}>
          {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
          <FormField name="displayName" label="Họ tên" required {...form.field('displayName')}>
            <Input {...form.bind('displayName')} autoComplete="off" />
          </FormField>
          <FormField name="email" label="Email" helper="Cần email hoặc số điện thoại." {...form.field('email')}>
            <Input {...form.bind('email')} type="email" autoComplete="off" />
          </FormField>
          <FormField name="phone" label="Số điện thoại" {...form.field('phone')}>
            <Input {...form.bind('phone')} inputMode="tel" autoComplete="off" />
          </FormField>
          <div className="field-label">Vai trò và phạm vi</div>
          <GrantsEditor
            drafts={drafts}
            onChange={setDrafts}
            roleOptions={roleOptions}
            campusOptions={campusOptions}
            allowOrgWide={canOrg('members.manage')}
            canGrantPerm={(p) => canOrg(p)}
            errors={form.errors}
          />
        </form>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ sửa quyền */

function GrantsDrawer({ member, onClose, roleOptions }: { member: MemberRow; onClose: () => void; roleOptions: { value: string; label: string }[] }) {
  const { org, campuses, canOrg, can } = useScope();
  const toast = useToast();
  const { confirmDiscard } = useDirtyGuard();
  const initial = useMemo(() => member.grants.map(grantToDraft), [member]);
  const [drafts, setDrafts] = useState<GrantDraft[]>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const dirty = JSON.stringify(drafts.map(draftToGrant)) !== JSON.stringify(initial.map(draftToGrant));
  const save = useAsyncAction(async (opId: string) =>
    callApi('member.updateGrants', {
      orgId: org!.orgId,
      opId,
      payload: { uid: member.id, grants: drafts.map(draftToGrant), reason: reason.trim() || undefined, expectedVersion: member.version },
    }),
  );
  const close = async () => {
    if (dirty && !(await confirmDiscard('đóng biểu mẫu sửa quyền'))) return;
    onClose();
  };
  const campusOptions = campuses.filter((c) => canOrg('members.manage') || can('members.manage', c.id)).map((c) => ({ id: c.id, name: c.name }));
  const removedAll = drafts.length === 0;

  return (
    <>
      <Drawer
        open={!confirming}
        title={`Sửa quyền của ${member.displayName}`}
        onClose={() => void close()}
        footer={
          <>
            <Button variant="secondary" onClick={() => void close()}>Đóng</Button>
            <Button
              disabled={!dirty}
              onClick={() => {
                const ge = validateDrafts(drafts);
                setErrors(ge);
                if (Object.keys(ge).length === 0) setConfirming(true);
              }}
            >
              Xem tác động và lưu
            </Button>
          </>
        }
      >
        <div className="stack">
          <Banner tone="info">Thay đổi vai trò có hiệu lực ngay ở lần yêu cầu tiếp theo của người này. Không cấp mặc định quyền duyệt tài chính cho hiệu trưởng.</Banner>
          <GrantsEditor drafts={drafts} onChange={setDrafts} roleOptions={roleOptions} campusOptions={campusOptions} allowOrgWide={canOrg('members.manage')} canGrantPerm={(p) => canOrg(p)} errors={errors} />
          <FormField name="grant-reason" label="Lý do thay đổi">
            <Textarea name="grant-reason" value={reason} onValueChange={setReason} />
          </FormField>
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirming}
        title={`Lưu quyền mới cho ${member.displayName}?`}
        subject={`${member.displayName} · ${member.email || member.phone}`}
        impact={[
          `Người này sẽ có ${drafts.length} vai trò/phạm vi thay cho ${member.grants.length} hiện tại.`,
          'Quyền ở các cơ sở bị gỡ sẽ mất ngay; dữ liệu đã nhập trước đó không bị xóa.',
          'Thay đổi được ghi vào nhật ký thao tác.',
          ...(removedAll ? ['Không còn vai trò nào: người này sẽ không truy cập được chức năng nào.'] : []),
        ]}
        confirmLabel="Lưu quyền"
        cancelLabel="Quay lại chỉnh sửa"
        busy={save.busy}
        error={save.error?.message}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const ok = await save.run();
          if (ok) {
            toast.success(`Đã cập nhật quyền của ${member.displayName}.`);
            onClose();
          }
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ đổi trạng thái tài khoản */

type StatusTarget = 'suspended' | 'revoked' | 'active';

function StatusDialog({ member, target, onClose }: { member: MemberRow; target: StatusTarget; onClose: () => void }) {
  const { org } = useScope();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const save = useAsyncAction(async (opId: string) =>
    callApi('member.setStatus', { orgId: org!.orgId, opId, payload: { uid: member.id, status: target, reason: reason.trim() } }),
  );
  const copy = {
    suspended: {
      title: `Tạm khóa ${member.displayName}?`,
      confirm: `Tạm khóa ${member.displayName}`,
      impact: ['Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập vào tổ chức được cho tới khi mở khóa.', 'Quyền và hồ sơ được giữ nguyên để mở khóa lại.', 'Dữ liệu và nhật ký thao tác trước đó được giữ lại.'],
    },
    revoked: {
      title: `Thu hồi quyền của ${member.displayName}?`,
      confirm: `Thu hồi quyền của ${member.displayName}`,
      impact: ['Người này mất toàn bộ quyền truy cập tổ chức và bị đăng xuất khỏi mọi thiết bị.', 'Phiên làm việc đang mở sẽ không dùng tiếp được.', 'Dữ liệu và nhật ký thao tác do người này tạo được giữ lại, không bị xóa.'],
    },
    active: {
      title: `Mở khóa ${member.displayName}?`,
      confirm: `Mở khóa ${member.displayName}`,
      impact: ['Người này đăng nhập lại được và nhận lại các vai trò đã gán.', 'Thay đổi được ghi vào nhật ký thao tác.'],
    },
  }[target];
  return (
    <ConfirmDialog
      open
      title={copy.title}
      subject={`${member.displayName} · ${member.email || member.phone} · ${STATUS_MAPS.member[member.status as keyof typeof STATUS_MAPS.member]?.label ?? member.status}`}
      impact={copy.impact}
      confirmLabel={copy.confirm}
      tone={target === 'active' ? 'primary' : 'destructive'}
      busy={save.busy}
      error={save.error?.message}
      onCancel={onClose}
      onConfirm={async () => {
        if (target !== 'active' && !reason.trim()) return setReasonError('Nhập lý do để lưu vào nhật ký.');
        setReasonError('');
        const ok = await save.run();
        if (ok) {
          toast.success(target === 'active' ? 'Đã mở khóa tài khoản.' : target === 'suspended' ? 'Đã tạm khóa tài khoản.' : 'Đã thu hồi quyền.');
          onClose();
        }
      }}
    >
      {target !== 'active' ? (
        <FormField name="status-reason" label="Lý do" required error={reasonError || undefined}>
          <Textarea name="status-reason" value={reason} onValueChange={setReason} />
        </FormField>
      ) : null}
    </ConfirmDialog>
  );
}

function RevokeInviteDialog({ invite, onClose }: { invite: InviteRow; onClose: () => void }) {
  const { org } = useScope();
  const toast = useToast();
  const save = useAsyncAction(async (opId: string) => callApi('invite.revoke', { orgId: org!.orgId, opId, payload: { id: invite.id } }));
  return (
    <ConfirmDialog
      open
      title="Thu hồi lời mời?"
      subject={`${invite.displayName} · ${invite.email || invite.phone}`}
      impact={['Lời mời không còn dùng được; người này không nhận được quyền khi đăng nhập.', 'Nếu cần có thể gửi lời mời mới.']}
      confirmLabel={`Thu hồi lời mời của ${invite.displayName}`}
      tone="destructive"
      busy={save.busy}
      error={save.error?.message}
      onCancel={onClose}
      onConfirm={async () => {
        if (await save.run()) {
          toast.success('Đã thu hồi lời mời.');
          onClose();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ trang */

/** W07 — Quản lý tài khoản và lời mời: member.invite, member.updateGrants, member.setStatus, invite.revoke. */
export function W07Members() {
  const { org, campuses, canOrg, canAnywhere } = useScope();
  const { user } = useAuth();
  const { options: roleOptions, labelOf } = useRoleOptions();
  const [tab, setTab] = useState('members');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [statusFor, setStatusFor] = useState<{ m: MemberRow; target: StatusTarget } | null>(null);
  const [revoking, setRevoking] = useState<InviteRow | null>(null);

  const canManage = canAnywhere('members.manage');
  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? id;

  const members = useFirestoreQuery<MemberRow>(
    org ? `members|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'members'),
    (id, d) => ({
      id, displayName: String(d.displayName ?? id), email: String(d.email ?? ''), phone: String(d.phone ?? ''), kind: String(d.kind ?? 'staff'),
      status: String(d.status ?? 'active'), grants: Array.isArray(d.grants) ? (d.grants as Grant[]) : [], version: d.version as number | undefined,
    }),
  );
  const invites = useFirestoreQuery<InviteRow>(
    org && tab === 'invites' ? `invites|${org.orgId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'invites'),
    (id, d) => ({
      id, displayName: String(d.displayName ?? ''), email: String(d.email ?? ''), phone: String(d.phone ?? ''), kind: String(d.kind ?? 'staff'),
      status: String(d.status ?? 'pending'), grants: Array.isArray(d.grants) ? (d.grants as Grant[]) : [], expiresAt: d.expiresAt,
    }),
  );

  const memberCols: Column<MemberRow>[] = [
    {
      key: 'name', header: 'Họ tên', value: (r) => r.displayName, sortable: true,
      render: (r) => (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Avatar name={r.displayName} size="sm" />
          <div>
            <strong>{r.displayName}</strong>
            <div className="text-caption">{r.email || r.phone || '—'}</div>
          </div>
        </div>
      ),
    },
    { key: 'kind', header: 'Loại', value: (r) => MEMBER_KIND_LABELS[r.kind] ?? r.kind, sortable: true },
    { key: 'grants', header: 'Vai trò và phạm vi', value: (r) => grantSummary(r.grants, labelOf, campusName), render: (r) => <span className="text-small">{r.kind === 'owner' ? 'Chủ chuỗi · toàn tổ chức' : r.kind === 'parent' ? 'Phụ huynh (theo trẻ liên kết)' : grantSummary(r.grants, labelOf, campusName)}</span> },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="member" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => {
        const self = r.id === user?.uid;
        if (!canManage || r.kind === 'owner' || self) return <span className="text-caption">{self ? 'Tài khoản của bạn' : '—'}</span>;
        return (
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
            {r.kind === 'staff' && r.status !== 'revoked' ? <Button size="sm" variant="tertiary" onClick={() => setEditing(r)}>Sửa quyền</Button> : null}
            {r.status === 'active' || r.status === 'invited' ? <Button size="sm" variant="tertiary" onClick={() => setStatusFor({ m: r, target: 'suspended' })}>Tạm khóa</Button> : null}
            {r.status === 'suspended' || r.status === 'revoked' ? <Button size="sm" variant="tertiary" onClick={() => setStatusFor({ m: r, target: 'active' })}>Mở khóa</Button> : null}
            {r.status !== 'revoked' ? <Button size="sm" variant="destructiveOutline" onClick={() => setStatusFor({ m: r, target: 'revoked' })}>Thu hồi quyền</Button> : null}
          </div>
        );
      },
    },
  ];

  const memberFilters: TableFilter<MemberRow>[] = [
    { key: 'status', label: 'Trạng thái', options: Object.entries(STATUS_MAPS.member).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v },
    { key: 'kind', label: 'Loại', options: Object.entries(MEMBER_KIND_LABELS).map(([value, label]) => ({ value, label })), predicate: (r, v) => r.kind === v },
  ];

  const inviteCols: Column<InviteRow>[] = [
    { key: 'name', header: 'Người được mời', value: (r) => r.displayName, sortable: true, render: (r) => (<div><strong>{r.displayName}</strong><div className="text-caption">{r.email || r.phone || '—'}</div></div>) },
    { key: 'kind', header: 'Loại', value: (r) => MEMBER_KIND_LABELS[r.kind] ?? r.kind },
    { key: 'grants', header: 'Vai trò và phạm vi', value: (r) => grantSummary(r.grants, labelOf, campusName), render: (r) => <span className="text-small">{r.kind === 'parent' ? 'Phụ huynh' : grantSummary(r.grants, labelOf, campusName)}</span> },
    { key: 'exp', header: 'Hết hạn', value: (r) => (r.expiresAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0, sortable: true, render: (r) => formatDate(r.expiresAt as never) },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, sortable: true, render: (r) => <StatusBadge domain="invite" value={r.status} /> },
    {
      key: 'actions', header: 'Thao tác',
      render: (r) => (r.status === 'pending' && canManage ? <Button size="sm" variant="destructiveOutline" onClick={() => setRevoking(r)}>Thu hồi lời mời</Button> : <span className="text-caption">—</span>),
    },
  ];

  const orgWideOnly = !canOrg('members.manage') && canManage;

  return (
    <div>
      <PageHeader
        title="Quản lý tài khoản và lời mời"
        code="W07"
        description="Mỗi người một tài khoản cá nhân; không dùng tài khoản chung cho cơ sở."
        actions={canManage ? <Button icon="plus" onClick={() => setInviting(true)}>Mời thành viên</Button> : undefined}
      />
      <div className="stack">
        {!canManage ? <Banner tone="warning">Bạn chỉ có quyền xem. Mời hoặc đổi quyền cần quyền «Quản lý tài khoản».</Banner> : null}
        {orgWideOnly ? <Banner tone="info">Bạn chỉ quản lý được tài khoản trong các cơ sở được giao.</Banner> : null}
        <Tabs
          label="Tài khoản và lời mời"
          active={tab}
          onChange={setTab}
          items={[{ id: 'members', label: 'Tài khoản' }, { id: 'invites', label: 'Lời mời' }]}
        />
        {tab === 'members' ? (
          <DataTable
            caption="Danh sách tài khoản"
            columns={memberCols}
            rows={members.data}
            rowKey={(r) => r.id}
            status={members.status}
            error={members.error?.message}
            onRetry={members.retry}
            searchText={(r) => `${r.displayName} ${r.email} ${r.phone}`}
            searchPlaceholder="Tìm theo tên, email, số điện thoại"
            filters={memberFilters}
            emptyTitle="Chưa có tài khoản nào"
            emptyDescription="Mời nhân sự đầu tiên để cùng quản trị tổ chức."
            emptyAction={canManage ? <Button icon="plus" onClick={() => setInviting(true)}>Mời thành viên</Button> : undefined}
          />
        ) : (
          <DataTable
            caption="Danh sách lời mời"
            columns={inviteCols}
            rows={invites.data}
            rowKey={(r) => r.id}
            status={invites.status}
            error={invites.error?.message}
            onRetry={invites.retry}
            searchText={(r) => `${r.displayName} ${r.email} ${r.phone}`}
            searchPlaceholder="Tìm lời mời"
            filters={[{ key: 'status', label: 'Trạng thái', options: Object.entries(STATUS_MAPS.invite).map(([value, s]) => ({ value, label: s.label })), predicate: (r, v) => r.status === v }]}
            emptyTitle="Chưa có lời mời nào"
            emptyDescription="Lời mời đã gửi sẽ hiển thị tại đây cùng trạng thái chờ, đã chấp nhận hoặc hết hạn."
          />
        )}
      </div>
      {inviting ? <InviteDrawer roleOptions={roleOptions} onClose={() => setInviting(false)} /> : null}
      {editing ? <GrantsDrawer key={editing.id} member={editing} roleOptions={roleOptions} onClose={() => setEditing(null)} /> : null}
      {statusFor ? <StatusDialog key={`${statusFor.m.id}-${statusFor.target}`} member={statusFor.m} target={statusFor.target} onClose={() => setStatusFor(null)} /> : null}
      {revoking ? <RevokeInviteDialog key={revoking.id} invite={revoking} onClose={() => setRevoking(null)} /> : null}
    </div>
  );
}
