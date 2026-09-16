import type { Role } from './access';

export const EMAIL_TEMPLATE_VERSION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'RESUBMITTED',
] as const;
export type EmailTemplateVersionStatus = (typeof EMAIL_TEMPLATE_VERSION_STATUSES)[number];

// DRAFT -> PENDING_APPROVAL -> APPROVED | REJECTED -> RESUBMITTED -> PENDING_APPROVAL (loop).
// APPROVED is terminal: a live version is never mutated back to draft — content changes go
// into a new EmailTemplateVersion instead, so a WorkflowStep's pinned version never shifts
// under it.
export const EMAIL_TEMPLATE_VERSION_TRANSITIONS: Record<EmailTemplateVersionStatus, EmailTemplateVersionStatus[]> = {
  DRAFT: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: ['RESUBMITTED'],
  RESUBMITTED: ['PENDING_APPROVAL'],
};

// always/never render unconditionally at send time; auto defers to imagePolicy.service.ts's
// resolveImageRenderDecision, which weighs the workflow step's position (a first-touch cold
// email always strips, regardless of provider) and the recipient's provider category (Phase 8).
export const IMAGE_POLICIES = ['always', 'never', 'auto'] as const;
export type ImagePolicy = (typeof IMAGE_POLICIES)[number];

export const GENERATION_SOURCES = ['ai', 'human', 'ai_edited_by_human'] as const;
export type GenerationSource = (typeof GENERATION_SOURCES)[number];

// Per CLAUDE.md's human-in-the-loop rule and RBAC table: AI-generated/AI-suggested content
// never auto-applies — only these roles may approve or reject an EmailTemplateVersion. Also
// reused by SendGuardrail for resuming a paused domain (src/services/sendGuardrail.service.ts) —
// an equally consequential "a human signed off on this" action.
export const TEMPLATE_APPROVER_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BD_MANAGER', 'BD_SALES'];
