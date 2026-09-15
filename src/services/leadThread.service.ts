import { LeadActivity } from '../models/LeadActivity.model';

export interface ThreadMessage {
  direction: 'inbound' | 'outbound' | null;
  subject?: string;
  bodyText?: string;
  occurredAt: Date;
}

/** Reconstructs a lead's email thread, oldest first, for grounding reply drafts. */
export async function getLeadEmailThread(leadId: string, limit = 20): Promise<ThreadMessage[]> {
  const activities = await LeadActivity.find({ lead_id: leadId, kind: 'email' })
    .sort({ occurred_at: 1 })
    .limit(limit)
    .lean();

  return activities.map((activity) => ({
    direction: activity.direction ?? null,
    subject: activity.subject ?? undefined,
    bodyText: activity.body_text ?? activity.body_html ?? undefined,
    occurredAt: activity.occurred_at,
  }));
}
