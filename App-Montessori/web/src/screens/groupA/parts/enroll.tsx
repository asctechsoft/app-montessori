'use client';
import type { ApiError } from '@/lib/api';
import { Banner } from '@/components/ui/Banner';
import { Button, LinkButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Fields';
import { CHILD_STATUS, obj, str, type ClassRow } from './kit';

export const seatsText = (cls: ClassRow, enrolled: number): string => `${enrolled}/${cls.capacity}`;

interface ClassSelectProps {
  name?: string;
  classes: ClassRow[];
  occupancy: (c: ClassRow) => number;
  value: string;
  onValueChange: (v: string) => void;
  invalid?: boolean;
  onBlur?: () => void;
  placeholder?: string;
}

/** Chọn lớp kèm sĩ số hiện tại; lớp đầy vẫn chọn được (đi theo luồng xin duyệt ngoại lệ). */
export function ClassSelect({ name, classes, occupancy, value, onValueChange, invalid, onBlur, placeholder = 'Chọn lớp' }: ClassSelectProps) {
  return (
    <Select
      name={name}
      value={value}
      invalid={invalid}
      onBlur={onBlur}
      onValueChange={onValueChange}
      placeholder={placeholder}
      options={classes.filter((c) => c.status !== 'closed').map((c) => {
        const n = occupancy(c);
        return { value: c.id, label: `${c.name} — sĩ số ${seatsText(c, n)}${n >= c.capacity ? ' (đã đủ)' : ''}` };
      })}
    />
  );
}

interface Suggestion {
  classId: string;
  name: string;
  capacity: number;
  enrolled: number;
  free: number;
}

interface Dup {
  id: string;
  code?: string;
  fullName?: string;
  status?: string;
}

/** Hiển thị chi tiết lỗi nhập học/chuyển lớp: lớp đầy kèm gợi ý lớp còn chỗ; hồ sơ trùng. */
export function EnrollProblems({ error, onPickClass }: { error: ApiError | null; onPickClass?: (classId: string) => void }) {
  if (!error) return null;
  const d = error.details;
  const suggestions = (Array.isArray(d.suggestions) ? d.suggestions : []).map((x) => obj(x)).map((x) => ({
    classId: str(x.classId), name: str(x.name), capacity: Number(x.capacity ?? 0), enrolled: Number(x.enrolled ?? 0), free: Number(x.free ?? 0),
  } as Suggestion));
  const dups = (Array.isArray(d.duplicates) ? d.duplicates : []).map((x) => obj(x)).map((x) => ({
    id: str(x.id), code: str(x.code), fullName: str(x.fullName), status: str(x.status),
  } as Dup));
  if (error.code === 'LIMIT' && suggestions.length > 0) {
    return (
      <Banner tone="warning" title="Lớp đã đủ sĩ số. Có thể chọn lớp còn chỗ:">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {suggestions.map((s) => (
            <li key={s.classId}>
              {s.name}: còn {s.free} chỗ ({s.enrolled}/{s.capacity}){' '}
              {onPickClass ? <Button size="sm" variant="tertiary" onClick={() => onPickClass(s.classId)}>Chọn lớp này</Button> : null}
            </li>
          ))}
        </ul>
      </Banner>
    );
  }
  if (error.code === 'CONFLICT' && dups.length > 0) {
    return (
      <Banner tone="warning" title="Đã có hồ sơ trẻ trùng tên và ngày sinh:">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {dups.map((x) => (
            <li key={x.id}>
              {x.code} · {x.fullName} ({CHILD_STATUS[x.status ?? '']?.label ?? x.status}){' '}
              <LinkButton href={`/tre/${x.id}`} variant="tertiary" size="sm">Mở hồ sơ</LinkButton>
            </li>
          ))}
        </ul>
        <div>Tick «Vẫn tạo hồ sơ mới» nếu chắc chắn đây là trẻ khác, rồi gửi lại.</div>
      </Banner>
    );
  }
  return null;
}

export const hasDuplicates = (e: ApiError | null): boolean => !!e && e.code === 'CONFLICT' && Array.isArray(e.details.duplicates) && e.details.duplicates.length > 0;
