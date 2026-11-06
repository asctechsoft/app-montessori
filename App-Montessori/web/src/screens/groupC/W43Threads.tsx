'use client';
import { useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { firebase } from '@/lib/firebase';
import { callApi } from '@/lib/api';
import { useAsyncAction } from '@/lib/hooks/useAsyncAction';
import { useFirestoreQuery } from '@/lib/hooks/useFirestore';
import { useScope } from '@/providers/ScopeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { hasPerm } from '@/lib/permissions';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import type { Tone } from '@/lib/status';
import type { ScreenProps } from '../registry';
import { ActionDialog, KV, num, str, tsMs, useChildOptions, useScopedQuery } from './parts/common';

interface Thread { id: string; subject: string; priority: string; status: string; campusId: string; childId: string; classId: string; assignedTo: string; assignedToName: string; dueAt: number; lastMessageAt: number; messageCount: number; resolution: string; createdByName: string; createdByKind: string }
interface Msg { id: string; senderName: string; senderKind: string; text: string; at: number }
const PRIORITY: Record<string, { label: string; tone: Tone }> = { low: { label: 'Thấp', tone: 'neutral' }, normal: { label: 'Thường', tone: 'info' }, high: { label: 'Cao', tone: 'warning' }, urgent: { label: 'Khẩn', tone: 'error' } };
const PRIORITY_OPTIONS = Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }));
const KIND: Record<string, string> = { parent: 'Phụ huynh', staff: 'Nhân sự', owner: 'Chủ chuỗi' };

