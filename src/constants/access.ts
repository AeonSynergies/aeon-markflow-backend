// Roles from the MarkFlow RBAC table in CLAUDE.md. UserAccessGrant is shared with
// Onboard's Users collection, so this enum may grow to cover Onboard-specific roles later.
export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'BD_ADMIN',
  'BD_MANAGER',
  'BD_LEAD_GEN',
  'BD_SALES',
  'BD_MARKETING',
] as const;
export type Role = (typeof ROLES)[number];

export const APPS = ['markflow', 'onboard'] as const;
export type App = (typeof APPS)[number];

// Roles permitted to view the Recycled/Win-back lead segment (per CLAUDE.md RBAC section).
// BD_ADMIN and BD_MARKETING were added alongside BD_MARKETING's introduction: win-back
// re-engagement is a workflow/email concern (BD-Marketing's job to run), but once a recycled
// lead actually responds it needs a discovery call booked, which is BD-Sales' job again — both
// need visibility, so this isn't a swap like TEMPLATE_APPROVER_ROLES was. BD_ADMIN was added for
// the same hierarchy-consistency reason as its TEMPLATE_APPROVER_ROLES inclusion (BD Admin
// sitting above BD Manager shouldn't be excluded from something BD Manager can see). This now
// happens to equal WORKFLOW_ACCESS_ROLES exactly — no longer a deliberately narrower subset of
// it the way it was when it excluded BD_ADMIN.
export const RECYCLED_SEGMENT_ROLES: Role[] = ['BD_SALES', 'BD_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'BD_ADMIN', 'BD_MARKETING'];

// Roles with no workflow/email/call access — upload/monitor leads only.
export const LEAD_UPLOAD_ONLY_ROLES: Role[] = ['BD_LEAD_GEN'];

// Roles permitted to view raw cross-org insight data (Phase 8) — exact org counts, sample
// sizes, and averaged rates, as opposed to the coarse generic recommendations every
// workflow-access role can see. No other role-gated dataset in this codebase is this
// restrictive; note that here rather than reusing TEMPLATE_APPROVER_ROLES/RECYCLED_SEGMENT_ROLES.
export const ADMIN_ONLY_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];
