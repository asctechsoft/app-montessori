import type { ComponentType } from 'react';
import type { ScreenProps } from '../registry';
import { W05YearsCalendar } from './W05YearsCalendar';
import { W08Leads } from './W08Leads';
import { W09LeadDetail } from './W09LeadDetail';
import { W10Children } from './W10Children';
import { W11ChildDetail } from './W11ChildDetail';
import { W12CreateChild } from './W12CreateChild';
import { W13Transfer } from './W13Transfer';
import { W14Classes } from './W14Classes';
import { W15ClassDetail } from './W15ClassDetail';
import { W16Attendance } from './W16Attendance';
import { W17Handover } from './W17Handover';
import { W18CareLogs } from './W18CareLogs';
import { W19Health } from './W19Health';
import { W20Incidents } from './W20Incidents';
import { W48CampusOverview } from './W48CampusOverview';

/** Đăng ký màn hình nhóm A: { W08: W08Leads, ... } */
export const GROUP_A: Partial<Record<string, ComponentType<ScreenProps>>> = {
  W05: W05YearsCalendar,
  W08: W08Leads,
  W09: W09LeadDetail,
  W10: W10Children,
  W11: W11ChildDetail,
  W12: W12CreateChild,
  W13: W13Transfer,
  W14: W14Classes,
  W15: W15ClassDetail,
  W16: W16Attendance,
  W17: W17Handover,
  W18: W18CareLogs,
  W19: W19Health,
  W20: W20Incidents,
  W48: W48CampusOverview,
};
