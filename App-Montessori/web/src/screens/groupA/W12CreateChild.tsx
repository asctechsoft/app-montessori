'use client';
import { useState } from 'react';
import { ApiError, callApi, toApiError } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { dayKey, formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { Checkbox, DateInput, FormField, Input, Select, Textarea } from '@/components/ui/Fields';
import { useToast } from '@/components/ui/Toast';
import { ClassSelect, EnrollProblems, hasDuplicates } from './parts/enroll';
import { GuardianEditor, guardianBody, newGuardian, validateGuardians, type GuardianDraft } from './parts/GuardianEditor';
import { addDaysKey, GENDER_OPTIONS, objs, str, useCampusCtx, useChildrenQ, useClassesQ, useOccupancy } from './parts/kit';

interface Outcome {
  childId: string;
  code: string;
  placed: boolean;
  pendingApproval: boolean;
  guardians: { name: string; status: string; inviteCode: string; warning: string; error: string }[];
}

const splitList = (s: string): string[] => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** W12 — Thêm trẻ và liên kết phụ huynh. Có xếp lớp: lead.enroll (một giao dịch); không xếp lớp: child.save rồi child.linkGuardian. */
export function W12CreateChild() {
  const { orgId, cid, tz, can } = useCampusCtx();
  const toast = useToast();
  const today = dayKey(new Date(), tz);
  const children = useChildrenQ();
  const classes = useClassesQ();
  const occupancy = useOccupancy(children.data, children.status === 'ready' || children.status === 'empty');
  const canHealth = can('children.health.read');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Nhớ trẻ đã tạo và các giám hộ đã liên kết để thử lại không tạo trùng khi một bước sau bị lỗi.
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [linked, setLinked] = useState<Record<string, Outcome['guardians'][number]>>({});

  const form = useForm({
    initial: {
      code: '', fullName: '', nickname: '', dob: '', gender: '', address: '', photoConsent: false, notes: '', missingDocuments: '',
      placeNow: false, classId: '', startDate: today, requestException: false, exceptionReason: '',
      allergies: '', conditions: '', dietNote: '', emergencyName: '', emergencyPhone: '',
      guardians: [newGuardian('mother')] as GuardianDraft[],
      confirmDuplicate: false,
    },
    validate: (v) => {
      const e: Record<string, string> = {};
      const code = v.code.trim();
      if (code && !/^[A-Za-z0-9_-]{2,20}$/.test(code)) e.code = 'Mã 2–20 ký tự gồm chữ, số, gạch nối hoặc gạch dưới.';
      else if (code && children.byId && [...children.byId.values()].some((c) => c.code.toUpperCase() === code.toUpperCase())) e.code = `Mã trẻ ${code.toUpperCase()} đã tồn tại.`;
      if (v.fullName.trim().length < 2) e.fullName = 'Nhập họ tên trẻ (tối thiểu 2 ký tự).';
      if (!v.dob) e.dob = 'Nhập ngày sinh của trẻ.';
      else if (v.dob > today) e.dob = 'Ngày sinh không được ở tương lai.';
      else if (v.dob < addDaysKey(today, -365 * 15)) e.dob = 'Ngày sinh không hợp lý đối với trẻ mầm non.';
      if (v.placeNow) {
        const cls = classes.byId.get(v.classId);
        if (!v.classId) e.classId = 'Chọn lớp.';
        else if (cls && occupancy(cls) >= cls.capacity && !v.requestException) e.classId = 'Lớp đã đủ sĩ số. Chọn lớp khác hoặc xin duyệt ngoại lệ.';
        if (!v.startDate) e.startDate = 'Chọn ngày nhập học.';
        else if (v.startDate < addDaysKey(today, -31)) e.startDate = 'Ngày nhập học quá xa trong quá khứ (tối đa 31 ngày).';
        if (v.requestException && !v.exceptionReason.trim()) e.exceptionReason = 'Nhập lý do xin vượt sĩ số.';
      }
      if (v.emergencyPhone.trim() && !/^[0-9+\s().-]{8,20}$/.test(v.emergencyPhone.trim())) e.emergencyPhone = 'Số điện thoại chưa đúng định dạng.';
      return { ...e, ...validateGuardians(v.guardians) };
    },
  });
  const v = form.values;
  const cls = classes.byId.get(v.classId);
  const full = !!cls && occupancy(cls) >= cls.capacity;

  const submit = form.onSubmit(async (val, opId) => {
    const child: Record<string, unknown> = {
      fullName: val.fullName.trim(), dob: val.dob, photoConsent: val.photoConsent,
      ...(val.code.trim() ? { code: val.code.trim().toUpperCase() } : {}),
      ...(val.nickname.trim() ? { nickname: val.nickname.trim() } : {}),
      ...(val.gender ? { gender: val.gender } : {}),
      ...(val.address.trim() ? { address: val.address.trim() } : {}),
      ...(val.notes.trim() ? { notes: val.notes.trim() } : {}),
      ...(splitList(val.missingDocuments).length ? { missingDocuments: splitList(val.missingDocuments) } : {}),
    };
    const health: Record<string, unknown> = {};
    if (canHealth) {
      if (splitList(val.allergies).length) health.allergies = splitList(val.allergies);
      if (splitList(val.conditions).length) health.conditions = splitList(val.conditions);
      if (val.dietNote.trim()) health.dietNote = val.dietNote.trim();
      if (val.emergencyName.trim() || val.emergencyPhone.trim()) health.emergencyContact = { name: val.emergencyName.trim(), phone: val.emergencyPhone.trim() };
    }
    const hasHealth = Object.keys(health).length > 0;
    const guardians = val.guardians.map(guardianBody);

    if (val.placeNow) {
      const payload: Record<string, unknown> = {
        classId: val.classId, startDate: val.startDate, child: hasHealth ? { ...child, health } : child, guardians, confirmDuplicate: val.confirmDuplicate,
      };
      if (val.requestException && full) { payload.requestException = true; payload.exceptionReason = val.exceptionReason.trim(); }
      const res = await callApi<Record<string, unknown>>('lead.enroll', { orgId, campusId: cid ?? undefined, opId, payload });
      form.reset(val);
      const pending = res.status === 'pending_approval';
      setOutcome({
        childId: str(res.childId), code: str(res.code), placed: !pending, pendingApproval: pending,
        guardians: objs(res.guardians).map((g, i) => ({ name: val.guardians[i]?.name ?? '', status: str(g.status), inviteCode: str(g.inviteCode), warning: str(g.warning), error: '' })),
      });
      toast.success(pending ? 'Đã gửi xin duyệt nhận vượt sĩ số.' : `Đã tạo hồ sơ ${val.fullName.trim()}.`);
      return;
    }

    let c = created;
    if (!c) {
      const r = await callApi<{ id: string; code: string }>('child.save', { orgId, campusId: cid ?? undefined, payload: { campusId: cid, ...child, ...(hasHealth ? { health } : {}), confirmDuplicate: val.confirmDuplicate } });
      c = { id: r.id, code: r.code };
      setCreated(c);
    }
    const results = { ...linked };
    let firstErr: ApiError | null = null;
    for (let i = 0; i < guardians.length; i++) {
      const k = val.guardians[i].key;
      if (results[k] && !results[k].error) continue;
      try {
        const { perms, ...g } = guardians[i];
        const r = await callApi<Record<string, unknown>>('child.linkGuardian', { orgId, campusId: cid ?? undefined, payload: { childId: c.id, guardian: g, perms } });
        results[k] = { name: g.name, status: str(r.status), inviteCode: str(r.inviteCode), warning: str(r.warning), error: '' };
      } catch (e) {
        const ae = toApiError(e);
        results[k] = { name: guardians[i].name, status: '', inviteCode: '', warning: '', error: ae.message };
        firstErr ??= ae;
      }
    }
    setLinked(results);
    if (firstErr) throw new ApiError('PRECONDITION', `Đã tạo hồ sơ ${c.code} nhưng chưa liên kết xong mọi người giám hộ: ${firstErr.message} Sửa thông tin rồi bấm lưu lại để thử tiếp; hồ sơ trẻ sẽ không bị tạo trùng.`);
    form.reset(val);
    setOutcome({ childId: c.id, code: c.code, placed: false, pendingApproval: false, guardians: val.guardians.map((g) => results[g.key]) });
    toast.success(`Đã tạo hồ sơ ${val.fullName.trim()}.`);
  });

  if (outcome) {
    return (
      <div className="stack">
        <PageHeader title="Thêm trẻ và liên kết phụ huynh" code="W12" />
        <Card>
          <div className="stack">
            <Banner tone="success" title={outcome.pendingApproval ? 'Đã gửi yêu cầu nhận vượt sĩ số' : `Đã tạo hồ sơ trẻ${outcome.code ? ` ${outcome.code}` : ''}`}>
              {outcome.pendingApproval ? 'Hồ sơ trẻ sẽ được tạo và xếp lớp sau khi yêu cầu được duyệt.' : outcome.placed ? 'Trẻ đã được xếp lớp.' : 'Trẻ ở trạng thái «Chờ xếp lớp». Xếp lớp bằng chức năng nhập học khi sẵn sàng.'}
            </Banner>
            {outcome.guardians.map((g, i) => (
              <p key={i} className="text-small">
                {g?.name || `Người giám hộ ${i + 1}`}: {g?.status === 'linked' ? 'đã liên kết với tài khoản phụ huynh có sẵn.' : <>đã tạo lời mời kích hoạt{g?.inviteCode ? <>, mã mời <strong>{g.inviteCode}</strong></> : null}.</>}{g?.warning ? ` ${g.warning}` : ''}
              </p>
            ))}
            <div className="row">
              {outcome.childId ? <LinkButton href={`/tre/${outcome.childId}`}>Mở hồ sơ trẻ</LinkButton> : <LinkButton href="/phe-duyet">Mở trung tâm phê duyệt</LinkButton>}
              <LinkButton href="/tre" variant="secondary">Về danh sách trẻ</LinkButton>
              <Button variant="tertiary" onClick={() => { setOutcome(null); setCreated(null); setLinked({}); form.reset({ ...form.values, fullName: '', dob: '', code: '', nickname: '', guardians: [newGuardian('mother')], confirmDuplicate: false }); }}>Thêm trẻ khác</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader title="Thêm trẻ và liên kết phụ huynh" code="W12" breadcrumbs={[{ label: 'Trẻ và phụ huynh', href: '/tre' }, { label: 'Thêm trẻ' }]} description="Kiểm tra trùng mã và trùng hồ sơ trước khi lưu. Quyền nhận thông báo, xem học phí, đón trẻ được tách riêng từng người." />
      <form className="stack" noValidate onSubmit={(e) => void submit(e)} style={{ maxWidth: 920 }}>
        {created ? <Banner tone="warning" title={`Hồ sơ ${created.code} đã được tạo`}>Chỉ còn bước liên kết người giám hộ. Bấm lưu để thử lại các liên kết chưa xong.</Banner> : null}
        <Card title="Hồ sơ trẻ">
          <div className="stack">
            <div className="grid-2">
              <FormField name="fullName" label="Họ tên trẻ" required {...form.field('fullName')}><Input {...form.bind('fullName')} autoComplete="off" disabled={!!created} /></FormField>
              <FormField name="nickname" label="Tên thường gọi" {...form.field('nickname')}><Input {...form.bind('nickname')} disabled={!!created} /></FormField>
              <FormField name="dob" label="Ngày sinh" required {...form.field('dob')}><DateInput {...form.bind('dob')} disabled={!!created} /></FormField>
              <FormField name="gender" label="Giới tính" {...form.field('gender')}><Select {...form.bind('gender')} placeholder="Chưa chọn" options={GENDER_OPTIONS} disabled={!!created} /></FormField>
              <FormField name="code" label="Mã trẻ" helper="Để trống để hệ thống tự sinh (MN001...)." {...form.field('code')}><Input {...form.bind('code')} autoComplete="off" disabled={!!created} /></FormField>
              <FormField name="missingDocuments" label="Giấy tờ còn thiếu" helper="Ngăn cách bằng dấu phẩy." {...form.field('missingDocuments')}><Input {...form.bind('missingDocuments')} disabled={!!created} /></FormField>
            </div>
            <FormField name="address" label="Địa chỉ" {...form.field('address')}><Input {...form.bind('address')} autoComplete="off" disabled={!!created} /></FormField>
            <Checkbox checked={v.photoConsent} disabled={!!created} onChange={(on) => form.setValue('photoConsent', on)}>Phụ huynh đồng ý sử dụng hình ảnh của bé</Checkbox>
            <FormField name="notes" label="Ghi chú" {...form.field('notes')}><Textarea {...form.bind('notes')} disabled={!!created} /></FormField>
          </div>
        </Card>

        {canHealth ? (
          <Card title="Sức khỏe (người có quyền xem sức khỏe)">
            <div className="stack">
              <div className="grid-2">
                <FormField name="allergies" label="Dị ứng" helper="Ngăn cách bằng dấu phẩy." {...form.field('allergies')}><Input {...form.bind('allergies')} disabled={!!created} /></FormField>
                <FormField name="conditions" label="Bệnh nền / lưu ý y tế" {...form.field('conditions')}><Input {...form.bind('conditions')} disabled={!!created} /></FormField>
                <FormField name="emergencyName" label="Người liên hệ khẩn cấp" {...form.field('emergencyName')}><Input {...form.bind('emergencyName')} disabled={!!created} /></FormField>
                <FormField name="emergencyPhone" label="Điện thoại khẩn cấp" {...form.field('emergencyPhone')}><Input {...form.bind('emergencyPhone')} inputMode="tel" disabled={!!created} /></FormField>
              </div>
              <FormField name="dietNote" label="Lưu ý ăn uống" {...form.field('dietNote')}><Input {...form.bind('dietNote')} disabled={!!created} /></FormField>
            </div>
          </Card>
        ) : null}

        <Card title="Xếp lớp (tùy chọn)">
          <div className="stack">
            <Checkbox checked={v.placeNow} disabled={!!created} onChange={(on) => form.setValue('placeNow', on)}>Xếp lớp ngay khi tạo hồ sơ (nhập học)</Checkbox>
            {v.placeNow ? (
              <>
                <div className="grid-2">
                  <FormField name="classId" label="Lớp" required {...form.field('classId')}><ClassSelect {...form.bind('classId')} classes={classes.data} occupancy={occupancy} /></FormField>
                  <FormField name="startDate" label="Ngày nhập học" required {...form.field('startDate')}><DateInput {...form.bind('startDate')} /></FormField>
                </div>
                {full ? (
                  <Banner tone="warning" title={`Lớp ${cls?.name} đã đủ sĩ số`}>
                    <div className="stack-sm">
                      <Checkbox checked={v.requestException} onChange={(on) => form.setValue('requestException', on)}>Xin duyệt nhận vượt sĩ số</Checkbox>
                      {v.requestException ? <FormField name="exceptionReason" label="Lý do" required {...form.field('exceptionReason')}><Textarea {...form.bind('exceptionReason')} /></FormField> : null}
                    </div>
                  </Banner>
                ) : null}
              </>
            ) : <p className="text-small text-secondary">Không tick: hồ sơ ở trạng thái «Chờ xếp lớp», xếp lớp sau.</p>}
          </div>
        </Card>

        <Card title="Người giám hộ">
          <GuardianEditor drafts={v.guardians} onChange={(g) => form.setValue('guardians', g)} errors={form.errors} min={1} />
        </Card>

        <EnrollProblems error={form.apiError} onPickClass={(id) => form.setValue('classId', id)} />
        {hasDuplicates(form.apiError) || v.confirmDuplicate ? (
          <Checkbox checked={v.confirmDuplicate} onChange={(on) => form.setValue('confirmDuplicate', on)}>Vẫn tạo hồ sơ mới (đây là trẻ khác)</Checkbox>
        ) : null}
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <div className="row">
          <Button type="submit" size="lg" loading={form.submitting}>{v.placeNow ? (full && v.requestException ? 'Gửi xin duyệt ngoại lệ' : 'Tạo hồ sơ và nhập học') : created ? 'Liên kết người giám hộ' : 'Tạo hồ sơ trẻ'}</Button>
          <LinkButton href="/tre" variant="tertiary" size="lg">Quay lại danh sách</LinkButton>
        </div>
        {v.placeNow && v.startDate ? <p className="text-caption">Ngày nhập học: {formatDate(v.startDate)}</p> : null}
      </form>
    </div>
  );
}
