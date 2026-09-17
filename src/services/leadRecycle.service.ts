import { Types } from 'mongoose';
import { DISCOVERY_RETRY_GRADUATION_DAYS, DISCOVERY_RETRY_LOST_REASONS } from '../constants/lead';
import { Lead, type LeadDocument } from '../models/Lead.model';

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead ${id} not found`);
    this.name = 'LeadNotFoundError';
  }
}

export interface RecycleLeadInput {
  dealId: string;
  lostReason: string;
  lostStage: string;
  eligibleForReengagementAt?: Date;
}

/**
 * The receiving side of the Lost+Recycle event (Onboard → MarkFlow, per CLAUDE.md's "Repos,
 * backend separation" section) — there was no implementation of either direction of this event
 * anywhere in this codebase before now, only the Lead schema fields it populates
 * (recycled_from_deal_id/lost_reason/lost_stage/eligible_for_reengagement_at) and the read-side
 * GET /orgs/{orgId}/leads?segment=recycled filter. Onboard's own build is still deferred, so
 * nothing calls this yet — it's exercised directly today (tests, or this route called by hand)
 * until a real webhook takes over that job; this route *is* that "internal/test trigger", since
 * no earlier one existed to reuse.
 *
 * Decides RECLAIMED vs. the newer, faster DISCOVERY_RETRY tier purely from lostReason:
 * DISCOVERY_RETRY_LOST_REASONS (no_show/cancelled_discovery) mean a Discovery call was already
 * booked, so this needs urgent reschedule-focused follow-up in MarkFlow's own reminder engine,
 * not RECLAIMED's slower general win-back cadence. Any other lost_reason routes to RECLAIMED,
 * matching every post-call loss per CLAUDE.md's Discovery handoff timing section.
 */
export async function recycleLead(orgId: string, leadId: string, input: RecycleLeadInput): Promise<LeadDocument> {
  const lead = await Lead.findOne({ _id: leadId, org_id: orgId });
  if (!lead) throw new LeadNotFoundError(leadId);

  const isDiscoveryRetry = (DISCOVERY_RETRY_LOST_REASONS as readonly string[]).includes(input.lostReason);

  lead.status = isDiscoveryRetry ? 'DISCOVERY_RETRY' : 'RECLAIMED';
  lead.recycled_from_deal_id = new Types.ObjectId(input.dealId);
  lead.lost_reason = input.lostReason;
  lead.lost_stage = input.lostStage;
  lead.eligible_for_reengagement_at = input.eligibleForReengagementAt ?? null;
  lead.discovery_retry_started_at = isDiscoveryRetry ? new Date() : null;

  await lead.save();
  return lead;
}

/**
 * Daily sweep (discoveryRetryQueue.ts): any Lead sitting in DISCOVERY_RETRY for
 * DISCOVERY_RETRY_GRADUATION_DAYS+ with no successful reschedule graduates to RECLAIMED — same
 * win-back mechanism, slower cadence, per CLAUDE.md. A pure status flip: lost_reason/lost_stage
 * stay exactly as recorded, since it's still the same underlying loss, just a slower tier now.
 */
export async function graduateStaleDiscoveryRetryLeads(): Promise<number> {
  const cutoff = new Date(Date.now() - DISCOVERY_RETRY_GRADUATION_DAYS * 24 * 60 * 60 * 1000);
  const result = await Lead.updateMany(
    { status: 'DISCOVERY_RETRY', discovery_retry_started_at: { $lte: cutoff } },
    { status: 'RECLAIMED', discovery_retry_started_at: null },
  );
  return result.modifiedCount;
}
