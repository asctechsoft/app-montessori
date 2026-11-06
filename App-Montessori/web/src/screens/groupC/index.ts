import type { ComponentType } from 'react';
import type { ScreenProps } from '../registry';
import { W29FeeSchedule } from './W29FeeSchedule';
import { W30BillingRuns } from './W30BillingRuns';
import { W31Receivables } from './W31Receivables';
import { W32ChildReceivable } from './W32ChildReceivable';
import { W33CollectPayment } from './W33CollectPayment';
import { W34Reconcile } from './W34Reconcile';
import { W35RefundsAdjust } from './W35RefundsAdjust';
import { W41Notifications } from './W41Notifications';
import { W42ComposeNotification } from './W42ComposeNotification';
import { W43Threads } from './W43Threads';
import { W44Reports } from './W44Reports';
import { W45AuditLog } from './W45AuditLog';
import { W46ImportBackup } from './W46ImportBackup';
import { W47Approvals } from './W47Approvals';

/** Đăng ký màn hình nhóm C. */
export const GROUP_C: Partial<Record<string, ComponentType<ScreenProps>>> = {
  W29: W29FeeSchedule,
  W30: W30BillingRuns,
  W31: W31Receivables,
  W32: W32ChildReceivable,
  W33: W33CollectPayment,
  W34: W34Reconcile,
  W35: W35RefundsAdjust,
  W41: W41Notifications,
  W42: W42ComposeNotification,
  W43: W43Threads,
  W44: W44Reports,
  W45: W45AuditLog,
  W46: W46ImportBackup,
  W47: W47Approvals,
};
