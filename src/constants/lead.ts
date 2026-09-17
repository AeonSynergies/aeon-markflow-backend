// DISCOVERY_RETRY and RECLAIMED are both "came back from a lost Deal via the Lost+Recycle event"
// tiers (see leadRecycle.service.ts) — DISCOVERY_RETRY is the fast, urgent-cadence one (a
// Discovery call was already booked; needs a reschedule push, not a slow win-back sequence),
// RECLAIMED is the slower general win-back tier. A DISCOVERY_RETRY lead auto-graduates to
// RECLAIMED after DISCOVERY_RETRY_GRADUATION_DAYS with no successful reschedule.
export const LEAD_STATUSES = [
  'NEW-COLD',
  'NEW-INBOUND',
  'CONTACTED',
  'CONTACTED-PHONE',
  'CONTACTED-EMAIL',
  'PROSPECT',
  'INACTIVE',
  'RECLAIMED',
  'DISCOVERY_RETRY',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const EMAIL_DELIVERABILITY_STATUSES = ['GOOD', 'LOW', 'BAD'] as const;
export type EmailDeliverabilityStatus = (typeof EMAIL_DELIVERABILITY_STATUSES)[number];

// lost_reason itself stays free text everywhere (no enum) — these are just the specific values
// leadRecycle.service.ts's recycleLead() recognizes as "a Discovery call was already booked, so
// this needs DISCOVERY_RETRY's urgent cadence" rather than RECLAIMED's general one. Any other
// lost_reason string routes to RECLAIMED.
export const DISCOVERY_RETRY_LOST_REASONS = ['no_show', 'cancelled_discovery'] as const;
export type DiscoveryRetryLostReason = (typeof DISCOVERY_RETRY_LOST_REASONS)[number];

// How long a Lead may sit in DISCOVERY_RETRY with no successful reschedule before
// graduateStaleDiscoveryRetryLeads() (discoveryRetryQueue.ts, daily) auto-transitions it to
// RECLAIMED. A proposed default, like every other unreviewed threshold in this codebase.
export const DISCOVERY_RETRY_GRADUATION_DAYS = 30;