function ThreadDrawer({ t, onClose }: { t: Thread; onClose: () => void }) {
  const { org, can, tz, perms, canAnywhere } = useScope();
  const { user } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState(t.assignedTo);
  const [prio, setPrio] = useState(t.priority);
  const [due, setDue] = useState('');
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState('');
  const handle = can('inbox.handle', t.campusId);
  const msgs = useFirestoreQuery<Msg>(`msgs|${org?.orgId}|${t.id}`, () => query(collection(firebase().db, 'orgs', org!.orgId, 'threads', t.id, 'messages'), orderBy('at', 'asc')), (id, d) => ({ id, senderName: str(d.senderName), senderKind: str(d.senderKind), text: str(d.text), at: tsMs(d.at) }));
  const members = useFirestoreQuery<{ id: string; name: string }>(
    org && canAnywhere('members.read') ? `mem|${org.orgId}|${t.campusId}` : null,
    () => collection(firebase().db, 'orgs', org!.orgId, 'members'),
    (id, d) => ({ id, name: d.kind !== 'parent' && d.status === 'active' && hasPerm(d.permsByCampus as Record<string, string[]>, 'inbox.handle', t.campusId) ? str(d.displayName, id) : '' }),
  );
  void perms;
  const staff = [{ value: user?.uid ?? '', label: 'Tôi' }, ...members.data.filter((m) => m.name && m.id !== user?.uid).map((m) => ({ value: m.id, label: m.name }))].filter((o) => o.value);

  const post = useAsyncAction(async (opId: string) => callApi('thread.post', { orgId: org!.orgId, campusId: t.campusId, opId, payload: { threadId: t.id, text: text.trim() } }));
  const assign = useAsyncAction(async (opId: string) => callApi('thread.assign', { orgId: org!.orgId, campusId: t.campusId, opId, payload: { threadId: t.id, uid: assignee, priority: prio, dueAt: due ? new Date(due).toISOString() : undefined } }));
  const sendReply = async () => {
    if (!text.trim()) return;
    if ((await post.run()) !== undefined) {
      setText('');
    }
  };
  const doAssign = async () => {
    if (!assignee) return;
    if ((await assign.run()) !== undefined) toast.success('Đã giao người xử lý.');
  };

  return (
    <Drawer open title={t.subject} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="stack">
        <KV items={[
          ['Trạng thái', t.status === 'closed' ? <Badge key="s" tone="neutral">Đã đóng</Badge> : <Badge key="s" tone="success">Đang xử lý</Badge>],
          ['Ưu tiên', <Badge key="p" tone={PRIORITY[t.priority]?.tone ?? 'neutral'}>{PRIORITY[t.priority]?.label ?? t.priority}</Badge>],
          ['Người xử lý', t.assignedToName || 'Chưa giao'],
          ['Hạn xử lý', t.dueAt ? formatDateTime(t.dueAt, tz) : '—'],
          ['Gắn với', t.childId ? 'Một trẻ' : t.classId ? 'Một lớp' : '—'],
          ['Người mở', `${t.createdByName} (${KIND[t.createdByKind] ?? t.createdByKind})`],
        ]} />
        {t.resolution ? <Banner tone="success" title="Kết quả xử lý">{t.resolution}</Banner> : null}
        <div className="stack-sm" aria-live="polite">
          {msgs.status === 'loading' ? <p className="text-secondary">Đang tải tin nhắn...</p> : msgs.status === 'error' ? <Banner tone="error">{msgs.error?.message}</Banner> : msgs.data.length === 0 ? <p className="text-secondary">Chưa có tin nhắn.</p> : msgs.data.map((m) => (
            <div key={m.id} className="card" style={{ background: m.senderKind === 'parent' ? 'var(--color-surfaceMuted)' : undefined }}>
              <div className="text-caption">{m.senderName} · {KIND[m.senderKind] ?? m.senderKind} · {formatDateTime(m.at, tz)}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            </div>
          ))}
        </div>
        {t.status !== 'closed' && handle ? (
          <>
            {post.error ? <Banner tone="error">{post.error.message}</Banner> : null}
            <FormField name="reply" label="Trả lời"><Textarea name="reply" value={text} onValueChange={setText} /></FormField>
            <div><Button loading={post.busy} onClick={() => void sendReply()} disabled={!text.trim()}>Gửi trả lời</Button></div>
            <hr />
            <div className="field-label">Giao người xử lý</div>
            {assign.error ? <Banner tone="error">{assign.error.message}</Banner> : null}
            <div className="grid-3">
              <FormField name="assignee" label="Người xử lý"><Select name="assignee" value={assignee} onValueChange={setAssignee} placeholder="Chọn người" options={staff} /></FormField>
              <FormField name="prio" label="Ưu tiên"><Select name="prio" value={prio} onValueChange={setPrio} options={PRIORITY_OPTIONS} /></FormField>
              <FormField name="due" label="Hạn xử lý"><Input name="due" type="datetime-local" value={due} onValueChange={setDue} /></FormField>
            </div>
            <div className="row"><Button variant="secondary" loading={assign.busy} onClick={() => void doAssign()} disabled={!assignee}>Giao xử lý</Button><Button variant="destructiveOutline" onClick={() => { setResult(''); setClosing(true); }}>Đóng cuộc trao đổi</Button></div>
          </>
        ) : null}
      </div>
      {closing ? (
        <ActionDialog
          title="Đóng cuộc trao đổi"
          subject={t.subject}
          impact={['Cuộc trao đổi chuyển sang Đã đóng; không gửi thêm tin nhắn được, phải mở cuộc mới.', 'Kết quả xử lý được lưu và hiển thị cho các bên trong cuộc trao đổi.']}
          confirmLabel="Đóng cuộc trao đổi"
          success="Đã đóng cuộc trao đổi."
          validate={() => (result.trim() ? null : 'Ghi kết quả xử lý.')}
          run={(opId) => callApi('thread.close', { orgId: org!.orgId, campusId: t.campusId, opId, payload: { threadId: t.id, resolution: result.trim() } })}
          onClose={() => setClosing(false)}
        >
          <FormField name="result" label="Kết quả xử lý" required><Textarea name="result" value={result} onValueChange={setResult} /></FormField>
        </ActionDialog>
      ) : null}
    </Drawer>
  );
}

