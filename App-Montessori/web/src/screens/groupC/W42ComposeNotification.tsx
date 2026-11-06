'use client';
import { useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { firebase } from '@/lib/firebase';
import { callApi, newOpId } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { useDoc } from '@/lib/hooks/useFirestore';
import { useScope } from '@/providers/ScopeProvider';
import { PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import type { ScreenProps } from '../registry';
import { str, useScopedQuery } from './parts/common';
import { CATEGORY_LABEL, NotifActions, NotifBadge, scopeText, toNotif } from './parts/notif';

type ScopeType = 'campus' | 'class' | 'org';

function SavedPanel({ id, onNew }: { id: string; onNew: () => void }) {
  const { org } = useScope();
  const d = useDoc(`notif|${org?.orgId}|${id}`, () => doc(firebase().db, 'orgs', org!.orgId, 'notifications', id), toNotif);
  const { campuses } = useScope();
  const classes = useScopedQuery('classes', 'classes.read', (cid, x) => ({ id: cid, name: str(x.name, cid) }));
  const name = (x: string) => campuses.find((c) => c.id === x)?.name ?? classes.data.find((c) => c.id === x)?.name ?? x;
  const n = d.data;
  return (
    <div className="stack">
      <Banner tone="success" title="Đã lưu bản nháp">Chưa gửi tới ai. Gửi duyệt để máy chủ tính danh sách người nhận và kiểm tra quyền, rồi gửi ngay hoặc lên lịch.</Banner>
      {n ? (
        <Card title={n.title}>
          <div className="stack">
            <div className="row"><NotifBadge value={n.status} /><span className="text-small text-secondary">{scopeText(n, name)}</span></div>
            {n.recipientPreview ? <p>Xem trước phạm vi: máy chủ xác định <strong>{n.recipientPreview} người nhận</strong>.</p> : <p className="text-secondary">Chưa có số người nhận dự kiến; sẽ có sau khi gửi duyệt.</p>}
            <NotifActions n={n} />
          </div>
        </Card>
      ) : null}
      <div className="row"><LinkButton href="/ket-noi/thong-bao" variant="secondary">Về danh sách thông báo</LinkButton><Button variant="tertiary" onClick={onNew}>Soạn thông báo khác</Button></div>
    </div>
  );
}

/** W42 — Soạn và lên lịch thông báo. Lưu nháp → gửi duyệt (xem số người nhận do máy chủ tính) → duyệt → gửi/lịch. */
export function W42ComposeNotification(_props: ScreenProps) {
  void _props;
  const { org, campuses, campusId, can, canOrg } = useScope();
  const classes = useScopedQuery('classes', 'classes.read', (id, d) => ({ id, name: str(d.name, id), campusId: str(d.campusId) }));
  const sendable = useMemo(() => campuses.filter((c) => can('notify.send', c.id)), [campuses, can]);
  const orgWide = canOrg('notify.send');
  const [scopeType, setScopeType] = useState<ScopeType>(campusId && campusId !== 'all' ? 'campus' : orgWide ? 'org' : 'campus');
  const [campusIds, setCampusIds] = useState<string[]>(campusId && campusId !== 'all' ? [campusId] : []);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [scopeErr, setScopeErr] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const folder = useMemo(() => newOpId() + String(key).slice(0, 0), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const form = useForm({
    initial: { title: '', body: '', category: 'general', requireAck: false },
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.title.trim().length < 2) e.title = 'Nhập tiêu đề (tối thiểu 2 ký tự).';
      if (v.title.length > 150) e.title = 'Tiêu đề tối đa 150 ký tự.';
      if (!v.body.trim()) e.body = 'Nhập nội dung thông báo.';
      if (v.body.length > 5000) e.body = 'Nội dung tối đa 5000 ký tự.';
      return e;
    },
  });

  const classCampus = (id: string) => classes.data.find((c) => c.id === id)?.campusId ?? '';
  const ownerCampus = scopeType === 'org' ? '' : scopeType === 'campus' ? campusIds[0] ?? '' : classCampus(classIds[0] ?? '');
  const ids = scopeType === 'campus' ? campusIds : scopeType === 'class' ? classIds : [];

  const send = form.onSubmit(async (v, opId) => {
    const paths: string[] = [];
    for (const f of files) {
      const base = ownerCampus ? `orgs/${org!.orgId}/campuses/${ownerCampus}/notifications/${folder}` : `orgs/${org!.orgId}/notifications/${folder}`;
      const path = `${base}/${f.name.replace(/[^\w.\-]+/g, '_')}`;
      await uploadBytes(sref(firebase().storage, path), f);
      paths.push(path);
    }
    const res = await callApi<{ id: string }>('notification.save', {
      orgId: org!.orgId, campusId: ownerCampus || undefined, opId,
      payload: { title: v.title.trim(), body: v.body.trim(), category: v.category, requireAck: v.requireAck, campusId: ownerCampus || undefined, scope: { type: scopeType, ids }, attachmentPaths: paths },
    });
    setSavedId(res.id);
  });

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  const scopeNames = scopeType === 'org' ? 'Toàn tổ chức' : ids.map((i) => campuses.find((c) => c.id === i)?.name ?? classes.data.find((c) => c.id === i)?.name ?? i).join(', ');

  return (
    <div>
      <PageHeader title="Soạn và lên lịch thông báo" code="W42" breadcrumbs={[{ label: 'Thông báo', href: '/ket-noi/thong-bao' }, { label: 'Soạn thông báo' }]} />
      {savedId ? (
        <SavedPanel id={savedId} onNew={() => { setSavedId(null); setFiles([]); setKey((k) => k + 1); form.reset({ title: '', body: '', category: 'general', requireAck: false }); }} />
      ) : (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); if (scopeType !== 'org' && ids.length === 0) { setScopeErr('Chọn ít nhất một đối tượng nhận.'); return; } setScopeErr(''); void send(e); }}>
          {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
          <Card title="Nội dung">
            <div className="stack">
              <FormField name="title" label="Tiêu đề" required {...form.field('title')}><Input {...form.bind('title')} /></FormField>
              <FormField name="category" label="Loại thông báo"><Select {...form.bind('category')} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} /></FormField>
              <FormField name="body" label="Nội dung" required {...form.field('body')}><Textarea {...form.bind('body')} rows={7} /></FormField>
              <FormField name="files" label="Tệp đính kèm" helper="Tệp lưu riêng tư theo cơ sở; chỉ người nhận hợp lệ mới mở được.">
                <input id="field-files" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              </FormField>
              {files.length ? <p className="text-small text-secondary">{files.length} tệp: {files.map((f) => f.name).join(', ')}</p> : null}
            </div>
          </Card>
          <Card title="Người nhận">
            <div className="stack">
              <FormField name="scopeType" label="Gửi tới">
                <Select name="scopeType" value={scopeType} onValueChange={(v) => { setScopeType(v as ScopeType); setScopeErr(''); }}
                  options={[{ value: 'campus', label: 'Theo cơ sở' }, { value: 'class', label: 'Theo lớp' }, ...(orgWide ? [{ value: 'org', label: 'Toàn tổ chức' }] : [])]} />
              </FormField>
              {scopeType === 'campus' ? sendable.map((c) => <Checkbox key={c.id} checked={campusIds.includes(c.id)} onChange={(on) => toggle(campusIds, setCampusIds, c.id, on)}>{c.name}</Checkbox>) : null}
              {scopeType === 'class' ? (classes.status === 'loading' ? <p className="text-secondary">Đang tải lớp...</p> : classes.data.length === 0 ? <p className="text-secondary">Chưa có lớp nào để chọn.</p> : classes.data.map((c) => <Checkbox key={c.id} checked={classIds.includes(c.id)} onChange={(on) => toggle(classIds, setClassIds, c.id, on)}>{c.name}</Checkbox>)) : null}
              {scopeErr ? <Banner tone="error">{scopeErr}</Banner> : null}
              <Banner tone="info" title="Xem trước phạm vi người nhận">
                Phạm vi đã chọn: <strong>{scopeNames || 'chưa chọn'}</strong>. Số người nhận chính xác do máy chủ tính (phụ huynh theo trẻ đang học có bật nhận thông báo, nhân sự theo cơ sở hoặc lớp) và hiện sau khi lưu và gửi duyệt, trước khi phát hành.
              </Banner>
              <Checkbox checked={form.values.requireAck} onChange={(v) => form.setValue('requireAck', v)}>Yêu cầu người nhận xác nhận</Checkbox>
              <p className="text-small text-secondary">Gửi ngay hoặc lên lịch chọn ở bước gửi, sau khi thông báo được duyệt.</p>
            </div>
          </Card>
          <div className="row"><Button type="submit" loading={form.submitting}>Lưu bản nháp</Button></div>
        </form>
      )}
    </div>
  );
}
