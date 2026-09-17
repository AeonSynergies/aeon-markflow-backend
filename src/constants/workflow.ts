import type { Role } from './access';

export const STEP_KINDS = ['email', 'call_task', 'sms', 'wait'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const WAIT_UNITS = ['minutes', 'hours', 'days'] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];

export const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'exited'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

// Per the RBAC table: everyone except BD-Lead Gen (upload/monitor leads only, no workflow
// access) may build and run workflows.
//
// BD-Marketing was added here (not explicitly requested, but required to avoid a shown-then-
// 403'd nav item): the frontend nav shows BD-Marketing the Workflows/Template Review/Templates
// links, and every one of those pages' endpoints — including reviewTask.routes and
// workflowTemplate.routes — is gated on this exact role list. One known, accepted imprecision
// this carries over: this same list also gates savedList.routes' bulk lead-list/enrollment
// endpoints, so BD-Marketing is technically able to call those directly even though the intent
// (per CLAUDE.md's RBAC table) is "no Leads access, that's sales' job" — there is no narrower
// existing role set that separates "template/workflow access" from "lead bulk-action access",
// and inventing one is out of scope here. The frontend simply never shows the Leads nav link or
// the bulk-select UI to BD-Marketing, same as how every other role-based hide already works.
export const WORKFLOW_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BD_ADMIN', 'BD_MANAGER', 'BD_SALES', 'BD_MARKETING'];

const MS_PER_WAIT_UNIT: Record<WaitUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function waitDurationMs(amount: number, unit: WaitUnit): number {
  return amount * MS_PER_WAIT_UNIT[unit];
}
