import type { Role } from '../constants/access';
import {
  EMAIL_TEMPLATE_VERSION_TRANSITIONS,
  TEMPLATE_APPROVER_ROLES,
  type EmailTemplateVersionStatus,
} from '../constants/emailTemplate';
import { EmailTemplate } from '../models/EmailTemplate.model';
import { EmailTemplateVersion, type EmailTemplateVersionDocument } from '../models/EmailTemplateVersion.model';
import { ReviewTask } from '../models/ReviewTask.model';
import { generateEmailDraft, type GenerationRequest } from './emailGeneration.service';
import { sendInternalNotification } from './internalNotification.service';

export class EmailTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`EmailTemplate ${id} not found`);
    this.name = 'EmailTemplateNotFoundError';
  }
}

export class EmailTemplateVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`EmailTemplateVersion ${id} not found`);
    this.name = 'EmailTemplateVersionNotFoundError';
  }
}

export class InvalidTemplateVersionTransitionError extends Error {
  constructor(from: EmailTemplateVersionStatus, to: EmailTemplateVersionStatus) {
    super(`Cannot move an EmailTemplateVersion from ${from} to ${to}`);
    this.name = 'InvalidTemplateVersionTransitionError';
  }
}

export class UnauthorizedApproverRoleError extends Error {
  constructor(role: Role) {
    super(`Role ${role} is not authorized to approve or reject an EmailTemplateVersion`);
    this.name = 'UnauthorizedApproverRoleError';
  }
}

function assertTransition(from: EmailTemplateVersionStatus, to: EmailTemplateVersionStatus): void {
  if (!EMAIL_TEMPLATE_VERSION_TRANSITIONS[from].includes(to)) {
    throw new InvalidTemplateVersionTransitionError(from, to);
  }
}

function assertApproverRole(role: Role): void {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }
}

async function nextVersionNumber(emailTemplateId: string): Promise<number> {
  const count = await EmailTemplateVersion.countDocuments({ email_template_id: emailTemplateId });
  return count + 1;
}

/**
 * Lists an EmailTemplate's versions, newest first. Callers building a workflow step picker
 * should pass status: 'APPROVED' — a WorkflowStep pins to a specific version id, never
 * "latest", so only APPROVED versions are ever safe to offer as a pin target.
 */
export async function listEmailTemplateVersions(
  emailTemplateId: string,
  status?: EmailTemplateVersionStatus,
): Promise<EmailTemplateVersionDocument[]> {
  return EmailTemplateVersion.find({
    email_template_id: emailTemplateId,
    ...(status ? { status } : {}),
  }).sort({ version_number: -1 });
}

/**
 * Generates an AI draft via Claude and persists it as a new DRAFT EmailTemplateVersion. This
 * never submits it for review itself — per CLAUDE.md's human-in-the-loop rule, AI content only
 * moves out of DRAFT when a human explicitly calls submitForReview.
 */
export async function createAiDraftVersion(
  emailTemplateId: string,
  request: GenerationRequest,
): Promise<EmailTemplateVersionDocument> {
  const draft = await generateEmailDraft({ emailTemplateId, request });

  return EmailTemplateVersion.create({
    email_template_id: emailTemplateId,
    version_number: await nextVersionNumber(emailTemplateId),
    subject_line: draft.subjectLine,
    body_html: draft.bodyHtml,
    generation_source: 'ai',
    status: 'DRAFT',
    ai_draft_snapshot: { subject_line: draft.subjectLine, body_html: draft.bodyHtml },
    ai_generation_metadata: {
      reference_templates: draft.referenceTemplates
        .map((example) => example.emailTemplateVersionId)
        .filter((id): id is string => Boolean(id)),
      reason: draft.reason,
      brand_voice_guidelines_version: draft.brandVoiceGuidelinesVersion,
      model: draft.model,
      generated_at: new Date(),
    },
  });
}

