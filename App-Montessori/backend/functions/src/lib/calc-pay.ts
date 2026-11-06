// Tính lương THUẦN. Tiền = số nguyên VND; Math.round chỉ ở các hàm làm tròn bên dưới.

/** Lương theo công = base × paidDays / standardDays, làm tròn đến đồng (điểm làm tròn duy nhất của phần này).
 *  Ví dụ: 8.000.000 × 25 / 26 = 7.692.308. paidDays quy về phần trăm công để tránh sai số float. */
export function prorateSalary(base: number, paidDays: number, standardDays: number): number {
  if (!(standardDays > 0)) throw new Error('standardDays phải > 0');
  const pd = Math.round(paidDays * 100);
  return Math.round((base * pd) / (standardDays * 100));
}

/** Tiền tăng ca = base / công chuẩn / 480 phút × phút × hệ số; làm tròn một lần. */
export function overtimePay(base: number, standardDays: number, minutes: number, rate = 1.5): number {
  if (!(standardDays > 0) || minutes <= 0) return 0;
  return Math.round((base * minutes * rate) / (standardDays * 480));
}

export interface PayComponent {
  id?: string; code: string; name: string;
  type: 'allowance' | 'bonus' | 'deduction' | 'advance';
  calc?: 'fixed' | 'per_paid_day' | 'percent_of_base_pay';
  amount?: number;   // fixed: số tiền; per_paid_day: tiền/ngày công
  rate?: number;     // percent_of_base_pay: % (vd 10.5)
  effectiveFrom?: string; effectiveTo?: string;
  campusId?: string | null; // chỉ áp dụng tại cơ sở này (null/không có = mọi cơ sở)
  responsibleUid?: string;
}

export interface PayLine { code: string; name: string; type: string; amount: number }

export interface PayrollInput {
  base: number; standardDays: number; paidDays: number; overtimeMinutes: number;
  overtimeRate?: number; components: PayComponent[];
}

export interface PayrollResult {
  basePay: number; overtimePay: number; lines: PayLine[];
  allowances: number; deductions: number; gross: number; net: number;
}

export function computePayroll(i: PayrollInput): PayrollResult {
  const basePay = prorateSalary(i.base, i.paidDays, i.standardDays);
  const ot = overtimePay(i.base, i.standardDays, i.overtimeMinutes, i.overtimeRate ?? 1.5);
  const lines: PayLine[] = [];
  let allowances = 0; let deductions = 0;
  for (const c of i.components) {
    let amt = 0;
    switch (c.calc ?? 'fixed') {
      case 'fixed': amt = c.amount ?? 0; break;
      case 'per_paid_day': amt = Math.round(((c.amount ?? 0) * Math.round(i.paidDays * 100)) / 100); break;
      case 'percent_of_base_pay': amt = Math.round((basePay * (c.rate ?? 0)) / 100); break;
    }
    amt = Math.max(0, Math.round(amt));
    const neg = c.type === 'deduction' || c.type === 'advance';
    lines.push({ code: c.code, name: c.name, type: c.type, amount: neg ? -amt : amt });
    if (neg) deductions += amt; else allowances += amt;
  }
  const gross = basePay + ot + allowances;
  return { basePay, overtimePay: ot, lines, allowances, deductions, gross, net: gross - deductions };
}
