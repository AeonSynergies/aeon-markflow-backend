import type { Role } from './access';

export const STEP_KINDS = ['email', 'call_task', 'sms', 'wait'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const WAIT_UNITS = ['minutes', 'hours', 'days'] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];

export const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'exited'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

// Per the RBAC table: everyone except BD-Lead Gen (upload/monitor leads only, no workflow
// access) may build and run workflows.
export const WORKFLOW_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BD_ADMIN', 'BD_MANAGER', 'BD_SALES'];

const MS_PER_WAIT_UNIT: Record<WaitUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function waitDurationMs(amount: number, unit: WaitUnit): number {
  return amount * MS_PER_WAIT_UNIT[unit];
}
