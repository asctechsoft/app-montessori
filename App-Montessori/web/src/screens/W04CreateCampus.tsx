'use client';
import { useMemo, useState } from 'react';
import { useScope } from '@/providers/ScopeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { callApi } from '@/lib/api';
import { useForm } from '@/lib/hooks/useForm';
import { PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField, Input, Select, Checkbox } from '@/components/ui/Fields';
import { Banner } from '@/components/ui/Banner';
import { useToast } from '@/components/ui/Toast';

const TIMES = Array.from({ length: 35 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { value: t, label: t };
});

const TZ = [{ value: 'Asia/Ho_Chi_Minh', label: 'Việt Nam (GMT+7)' }];

const COPY_PARTS = [
  { id: 'classes', label: 'Lớp học' },
  { id: 'feePolicies', label: 'Biểu phí (bản nháp)' },
  { id: 'shifts', label: 'Ca làm việc' },
  { id: 'menus', label: 'Thực đơn (bản nháp)' },
  { id: 'categories', label: 'Danh mục (lý do nghỉ, loại sự cố...)' },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Created {
  campus: { id: string; name: string; code: string };
  copied: Record<string, number>;
  principalInvite: { id: string; code: string } | null;
}

const initial = {
  code: '', name: '', address: '', phone: '', timezone: 'Asia/Ho_Chi_Minh', openTime: '07:00', closeTime: '17:00',
  principalName: '', principalEmail: '', copyFrom: '', copyParts: [] as string[],
};

/** W04 — Tạo cơ sở mới: campus.create + mời hiệu trưởng + sao chép cấu hình (chỉ danh mục, không hồ sơ trẻ/giao dịch). */
export function W04CreateCampus() {
  const { org, campuses } = useScope();
  const { refresh } = useAuth();
  const toast = useToast();
  const [created, setCreated] = useState<Created | null>(null);

  const existing = useMemo(() => new Set(campuses.map((c) => c.id.toUpperCase())), [campuses]);

  const form = useForm({
    initial,
    validate: (v) => {
      const e: Record<string, string> = {};
      const code = v.code.trim();
      if (!code) e.code = 'Nhập mã cơ sở.';
      else if (!/^[A-Za-z0-9_-]{2,20}$/.test(code)) e.code = 'Mã 2–20 ký tự gồm chữ, số, gạch nối hoặc gạch dưới.';
      else if (existing.has(code.toUpperCase())) e.code = 'Mã cơ sở đã tồn tại.';
      if (v.name.trim().length < 2) e.name = 'Nhập tên cơ sở (tối thiểu 2 ký tự).';
      if (!v.address.trim()) e.address = 'Nhập địa chỉ cơ sở.';
      if (v.phone.trim() && !/^[0-9+\s().-]{8,20}$/.test(v.phone.trim())) e.phone = 'Số điện thoại chưa đúng định dạng.';
      if (v.openTime >= v.closeTime) e.closeTime = 'Giờ đóng cửa phải sau giờ mở cửa.';
      if (v.principalName.trim() || v.principalEmail.trim()) {
        if (!v.principalName.trim()) e.principalName = 'Nhập họ tên hiệu trưởng.';
        if (!EMAIL_RE.test(v.principalEmail.trim())) e.principalEmail = 'Nhập email hợp lệ để gửi lời mời.';
      }
      if (v.copyFrom && v.copyParts.length === 0) e.copyParts = 'Chọn ít nhất một mục cần sao chép.';
      return e;
    },
  });

  const submit = form.onSubmit(async (v, opId) => {
    const payload: Record<string, unknown> = {
      code: v.code.trim(), name: v.name.trim(), address: v.address.trim(), phone: v.phone.trim(),
      timezone: v.timezone, openTime: v.openTime, closeTime: v.closeTime,
    };
    if (v.principalEmail.trim()) payload.principalInvite = { email: v.principalEmail.trim(), displayName: v.principalName.trim() };
    if (v.copyFrom) payload.copyFrom = { campusId: v.copyFrom, parts: v.copyParts };
    const res = await callApi<Created>('campus.create', { orgId: org!.orgId, opId, payload });
    // Chỉ báo thành công khi máy chủ đã trả kết quả.
    form.reset(initial);
    setCreated(res);
    toast.success(`Đã tạo cơ sở ${res.campus.name}.`);
    await refresh();
  });

  if (created) {
    const copiedText = Object.entries(created.copied ?? {}).map(([k, n]) => `${COPY_PARTS.find((p) => p.id === k)?.label ?? k}: ${n}`).join(', ');
    return (
      <div>
        <PageHeader title="Tạo cơ sở mới" code="W04" />
        <Card>
          <div className="stack">
            <Banner tone="success" title={`Đã tạo cơ sở ${created.campus.name} (${created.campus.code})`}>
              Cơ sở đang ở trạng thái «Chuẩn bị». Thiết lập năm học, lớp, biểu phí rồi kích hoạt vận hành.
            </Banner>
            {copiedText ? <p>Đã sao chép cấu hình: {copiedText}.</p> : null}
            {created.principalInvite ? (
              <p>Đã gửi lời mời hiệu trưởng. Mã mời: <strong>{created.principalInvite.code}</strong>. Người được mời đăng nhập bằng đúng email đã nhập để nhận quyền.</p>
            ) : (
              <p className="text-secondary">Chưa mời hiệu trưởng. Có thể mời sau tại «Tài khoản và lời mời».</p>
            )}
            <div className="row">
              <LinkButton href="/co-so/nam-hoc">Thiết lập năm học và lịch</LinkButton>
              <LinkButton href="/co-so" variant="secondary">Xem danh sách cơ sở</LinkButton>
              <Button variant="tertiary" onClick={() => setCreated(null)}>Tạo cơ sở khác</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tạo cơ sở mới"
        code="W04"
        breadcrumbs={[{ label: 'Cơ sở', href: '/co-so' }, { label: 'Tạo cơ sở mới' }]}
        description="Nhập thông tin cơ bản. Cơ sở mới bắt đầu ở trạng thái «Chuẩn bị»."
      />
      <form className="stack" noValidate onSubmit={submit} style={{ maxWidth: 880 }}>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}

        <Card title="Thông tin cơ sở">
          <div className="grid-2">
            <FormField name="code" label="Mã cơ sở" required helper="Dùng làm định danh, không đổi sau khi tạo. Ví dụ: CG." {...form.field('code')}>
              <Input {...form.bind('code')} autoComplete="off" />
            </FormField>
            <FormField name="name" label="Tên cơ sở" required {...form.field('name')}>
              <Input {...form.bind('name')} autoComplete="off" />
            </FormField>
            <div style={{ gridColumn: '1 / -1' }}>
              <FormField name="address" label="Địa chỉ" required {...form.field('address')}>
                <Input {...form.bind('address')} autoComplete="street-address" />
              </FormField>
            </div>
            <FormField name="phone" label="Số điện thoại liên hệ" {...form.field('phone')}>
              <Input {...form.bind('phone')} inputMode="tel" autoComplete="off" />
            </FormField>
            <FormField name="timezone" label="Múi giờ" required {...form.field('timezone')}>
              <Select {...form.bind('timezone')} options={TZ} />
            </FormField>
            <FormField name="openTime" label="Giờ mở cửa" required {...form.field('openTime')}>
              <Select {...form.bind('openTime')} options={TIMES} />
            </FormField>
            <FormField name="closeTime" label="Giờ đóng cửa" required {...form.field('closeTime')}>
              <Select {...form.bind('closeTime')} options={TIMES} />
            </FormField>
          </div>
        </Card>

        <Card title="Mời hiệu trưởng (tùy chọn)">
          <p className="text-secondary text-small" style={{ marginBottom: 'var(--space-3)' }}>
            Người được mời nhận vai trò Hiệu trưởng chỉ tại cơ sở này. Quyền duyệt tài chính không được cấp mặc định.
          </p>
          <div className="grid-2">
            <FormField name="principalName" label="Họ tên hiệu trưởng" {...form.field('principalName')}>
              <Input {...form.bind('principalName')} autoComplete="off" />
            </FormField>
            <FormField name="principalEmail" label="Email hiệu trưởng" {...form.field('principalEmail')}>
              <Input {...form.bind('principalEmail')} type="email" autoComplete="off" />
            </FormField>
          </div>
        </Card>

        <Card title="Sao chép cấu hình từ cơ sở khác (tùy chọn)">
          <div className="stack">
            <Banner tone="info">Chỉ sao chép danh mục và cấu hình. Hồ sơ trẻ, nhân sự và giao dịch không được sao chép.</Banner>
            <FormField name="copyFrom" label="Cơ sở nguồn" {...form.field('copyFrom')}>
              <Select
                {...form.bind('copyFrom')}
                placeholder="Không sao chép"
                options={campuses.map((c) => ({ value: c.id, label: `${c.name} (${c.code ?? c.id})` }))}
                disabled={campuses.length === 0}
              />
            </FormField>
            {form.values.copyFrom ? (
              <FormField name="copyParts" label="Các mục cần sao chép" required {...form.field('copyParts')}>
                <div id="field-copyParts" tabIndex={-1}>
                  {COPY_PARTS.map((p) => (
                    <Checkbox
                      key={p.id}
                      checked={form.values.copyParts.includes(p.id)}
                      onChange={(on) => form.setValue('copyParts', on ? [...form.values.copyParts, p.id] : form.values.copyParts.filter((x) => x !== p.id))}
                    >
                      {p.label}
                    </Checkbox>
                  ))}
                </div>
              </FormField>
            ) : null}
          </div>
        </Card>

        <div className="row">
          <Button type="submit" size="lg" loading={form.submitting}>Tạo cơ sở</Button>
          <LinkButton href="/co-so" variant="tertiary" size="lg">Quay lại danh sách</LinkButton>
        </div>
      </form>
    </div>
  );
}
