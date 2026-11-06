import type { ComponentType } from 'react';
import type { ScreenProps } from '../registry';
import { W21Staff } from './W21Staff';
import { W22StaffProfile } from './W22StaffProfile';
import { W23Roster } from './W23Roster';
import { W24Timekeeping } from './W24Timekeeping';
import { W25TimesheetApprove } from './W25TimesheetApprove';
import { W26StaffLeave } from './W26StaffLeave';
import { W27Payroll } from './W27Payroll';
import { W28Payslips } from './W28Payslips';
import { W36Expenses } from './W36Expenses';
import { W37Menu } from './W37Menu';
import { W38Stock } from './W38Stock';
import { W39Assets } from './W39Assets';
import { W40Transport } from './W40Transport';

/** Đăng ký màn hình nhóm B: nhân sự, công, lương, thu chi, bếp, kho, tài sản, xe. */
export const GROUP_B: Partial<Record<string, ComponentType<ScreenProps>>> = {
  W21: W21Staff,
  W22: W22StaffProfile,
  W23: W23Roster,
  W24: W24Timekeeping,
  W25: W25TimesheetApprove,
  W26: W26StaffLeave,
  W27: W27Payroll,
  W28: W28Payslips,
  W36: W36Expenses,
  W37: W37Menu,
  W38: W38Stock,
  W39: W39Assets,
  W40: W40Transport,
};
