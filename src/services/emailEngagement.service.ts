import { EmailEngagement, type EmailEngagementDocument } from '../models/EmailEngagement.model';

export interface CreateEngagementContext {
  orgId: string;
  leadId: string;
  emailTemplateVersionId: string;
  enrollmentId?: string;
  workflowStepIndex?: number;
  sentAt: Date;
}

/** Creates the per-send engagement row a version's send gets tracked against — call this once, at send time. */
export async function createEngagementRecord(context: CreateEngagementContext): Promise<EmailEngagementDocument> {
  return EmailEngagement.create({
    org_id: context.orgId,
    lead_id: context.leadId,
    email_template_version_id: context.emailTemplateVersionId,
    enrollment_id: context.enrollmentId ?? null,
    workflow_step_index: context.workflowStepIndex ?? null,
    sent_at: context.sentAt,
  });
}

/** Called by the open-tracking pixel route (`GET /o/:token`, token = the engagement's own id). */
export async function recordOpen(engagementId: string): Promise<void> {
  const engagement = await EmailEngagement.findById(engagementId);
  if (!engagement) return;

  const now = new Date();
  engagement.opened = true;
  engagement.open_count += 1;
  if (!engagement.first_opened_at) engagement.first_opened_at = now;
  engagement.last_opened_at = now;
  await engagement.save();
}

/**
 * Called by the click-redirect route (linkTracking.service's recordClick) once it already knows
 * which lead/version a TrackedLink belonged to. Matches the most recent send of that version to
 * that lead — good enough given a lead rarely receives the exact same version twice.
 */
export async function recordClickForEngagement(leadId: string, emailTemplateVersionId: string): Promise<void> {
  const engagement = await EmailEngagement.findOne({
    lead_id: leadId,
    email_template_version_id: emailTemplateVersionId,
  }).sort({ sent_at: -1 });
  if (!engagement) return;

  const now = new Date();
  engagement.clicked = true;
  engagement.click_count += 1;
  if (!engagement.first_clicked_at) engagement.first_clicked_at = now;
  engagement.last_clicked_at = now;
  await engagement.save();
}
