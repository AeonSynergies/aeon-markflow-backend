import { env } from '../config/env';
import { waitDurationMs, type WaitUnit } from '../constants/workflow';
import { resolveSendingRoute } from '../services/domainRouter.service';
import { rewriteLinksForTracking } from '../services/linkTracking.service';
import { Contact } from '../models/Contact.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import { Enrollment, type EnrollmentDocument } from '../models/Enrollment.model';
import type { WorkflowStep } from '../models/WorkflowTemplate.model';
import { Lead } from '../models/Lead.model';
import { LeadActivity } from '../models/LeadActivity.model';
import { Organization } from '../models/Organization.model';
import { enqueueStepJob } from './enrollmentQueue';

export class EnrollmentStepError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EnrollmentStepError';
  }
}

async function sendWorkflowEmail(enrollment: EnrollmentDocument, step: WorkflowStep): Promise<void> {
  const version = await EmailTemplateVersion.findById(step.email_template_version_id).lean();
  if (!version) {
    throw new EnrollmentStepError(`EmailTemplateVersion ${step.email_template_version_id} not found`);
  }
  if (version.status !== 'APPROVED') {
    throw new EnrollmentStepError(
      `EmailTemplateVersion ${step.email_template_version_id} is not APPROVED (status: ${version.status}) — ` +
        'a WorkflowStep may only send an approved version',
    );
  }

  const lead = await Lead.findById(enrollment.lead_id).lean();
  if (!lead) throw new EnrollmentStepError(`Lead ${enrollment.lead_id.toString()} not found`);

  const contact = await Contact.findById(lead.contact_id).lean();
  if (!contact?.email) {
    throw new EnrollmentStepError(`Contact for lead ${enrollment.lead_id.toString()} has no email address`);
  }

  const org = await Organization.findById(lead.org_id).lean();
  if (!org) throw new EnrollmentStepError(`Organization ${lead.org_id.toString()} not found`);
  if (!step.sending_domain) {
    throw new EnrollmentStepError('email step is missing sending_domain');
  }

  const { provider, mailbox } = resolveSendingRoute(org, step.sending_domain);

  const trackedHtml = await rewriteLinksForTracking(
    version.body_html,
    {
      orgId: lead.org_id.toString(),
      leadId: enrollment.lead_id.toString(),
      emailTemplateVersionId: version._id.toString(),
    },
    env.trackingBaseUrl,
  );

  const result = await provider.send(mailbox, {
    to: [contact.email],
    subject: version.subject_line,
    html: trackedHtml,
  });

  await LeadActivity.create({
    lead_id: enrollment.lead_id,
    kind: 'email',
    direction: 'outbound',
    enrollment_id: enrollment._id,
    workflow_step_index: enrollment.current_step_index,
    subject: version.subject_line,
    body_html: trackedHtml,
    provider_message_id: result.providerMessageId,
    occurred_at: result.sentAt,
  });
}

async function createCallTask(enrollment: EnrollmentDocument, step: WorkflowStep): Promise<void> {
  await LeadActivity.create({
    lead_id: enrollment.lead_id,
    kind: 'task',
    enrollment_id: enrollment._id,
    workflow_step_index: enrollment.current_step_index,
    subject: step.call_task_instructions ?? 'Call task',
    occurred_at: new Date(),
  });
}

/**
 * Executes the enrollment's current step, then advances to the next one. A 'wait' step does no
 * external work itself — it just determines the delay before the following step's job runs.
 * SMS steps intentionally fail (not silently skip): Zoom Phone SMS is blocked pending scope
 * approval (see CLAUDE_APPS.md's integration status table), so there is no adapter to send
 * through yet.
 */
export async function processEnrollmentStepJob(enrollmentId: string): Promise<void> {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) return;
  if (enrollment.status !== 'active') return;

  const step = enrollment.steps[enrollment.current_step_index];
  if (!step) {
    enrollment.status = 'completed';
    enrollment.completed_at = new Date();
    await enrollment.save();
    return;
  }

  let delayMsForNextStep = 0;

  switch (step.kind) {
    case 'wait':
      delayMsForNextStep = waitDurationMs(step.wait_amount as number, step.wait_unit as WaitUnit);
      break;
    case 'email':
      await sendWorkflowEmail(enrollment, step);
      break;
    case 'call_task':
      await createCallTask(enrollment, step);
      break;
    case 'sms':
      throw new EnrollmentStepError(
        'SMS sending is not available yet — Zoom Phone SMS is blocked pending scope approval ' +
          '(see CLAUDE_APPS.md integration status table); this step will not advance until a ' +
          'working SMS adapter exists',
      );
    default:
      throw new EnrollmentStepError(`Unknown step kind: ${String(step.kind)}`);
  }

  const nextIndex = enrollment.current_step_index + 1;
  if (nextIndex >= enrollment.steps.length) {
    enrollment.status = 'completed';
    enrollment.completed_at = new Date();
    await enrollment.save();
    return;
  }

  enrollment.current_step_index = nextIndex;
  await enrollment.save();
  await enqueueStepJob(enrollment._id.toString(), nextIndex, delayMsForNextStep);
}
