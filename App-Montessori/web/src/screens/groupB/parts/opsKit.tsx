'use client';
// Helper riêng cho W37–W40: hộp thoại thao tác có kiểm tra trường nhập theo field.
import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActionDialog } from './kit';

type DialogProps = ComponentProps<typeof ActionDialog>;

/** ActionDialog có lỗi theo field: `check` trả { field: thông điệp }, `children` nhận lỗi để gắn vào FormField. */
export function FormAction({ check, children, ...rest }: Omit<DialogProps, 'validate' | 'children'> & { check: () => Record<string, string>; children: (errs: Record<string, string>) => ReactNode }) {
  const [errs, setErrs] = useState<Record<string, string>>({});
  return (
    <ActionDialog
      {...rest}
      validate={() => {
        const e = check();
        setErrs(e);
        return Object.keys(e).length ? 'Vui lòng kiểm tra lại các trường được đánh dấu.' : null;
      }}
    >
      {children(errs)}
    </ActionDialog>
  );
}

/** "12,5" | "12.5" -> 12.5 ; rỗng/sai -> null. */
export function parseQty(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toMs(v: unknown): number {
  if (v && typeof v === 'object' && 'toMillis' in v) return (v as { toMillis: () => number }).toMillis();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}