/** Moves a DRAFT or RESUBMITTED version into PENDING_APPROVAL and opens a ReviewTask for it. */
export async function submitForReview(
  versionId: string,
  requestedByUserId?: string,
): Promise<EmailTemplateVersionDocument> {
  const version = await EmailTemplateVersion.findById(versionId);
  if (!version) throw new EmailTemplateVersionNotFoundError(versionId);

  assertTransition(version.status as EmailTemplateVersionStatus, 'PENDING_APPROVAL');
  version.status = 'PENDING_APPROVAL';
  await version.save();

  const template = await EmailTemplate.findById(version.email_template_id).lean();
  if (!template) throw new EmailTemplateNotFoundError(version.email_template_id.toString());

  await ReviewTask.create({
    org_id: template.org_id,
    email_template_version_id: version._id,
    requested_by: requestedByUserId ?? null,
  });

  await sendInternalNotification({
    subject: '[MarkFlow] Email template version pending review',
    html: `<p>EmailTemplateVersion ${version._id} (template ${version.email_template_id}) was submitted for review.</p>`,
  });

  return version;
}

/** Approves a PENDING_APPROVAL version. Only BD-Sales/BD-Manager/Admin/Super Admin may call this. */
export async function approveVersion(
  versionId: string,
  reviewerUserId: string,
  reviewerRole: Role,
): Promise<EmailTemplateVersionDocument> {
  assertApproverRole(reviewerRole);

  const version = await EmailTemplateVersion.findById(versionId);
  if (!version) throw new EmailTemplateVersionNotFoundError(versionId);

  assertTransition(version.status as EmailTemplateVersionStatus, 'APPROVED');
  version.status = 'APPROVED';
  await version.save();

  await ReviewTask.findOneAndUpdate(
    { email_template_version_id: version._id, status: 'OPEN' },
    { status: 'APPROVED', reviewed_by: reviewerUserId, reviewed_at: new Date() },
  );

  await EmailTemplate.findByIdAndUpdate(version.email_template_id, { current_version_id: version._id });

  return version;
}

/** Rejects a PENDING_APPROVAL version. Only BD-Sales/BD-Manager/Admin/Super Admin may call this. */
export async function rejectVersion(
  versionId: string,
  reviewerUserId: string,
  reviewerRole: Role,
  rejectionReason: string,
): Promise<EmailTemplateVersionDocument> {
  assertApproverRole(reviewerRole);

  const version = await EmailTemplateVersion.findById(versionId);
  if (!version) throw new EmailTemplateVersionNotFoundError(versionId);

  assertTransition(version.status as EmailTemplateVersionStatus, 'REJECTED');
  version.status = 'REJECTED';
  await version.save();

  await ReviewTask.findOneAndUpdate(
    { email_template_version_id: version._id, status: 'OPEN' },
    { status: 'REJECTED', reviewed_by: reviewerUserId, reviewed_at: new Date(), rejection_reason: rejectionReason },
  );

  return version;
}

/**
 * Moves a REJECTED version to RESUBMITTED, optionally applying the human's edits. Call
 * submitForReview afterwards to send it back for another approval pass.
 */
export async function resubmitVersion(
  versionId: string,
  edits?: { subjectLine?: string; bodyHtml?: string },
): Promise<EmailTemplateVersionDocument> {
  const version = await EmailTemplateVersion.findById(versionId);
  if (!version) throw new EmailTemplateVersionNotFoundError(versionId);

  assertTransition(version.status as EmailTemplateVersionStatus, 'RESUBMITTED');

  if (edits?.subjectLine) version.subject_line = edits.subjectLine;
  if (edits?.bodyHtml) version.body_html = edits.bodyHtml;
  if ((edits?.subjectLine || edits?.bodyHtml) && version.generation_source === 'ai') {
    version.generation_source = 'ai_edited_by_human';
  }

  version.status = 'RESUBMITTED';
  await version.save();

  return version;
}
