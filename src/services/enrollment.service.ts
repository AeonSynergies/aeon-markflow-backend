import { Enrollment } from '../models/Enrollment.model';
import { Organization } from '../models/Organization.model';
import { SavedList } from '../models/SavedList.model';
import { enqueueStepJob } from '../queues/enrollmentQueue';
import type { WorkflowStepInput } from '../types/api/workflow';
import { resolveStepForEnrollment } from './abTesting.service';
import { assignMailboxesForDomains } from './domainRouter.service';
import { getWorkflowTemplate } from './workflowTemplate.service';

export class SavedListNotFoundError extends Error {
  constructor(id: string) {
    super(`SavedList ${id} not found`);
    this.name = 'SavedListNotFoundError';
  }
}

export class EmptyWorkflowTemplateError extends Error {
  constructor(templateId: string) {
    super(`WorkflowTemplate ${templateId} has no steps to enroll into`);
    this.name = 'EmptyWorkflowTemplateError';
  }
}

export class CrossOrgReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossOrgReferenceError';
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(id: string) {
    super(`Organization ${id} not found`);
    this.name = 'OrganizationNotFoundError';
  }
}

export interface EnrollSavedListResult {
  enrolledCount: number;
  skippedCount: number;
  enrollmentIds: string[];
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Enrolls every lead in a SavedList into a WorkflowTemplate: one Enrollment per lead, each with
 * its own frozen snapshot of the template's current steps, its own mailbox assignment per
 * distinct sending domain among those steps (assignMailboxesForDomains — round-robinned once
 * here, then reused for every send in the sequence rather than re-resolved per step), and the
 * first step's job enqueued immediately. A lead already actively enrolled in this same template
 * is skipped rather than erroring the whole batch (enforced by Enrollment's partial unique index).
 */
export async function enrollSavedList(templateId: string, savedListId: string): Promise<EnrollSavedListResult> {
  const template = await getWorkflowTemplate(templateId);
  if (template.steps.length === 0) throw new EmptyWorkflowTemplateError(templateId);

  const savedList = await SavedList.findById(savedListId).lean();
  if (!savedList) throw new SavedListNotFoundError(savedListId);

  if (savedList.org_id.toString() !== template.org_id.toString()) {
    throw new CrossOrgReferenceError(
      `SavedList ${savedListId} belongs to a different org than WorkflowTemplate ${templateId}`,
    );
  }

  const org = await Organization.findById(template.org_id).lean();
  if (!org) throw new OrganizationNotFoundError(template.org_id.toString());

  const enrollmentIds: string[] = [];
  let skippedCount = 0;

  for (const leadId of savedList.lead_ids) {
    try {
      // Resolved independently per lead: an A/B group's traffic split is a per-enrollment coin
      // flip, not a batch-wide choice (see abTesting.service.ts's own doc comment). Converted to
      // plain objects first — resolveStepForEnrollment takes the API-shaped WorkflowStepInput,
      // not a live Mongoose subdocument.
      const plainSteps = JSON.parse(JSON.stringify(template.steps)) as WorkflowStepInput[];
      const steps = await Promise.all(plainSteps.map(resolveStepForEnrollment));

      // Workflow enrollment sends are always MarkFlow's own marketing-purpose sends — see
      // enrollmentProcessor.ts. One mailbox per distinct sending_domain among this lead's own
      // (post-A/B) steps, resolved once here rather than per send.
      const sendingDomains = steps
        .filter((step): step is typeof step & { sending_domain: string } => step.kind === 'email' && !!step.sending_domain)
        .map((step) => step.sending_domain);
      const assignedMailboxes = await assignMailboxesForDomains(org, sendingDomains, 'marketing');

      const enrollment = await Enrollment.create({
        lead_id: leadId,
        workflow_template_id: template._id,
        steps,
        requires_warmup: template.requires_warmup ?? false,
        workflow_type: template.workflow_type ?? null,
        send_time_strategy: org.send_time_strategy ?? 'manual',
        assigned_mailboxes: assignedMailboxes,
        current_step_index: 0,
        status: 'active',
      });
      enrollmentIds.push(enrollment._id.toString());
      await enqueueStepJob(enrollment._id.toString(), 0, 0);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        skippedCount += 1;
        continue;
      }
      throw error;
    }
  }

  return { enrolledCount: enrollmentIds.length, skippedCount, enrollmentIds };
}

/**
 * Moves one enrollment out of automation — the exit-condition counterpart to
 * processEnrollmentStepJob's own 'completed' transition (enrollmentProcessor.ts), which only
 * ever fires when a sequence runs out of steps. This fires instead when something outside the
 * sequence itself says it should stop early: today, an AI-classified reply (see
 * mailboxPoller.service.ts — 'interested' exits the correlated enrollment directly,
 * 'unsubscribe_request' exits every active enrollment for the lead via
 * exitAllActiveEnrollmentsForLead below). Idempotent — only an `active` enrollment is exited, so
 * calling this twice (or after the enrollment already completed on its own) is a harmless no-op.
 * `completed_at` doubles as "ended at" here — there is no separate field for it, and both a
 * completed and an exited enrollment equally stopped being active at that timestamp.
 */
export async function exitEnrollment(enrollmentId: string, exitReason: string): Promise<void> {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment || enrollment.status !== 'active') return;

  enrollment.status = 'exited';
  enrollment.exit_reason = exitReason;
  enrollment.completed_at = new Date();
  await enrollment.save();
}

/**
 * Exits every currently-active enrollment for a lead, regardless of which one a triggering event
 * (e.g. an unsubscribe-request reply) happened to thread against — a compliance action needs to
 * stop every automated sequence still running for that lead, not just the one this particular
 * reply came in on.
 */
export async function exitAllActiveEnrollmentsForLead(leadId: string, exitReason: string): Promise<void> {
  const activeEnrollments = await Enrollment.find({ lead_id: leadId, status: 'active' }, '_id').lean();
  await Promise.all(activeEnrollments.map((enrollment) => exitEnrollment(enrollment._id.toString(), exitReason)));
}
