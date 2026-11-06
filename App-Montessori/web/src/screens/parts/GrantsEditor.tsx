'use client';
import { dayKey } from '@/lib/format';
import { PRINCIPAL_EXCLUDED, permissionLabel, type Grant } from '@/lib/permissions';
import { Button } from '@/components/ui/Button';
import { Checkbox, DateInput, FormField, Select, type SelectOption } from '@/components/ui/Fields';

export interface GrantDraft {
  key: string;
  roleId: string;
  scope: 'all' | 'some';
  campusIds: string[];
  validFrom: string; // YYYY-MM-DD hoặc ''
  validTo: string;
  extraPerms: string[];
  /** Trường gốc của grant cũ (id, classIds, deniedPerms...) được giữ nguyên khi lưu. */
  raw?: Grant;
}

let seq = 0;
export const newDraft = (): GrantDraft => ({ key: `d${++seq}`, roleId: '', scope: 'some', campusIds: [], validFrom: '', validTo: '', extraPerms: [] });

export function grantToDraft(g: Grant): GrantDraft {
  return {
    key: `d${++seq}`,
    roleId: g.roleId,
    scope: g.campusIds.includes('*') ? 'all' : 'some',
    campusIds: g.campusIds.filter((c) => c !== '*'),
    validFrom: g.validFrom ? dayKey(g.validFrom) : '',
    validTo: g.validTo ? dayKey(g.validTo) : '',
    extraPerms: g.extraPerms ?? [],
    raw: g,
  };
}

/** Chuyển bản nháp thành Grant gửi máy chủ. Ngày theo múi giờ Việt Nam (GMT+7). */
export function draftToGrant(d: GrantDraft): Grant {
  const g: Grant = { ...(d.raw ?? { id: '' }), id: d.raw?.id ?? '', roleId: d.roleId, campusIds: d.scope === 'all' ? ['*'] : d.campusIds };
  if (!g.id) delete (g as Partial<Grant>).id;
  if (d.validFrom) g.validFrom = `${d.validFrom}T00:00:00+07:00`; else delete g.validFrom;
  if (d.validTo) g.validTo = `${d.validTo}T23:59:59+07:00`; else delete g.validTo;
  if (d.extraPerms.length) g.extraPerms = d.extraPerms; else delete g.extraPerms;
  return g;
}

/** Trả lỗi theo grant (mảng chỉ số -> thông điệp). */
export function validateDrafts(drafts: GrantDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (drafts.length === 0) e.grants = 'Gán ít nhất một vai trò và phạm vi.';
  drafts.forEach((d, i) => {
    if (!d.roleId) e[`g${i}.roleId`] = 'Chọn vai trò.';
    if (d.scope === 'some' && d.campusIds.length === 0) e[`g${i}.campus`] = 'Chọn ít nhất một cơ sở hoặc toàn tổ chức.';
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) e[`g${i}.validTo`] = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
  });
  return e;
}

const SENSITIVE = PRINCIPAL_EXCLUDED.filter((p) => p !== 'org.manage' && p !== 'roles.manage');

interface Props {
  drafts: GrantDraft[];
  onChange: (d: GrantDraft[]) => void;
  roleOptions: SelectOption[];
  campusOptions: { id: string; name: string }[];
  allowOrgWide: boolean;
  /** Quyền người thao tác có thể cấp thêm (chỉ cấp được quyền bản thân đang có). */
  canGrantPerm: (perm: string) => boolean;
  errors: Record<string, string | undefined>;
}

export function GrantsEditor({ drafts, onChange, roleOptions, campusOptions, allowOrgWide, canGrantPerm, errors }: Props) {
  const patch = (key: string, p: Partial<GrantDraft>) => onChange(drafts.map((d) => (d.key === key ? { ...d, ...p } : d)));
  return (
    <div className="stack" id="field-grants" tabIndex={-1}>
      {errors.grants ? <div className="field-error" role="alert">{errors.grants}</div> : null}
      {drafts.map((d, i) => (
        <fieldset key={d.key} className="card stack" style={{ margin: 0 }}>
          <legend className="field-label">Vai trò {i + 1}</legend>
          <FormField name={`g${i}-roleId`} label="Vai trò" required error={errors[`g${i}.roleId`]}>
            <Select name={`g${i}-roleId`} value={d.roleId} onValueChange={(v) => patch(d.key, { roleId: v })} placeholder="Chọn vai trò" options={roleOptions} />
          </FormField>
          <FormField name={`g${i}-scope`} label="Phạm vi" required error={errors[`g${i}.campus`]}>
            <Select
              name={`g${i}-scope`}
              value={d.scope}
              onValueChange={(v) => patch(d.key, { scope: v as 'all' | 'some' })}
              options={[...(allowOrgWide ? [{ value: 'all', label: 'Toàn tổ chức' }] : []), { value: 'some', label: 'Một số cơ sở' }]}
            />
          </FormField>
          {d.scope === 'some' ? (
            <div role="group" aria-label="Cơ sở được gán">
              {campusOptions.map((c) => (
                <Checkbox key={c.id} checked={d.campusIds.includes(c.id)} onChange={(on) => patch(d.key, { campusIds: on ? [...d.campusIds, c.id] : d.campusIds.filter((x) => x !== c.id) })}>
                  {c.name}
                </Checkbox>
              ))}
            </div>
          ) : null}
          <div className="grid-2">
            <FormField name={`g${i}-validFrom`} label="Có hiệu lực từ" helper="Để trống = ngay bây giờ.">
              <DateInput name={`g${i}-validFrom`} value={d.validFrom} onValueChange={(v) => patch(d.key, { validFrom: v })} />
            </FormField>
            <FormField name={`g${i}-validTo`} label="Hết hiệu lực" helper="Để trống = không giới hạn." error={errors[`g${i}.validTo`]}>
              <DateInput name={`g${i}-validTo`} value={d.validTo} onValueChange={(v) => patch(d.key, { validTo: v })} />
            </FormField>
          </div>
          <div role="group" aria-label="Quyền cấp bổ sung">
            <div className="field-label">Cấp thêm quyền nhạy cảm (mặc định không có)</div>
            {SENSITIVE.map((p) => (
              <Checkbox key={p} checked={d.extraPerms.includes(p)} disabled={!canGrantPerm(p) && !d.extraPerms.includes(p)} onChange={(on) => patch(d.key, { extraPerms: on ? [...d.extraPerms, p] : d.extraPerms.filter((x) => x !== p) })}>
                {permissionLabel(p)}
              </Checkbox>
            ))}
          </div>
          {drafts.length > 1 ? (
            <div>
              <Button variant="tertiary" size="sm" onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}>Gỡ vai trò {i + 1} khỏi danh sách</Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      <div>
        <Button variant="secondary" icon="plus" onClick={() => onChange([...drafts, newDraft()])}>Thêm vai trò</Button>
      </div>
    </div>
  );
}
