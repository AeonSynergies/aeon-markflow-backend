import { env } from '../config/env';
import type { ImagePolicy } from '../constants/emailTemplate';
import { GUARDRAIL_RETRY_DELAY_MS } from '../constants/sendGuardrail';
import { waitDurationMs, type WaitUnit } from '../constants/workflow';
import { createEngagementRecord } from '../services/emailEngagement.service';
import { resolveSendingRoute } from '../services/domainRouter.service';
import { resolveImageRenderDecision, renderOrStripImageBlocks } from '../services/imagePolicy.service';
import { getActiveSendTimeRecommendation } from '../services/sendTimeOptimization.service';
import { insertOpenTrackingPixel, rewriteLinksForTracking } from '../services/linkTracking.service';
import { canSend, recordSend } from '../services/sendGuardrail.service';
import { localDayAndHour, nextOccurrenceInTimezone, resolveTimezone } from '../utils/timezone';
import { Contact } from '../models/Contact.model';
import { EmailTemplate } from '../models/EmailTemplate.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import { Enrollment, type EnrollmentDocument } from '../models/Enrollment.model';
import type { WorkflowStep } from '../models/WorkflowTemplate.model';
import { Lead } from '../models/Lead.model';
import { LeadActivity } from '../models/LeadActivity.model';
import { Organization } from '../models/Organization.model';
import { enqueueGuardrailRetryJob, enqueueSendTimeRetryJob, enqueueStepJob } from './enrollmentQueue';

export class EnrollmentStepError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EnrollmentStepError';
  }
}

export type SendWorkflowEmailResult =
  | { outcome: 'sent' }
  | { outcome: 'deferred_guardrail' }
  | { outcome: 'deferred_send_time'; delayMs: number };

/**
 * Sends the email step, gated by SendGuardrail.canSend() — the one check standing between this
 * function and a Phase 2 adapter, not a separate dashboard nobody looks at — and, before that,
 * by send-time optimization (Phase 7) when the enrollment's own send_time_strategy calls for it.
 * SendGuardrail always has the final word: a slot send-time optimization considers "optimal" that
 * SendGuardrail would still throttle/pause gets deferred by SendGuardrail's own retry delay, not
 * overridden or re-picked by send-time logic.
 */
async function sendWorkflowEmail(enrollment: EnrollmentDocument, step: WorkflowStep): Promise<SendWorkflowEmailResult> {
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

  const template = await EmailTemplate.findById(version.email_template_id).lean();
  const persona = template?.persona ?? null;
  const orgId = lead.org_id.toString();
  const timezone = resolveTimezone(contact.timezone);

  if (enrollment.send_time_strategy !== 'manual') {
    const recommendation = await getActiveSendTimeRecommendation(orgId, enrollment.workflow_type ?? null, persona);
    // Only applied when the recipient's own timezone matches the recommendation's timezone_bucket
    // exactly — a recommendation's day/hour is only meaningful within the timezone it was
    // computed for. A recipient outside that bucket falls straight through to sending now
    // (manual-equivalent) rather than being deferred against a mismatched clock; multi-timezone
    // recommendations are a known gap, not yet built (see CLAUDE.md).
    if (recommendation && recommendation.timezone_bucket === timezone) {
      const now = new Date();
      const { dayOfWeek, hour } = localDayAndHour(now, timezone);
      const inWindow = dayOfWeek === recommendation.day_of_week && hour === recommendation.hour_bucket;
      if (!inWindow) {
        const nextSlot = nextOccurrenceInTimezone(now, timezone, recommendation.day_of_week, recommendation.hour_bucket);
        return { outcome: 'deferred_send_time', delayMs: Math.max(0, nextSlot.getTime() - now.getTime()) };
      }
    }
  }

  // Workflow enrollment sends are always MarkFlow's own cold-outreach/sequence sends — always
  // resolved against the org's marketing-purpose domains, never transactional/alerts ones.
  const route = resolveSendingRoute(org, step.sending_domain, 'marketing');

  const decision = await canSend(route.domain, route.mailbox, orgId, {
    requiresWarmup: enrollment.requires_warmup ?? false,
  });
  if (!decision.allowed) {
    return { outcome: 'deferred_guardrail' };
  }

  const recipientDomain = contact.email.split('@')[1] ?? '';
  const shouldRenderImages = await resolveImageRenderDecision({
    policy: version.image_policy as ImagePolicy,
    workflowStepIndex: enrollment.current_step_index,
    recipientDomain,
  });
  const imageProcessedHtml = renderOrStripImageBlocks(version.body_html, version.image_blocks, shouldRenderImages);

  const linkTrackedHtml = await rewriteLinksForTracking(
    imageProcessedHtml,
    {
      orgId: lead.org_id.toString(),
      leadId: enrollment.lead_id.toString(),
      emailTemplateVersionId: version._id.toString(),
    },
    env.trackingBaseUrl,
  );

  const sentAt = new Date();
  const { dayOfWeek, hour } = localDayAndHour(sentAt, timezone);
  const engagement = await createEngagementRecord({
    orgId,
    leadId: enrollment.lead_id.toString(),
    emailTemplateVersionId: version._id.toString(),
    enrollmentId: enrollment._id.toString(),
    workflowStepIndex: enrollment.current_step_index,
    sentAt,
    workflowType: enrollment.workflow_type ?? null,
    persona,
    dayOfWeek,
    hourBucket: hour,
    timezoneBucket: timezone,
  });
  const trackedHtml = insertOpenTrackingPixel(
    linkTrackedHtml,
    `${env.trackingBaseUrl.replace(/\/+$/, '')}/o/${engagement._id.toString()}`,
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
    email_template_version_id: version._id,
    subject: version.subject_line,
    body_html: trackedHtml,
    provider_message_id: result.providerMessageId,
    provider_thread_id: result.providerThreadId,
    occurred_at: result.sentAt,
  });

  await recordSend({
    domain: route.domain,
    mailbox: route.mailbox,
    orgId,
    leadId: enrollment.lead_id.toString(),
    enrollmentId: enrollment._id.toString(),
    emailTemplateVersionId: version._id.toString(),
  });

  return { outcome: 'sent' };
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
      const result = await sendWorkflowEmail(enrollment, step);
      if (result.outcome === 'deferred_guardrail') {
        // SendGuardrail deferred this send — leave current_step_index untouched and retry
        // later rather than treating this as a failed job or silently dropping the step.
        await enqueueGuardrailRetryJob(enrollment._id.toString(), enrollment.current_step_index, GUARDRAIL_RETRY_DELAY_MS);
        return;
      }
      if (result.outcome === 'deferred_send_time') {
        // Send-time optimization deferred this send to its next optimal window — same
        // "not yet, don't advance" handling, just a different (usually much longer) delay.
        await enqueueSendTimeRetryJob(enrollment._id.toString(), enrollment.current_step_index, result.delayMs);
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
