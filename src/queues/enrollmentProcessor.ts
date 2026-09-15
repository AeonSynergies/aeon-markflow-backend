import { env } from '../config/env';
import { GUARDRAIL_RETRY_DELAY_MS } from '../constants/sendGuardrail';
import { waitDurationMs, type WaitUnit } from '../constants/workflow';
import { resolveSendingRoute } from '../services/domainRouter.service';
import { rewriteLinksForTracking } from '../services/linkTracking.service';
import { canSend, recordSend } from '../services/sendGuardrail.service';
import { Contact } from '../models/Contact.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import { Enrollment, type EnrollmentDocument } from '../models/Enrollment.model';
import type { WorkflowStep } from '../models/WorkflowTemplate.model';
import { Lead } from '../models/Lead.model';
import { LeadActivity } from '../models/LeadActivity.model';
import { Organization } from '../models/Organization.model';
import { enqueueGuardrailRetryJob, enqueueStepJob } from './enrollmentQueue';

export class EnrollmentStepError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EnrollmentStepError';
  }
}

/**
 * Sends the email step, gated by SendGuardrail.canSend() — the one check standing between this
 * function and a Phase 2 adapter, not a separate dashboard nobody looks at. Returns false when
 * the guardrail deferred the send (throttled by the domain's ramp-up cap, or the domain is
 * paused) rather than throwing: this isn't a failure of the step, it's "not yet" — the caller
 * re-schedules the same step instead of advancing past it.
 */
async function sendWorkflowEmail(enrollment: EnrollmentDocument, step: WorkflowStep): Promise<boolean> {
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

  const route = resolveSendingRoute(org, step.sending_domain);
  const orgId = lead.org_id.toString();

  const decision = await canSend(route.domain, route.mailbox, orgId, {
    requiresWarmup: enrollment.requires_warmup ?? false,
  });
  if (!decision.allowed) {
    return false;
  }

  const trackedHtml = await rewriteLinksForTracking(
    version.body_html,
    {
      orgId: lead.org_id.toString(),
      leadId: enrollment.lead_id.toString(),
      emailTemplateVersionId: version._id.toString(),
    },
    env.trackingBaseUrl,
  );

  const result = await route.provider.send(route.mailbox, {
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

  await recordSend({
    domain: route.domain,
    mailbox: route.mailbox,
    orgId,
    leadId: enrollment.lead_id.toString(),
    enrollmentId: enrollment._id.toString(),
  });

  return true;
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
    case 'email': {
      const sent = await sendWorkflowEmail(enrollment, step);
      if (!sent) {
        // SendGuardrail deferred this send — leave current_step_index untouched and retry
        // later rather than treating this as a failed job or silently dropping the step.
        await enqueueGuardrailRetryJob(enrollment._id.toString(), enrollment.current_step_index, GUARDRAIL_RETRY_DELAY_MS);
        return;
      }
      break;
    }
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
