import { actions as orgActions } from './org';
import { actions as entityActions } from './entity';
import { actions as childrenActions } from './children';
import { actions as attendanceActions } from './attendance';
import { actions as careActions } from './care';
import { actions as commsActions } from './comms';
import { actions as approvalsActions } from './approvals';
import { actions as hrActions } from './hr';
import { actions as payrollActions } from './payroll';
import { actions as financeActions } from './finance';
import { actions as opsActions } from './ops';
import { actions as reportsActions } from './reports';
import { actions as adminActions } from './admin';
import type { ActionMap } from '../core/types';

export const actions: ActionMap = {
  ...orgActions,
  ...entityActions,
  ...childrenActions,
  ...attendanceActions,
  ...careActions,
  ...commsActions,
  ...approvalsActions,
  ...hrActions,
  ...payrollActions,
  ...financeActions,
  ...opsActions,
  ...reportsActions,
  ...adminActions,
};
