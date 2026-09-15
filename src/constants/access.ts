// Roles from the MarkFlow RBAC table in CLAUDE.md. UserAccessGrant is shared with
// Onboard's Users collection, so this enum may grow to cover Onboard-specific roles later.
export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'BD_ADMIN',
  'BD_MANAGER',
  'BD_LEAD_GEN',
  'BD_SALES',
] as const;
export type Role = (typeof ROLES)[number];

export const APPS = ['markflow', 'onboard'] as const;
export type App = (typeof APPS)[number];

// Roles permitted to view the Recycled/Win-back lead segment (per CLAUDE.md RBAC section).
export const RECYCLED_SEGMENT_ROLES: Role[] = ['BD_SALES', 'BD_MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Roles with no workflow/email/call access — upload/monitor leads only.
export const LEAD_UPLOAD_ONLY_ROLES: Role[] = ['BD_LEAD_GEN'];

// Roles permitted to view raw cross-org insight data (Phase 8) — exact org counts, sample
// sizes, and averaged rates, as opposed to the coarse generic recommendations every
// workflow-access role can see. No other role-gated dataset in this codebase is this
// restrictive; note that here rather than reusing TEMPLATE_APPROVER_ROLES/RECYCLED_SEGMENT_ROLES.
export const ADMIN_ONLY_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];