/** W43 — Trao đổi và phản ánh phụ huynh. Chỉ hiển thị tên, không hiển thị số điện thoại/email của gia đình. */
export function W43Threads(_props: ScreenProps) {
  void _props;
  const { org, campusId, can, tz } = useScope();
  const { user } = useAuth();
  const q = useScopedQuery<Thread>('threads', 'inbox.handle', (id, d) => ({
    id, subject: str(d.subject, id), priority: str(d.priority, 'normal'), status: str(d.status, 'open'), campusId: str(d.campusId), childId: str(d.childId), classId: str(d.classId),
    assignedTo: str(d.assignedTo), assignedToName: str(d.assignedToName), dueAt: tsMs(d.dueAt), lastMessageAt: tsMs(d.lastMessageAt), messageCount: num(d.messageCount), resolution: str(d.resolution), createdByName: str(d.createdByName), createdByKind: str(d.createdByKind),
  }));
  const { options: childOptions, names } = useChildOptions();
  const classes = useScopedQuery('classes', 'classes.read', (id, d) => ({ id, name: str(d.name, id) }));
  const [sel, setSel] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ target: 'child', childId: '', classId: '', subject: '', priority: 'normal', text: '' });
  const rows = useMemo(() => [...q.data].sort((a, b) => b.lastMessageAt - a.lastMessageAt), [q.data]);
  const cur = rows.find((r) => r.id === sel) ?? null;
  const cid = campusId && campusId !== 'all' ? campusId : '';
  const canOpen = !!cid && can('inbox.handle', cid);
  const now = Date.now();
  const columns: Column<Thread>[] = [
    { key: 'subject', header: 'Chủ đề', value: (r) => r.subject, sortable: true, render: (r) => <strong>{r.subject}</strong> },
    { key: 'about', header: 'Gắn với', value: (r) => (r.childId ? names.get(r.childId) ?? 'Một trẻ' : r.classId ? classes.data.find((c) => c.id === r.classId)?.name ?? 'Một lớp' : ''), render: (r) => (r.childId ? names.get(r.childId) ?? 'Một trẻ' : r.classId ? classes.data.find((c) => c.id === r.classId)?.name ?? 'Một lớp' : '—') },
    { key: 'prio', header: 'Ưu tiên', value: (r) => ['low', 'normal', 'high', 'urgent'].indexOf(r.priority), sortable: true, render: (r) => <Badge tone={PRIORITY[r.priority]?.tone ?? 'neutral'}>{PRIORITY[r.priority]?.label ?? r.priority}</Badge> },
    { key: 'who', header: 'Người xử lý', value: (r) => r.assignedToName, render: (r) => r.assignedToName || <Badge tone="warning">Chưa giao</Badge> },
    { key: 'due', header: 'Hạn', value: (r) => r.dueAt, sortable: true, render: (r) => (r.dueAt ? <Badge tone={r.status !== 'closed' && r.dueAt < now ? 'error' : 'neutral'}>{formatDateTime(r.dueAt, tz)}</Badge> : '—') },
    { key: 'status', header: 'Trạng thái', value: (r) => r.status, render: (r) => (r.status === 'closed' ? <Badge tone="neutral">Đã đóng</Badge> : <Badge tone="success">Đang xử lý</Badge>) },
    { key: 'last', header: 'Tin gần nhất', value: (r) => r.lastMessageAt, sortable: true, render: (r) => formatDateTime(r.lastMessageAt, tz) },
  ];
  return (
    <div>
      <PageHeader title="Trao đổi và phản ánh phụ huynh" code="W43" description="Mỗi cuộc trao đổi gắn với một trẻ hoặc một lớp, có người xử lý, ưu tiên, hạn và kết quả."
        actions={canOpen ? <Button icon="plus" onClick={() => { setF({ target: 'child', childId: '', classId: '', subject: '', priority: 'normal', text: '' }); setCreate(true); }}>Mở cuộc trao đổi</Button> : undefined} />
      <DataTable caption="Cuộc trao đổi" columns={columns} rows={rows} rowKey={(r) => r.id} status={q.status} error={q.error?.message} onRetry={q.retry} onRowClick={(r) => setSel(r.id)}
        searchText={(r) => `${r.subject} ${r.assignedToName}`} searchPlaceholder="Tìm theo chủ đề hoặc người xử lý"
        filters={[
          { key: 'st', label: 'Trạng thái', options: [{ value: 'open', label: 'Đang xử lý' }, { value: 'closed', label: 'Đã đóng' }], predicate: (r, v) => r.status === v },
          { key: 'pr', label: 'Ưu tiên', options: PRIORITY_OPTIONS, predicate: (r, v) => r.priority === v },
          { key: 'as', label: 'Giao việc', options: [{ value: 'me', label: 'Giao cho tôi' }, { value: 'none', label: 'Chưa giao' }], predicate: (r, v) => (v === 'me' ? r.assignedTo === user?.uid : !r.assignedTo) },
        ]}
        emptyTitle="Chưa có cuộc trao đổi nào" emptyDescription="Phản ánh và câu hỏi của phụ huynh gửi từ ứng dụng sẽ hiện ở đây." />
      {cur ? <ThreadDrawer key={cur.id} t={cur} onClose={() => setSel(null)} /> : null}
      {create && org ? (
        <ActionDialog
          title="Mở cuộc trao đổi"
          impact={['Tạo cuộc trao đổi gắn với trẻ hoặc lớp đã chọn; phụ huynh của trẻ (nếu bật nhận thông báo) được thêm vào cuộc trao đổi.', 'Chỉ người trong cuộc trao đổi và người có quyền xử lý mới xem được; không hiển thị liên hệ của gia đình khác.']}
          confirmLabel="Mở cuộc trao đổi"
          success="Đã mở cuộc trao đổi."
          validate={() => (f.subject.trim().length < 3 ? 'Nhập chủ đề (tối thiểu 3 ký tự).' : f.target === 'child' && !f.childId ? 'Chọn trẻ.' : f.target === 'class' && !f.classId ? 'Chọn lớp.' : null)}
          run={(opId) => callApi('thread.open', { orgId: org.orgId, campusId: cid, opId, payload: { childId: f.target === 'child' ? f.childId : undefined, classId: f.target === 'class' ? f.classId : undefined, subject: f.subject.trim(), priority: f.priority, text: f.text.trim() || undefined } })}
          onClose={() => setCreate(false)}
        >
          <FormField name="target" label="Gắn với"><Select name="target" value={f.target} onValueChange={(v) => setF({ ...f, target: v })} options={[{ value: 'child', label: 'Một trẻ' }, { value: 'class', label: 'Một lớp' }]} /></FormField>
          {f.target === 'child'
            ? <FormField name="childId" label="Trẻ" required><Select name="childId" value={f.childId} onValueChange={(v) => setF({ ...f, childId: v })} placeholder="Chọn trẻ" options={childOptions} /></FormField>
            : <FormField name="classId" label="Lớp" required><Select name="classId" value={f.classId} onValueChange={(v) => setF({ ...f, classId: v })} placeholder="Chọn lớp" options={classes.data.map((c) => ({ value: c.id, label: c.name }))} /></FormField>}
          <FormField name="subject" label="Chủ đề" required><Input name="subject" value={f.subject} onValueChange={(v) => setF({ ...f, subject: v })} /></FormField>
          <FormField name="priority" label="Ưu tiên"><Select name="priority" value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })} options={PRIORITY_OPTIONS} /></FormField>
          <FormField name="text" label="Tin nhắn đầu tiên"><Textarea name="text" value={f.text} onValueChange={(v) => setF({ ...f, text: v })} /></FormField>
        </ActionDialog>
      ) : null}
    </div>
  );
}
