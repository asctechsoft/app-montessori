'use client';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormField, Input, Select } from '@/components/ui/Fields';
import { EMAIL_RE, PHONE_RE, RELATION_OPTIONS, phoneKey } from './kit';

export interface GuardianDraft {
  key: string;
  name: string;
  phone: string;
  email: string;
  relation: string;
  notify: boolean;
  viewFees: boolean;
  pickup: boolean;
}

let seq = 0;
export const newGuardian = (relation = 'mother'): GuardianDraft => ({
  key: `g${Date.now().toString(36)}${seq++}`,
  name: '', phone: '', email: '', relation, notify: true, viewFees: false, pickup: false,
});

/** Lỗi theo field: khóa `guardians.{i}.name|contact|phone|email`. Danh sách rỗng là hợp lệ. */
export function validateGuardians(list: GuardianDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  const seen = new Map<string, number>();
  list.forEach((g, i) => {
    if (!g.name.trim()) e[`guardians.${i}.name`] = 'Nhập họ tên người giám hộ.';
    if (!g.phone.trim() && !g.email.trim()) e[`guardians.${i}.contact`] = 'Nhập số điện thoại hoặc email để gửi lời mời.';
    if (g.phone.trim() && !PHONE_RE.test(g.phone.trim())) e[`guardians.${i}.phone`] = 'Số điện thoại chưa đúng định dạng.';
    if (g.email.trim() && !EMAIL_RE.test(g.email.trim())) e[`guardians.${i}.email`] = 'Email chưa đúng định dạng.';
    const k = g.phone.trim() ? phoneKey(g.phone) : g.email.trim().toLowerCase();
    if (k) {
      if (seen.has(k)) e[`guardians.${i}.contact`] = `Trùng liên hệ với người giám hộ thứ ${(seen.get(k) ?? 0) + 1}.`;
      else seen.set(k, i);
    }
  });
  return e;
}

export const guardianBody = (g: GuardianDraft) => ({
  name: g.name.trim(), phone: g.phone.trim(), email: g.email.trim(), relation: g.relation,
  perms: { notify: g.notify, viewFees: g.viewFees, pickup: g.pickup },
});

interface Props {
  drafts: GuardianDraft[];
  onChange: (next: GuardianDraft[]) => void;
  errors: Record<string, string | undefined>;
  /** Cho phép danh sách rỗng (bỏ nút xóa khi chỉ còn một). */
  min?: number;
  disabled?: boolean;
}

/** Nhập người giám hộ; quyền nhận thông báo, xem học phí, đón trẻ tách riêng từng người. */
export function GuardianEditor({ drafts, onChange, errors, min = 0, disabled }: Props) {
  const patch = (i: number, p: Partial<GuardianDraft>) => onChange(drafts.map((g, idx) => (idx === i ? { ...g, ...p } : g)));
  return (
    <div className="stack">
      {drafts.map((g, i) => (
        <fieldset
          key={g.key}
          disabled={disabled}
          style={{ border: '1px solid var(--color-borderSubtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', margin: 0, minWidth: 0 }}
        >
          <legend className="text-small" style={{ padding: '0 var(--space-2)' }}>Người giám hộ {i + 1}</legend>
          <div className="stack">
            <div className="grid-2">
              <FormField name={`guardian-${i}-name`} label="Họ tên" required error={errors[`guardians.${i}.name`]}>
                <Input value={g.name} onValueChange={(v) => patch(i, { name: v })} autoComplete="off" />
              </FormField>
              <FormField name={`guardian-${i}-relation`} label="Quan hệ với trẻ" required>
                <Select value={g.relation} onValueChange={(v) => patch(i, { relation: v })} options={RELATION_OPTIONS} />
              </FormField>
              <FormField name={`guardian-${i}-phone`} label="Số điện thoại" error={errors[`guardians.${i}.phone`] ?? errors[`guardians.${i}.contact`]}>
                <Input value={g.phone} onValueChange={(v) => patch(i, { phone: v })} inputMode="tel" autoComplete="off" />
              </FormField>
              <FormField name={`guardian-${i}-email`} label="Email" error={errors[`guardians.${i}.email`]}>
                <Input value={g.email} onValueChange={(v) => patch(i, { email: v })} type="email" autoComplete="off" />
              </FormField>
            </div>
            <div>
              <div className="field-label">Quyền của người giám hộ này</div>
              <div className="row" style={{ gap: 'var(--space-4)' }}>
                <Checkbox checked={g.notify} onChange={(v) => patch(i, { notify: v })}>Nhận thông báo</Checkbox>
                <Checkbox checked={g.viewFees} onChange={(v) => patch(i, { viewFees: v })}>Xem học phí</Checkbox>
                <Checkbox checked={g.pickup} onChange={(v) => patch(i, { pickup: v })}>Được đón trẻ</Checkbox>
              </div>
            </div>
            {drafts.length > min ? (
              <div>
                <Button size="sm" variant="tertiary" onClick={() => onChange(drafts.filter((_, idx) => idx !== i))}>Bỏ người giám hộ {i + 1}</Button>
              </div>
            ) : null}
          </div>
        </fieldset>
      ))}
      <div>
        <Button variant="secondary" icon="plus" onClick={() => onChange([...drafts, newGuardian(drafts.length === 0 ? 'mother' : drafts.length === 1 ? 'father' : 'other')])} disabled={disabled || drafts.length >= 6}>
          Thêm người giám hộ
        </Button>
      </div>
      <p className="text-caption">
        Nếu số điện thoại hoặc email đã có tài khoản phụ huynh, hệ thống liên kết với tài khoản đó (không tạo trùng). Nếu chưa có, hệ thống tạo lời mời kích hoạt; hồ sơ trẻ vẫn được giữ khi phụ huynh chưa kích hoạt.
      </p>
    </div>
  );
}
