export const SEND_TIME_STRATEGIES = ['manual', 'ai_suggested', 'ai_automatic'] as const;
export type SendTimeStrategy = (typeof SEND_TIME_STRATEGIES)[number];

// OPEN: an ai_suggested proposal awaiting human approval (mirrors ReviewTask's own OPEN status —
//   this uses the same word deliberately, see CLAUDE.md's "existing ReviewTask/PENDING_APPROVAL-
//   style gate").
// APPROVED: the currently-active recommendation for its (org, workflow_type, persona) group —
//   either a human approved it, or ai_automatic applied it directly.
// REJECTED: a human declined an ai_suggested proposal.
// SUPERSEDED: was APPROVED, but a newer, better-performing combination replaced it.
export const SEND_TIME_RECOMMENDATION_STATUSES = ['OPEN', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type SendTimeRecommendationStatus = (typeof SEND_TIME_RECOMMENDATION_STATUSES)[number];

export const SEND_TIME_RECOMMENDATION_SOURCES = ['ai_suggested', 'ai_automatic'] as const;
export type SendTimeRecommendationSource = (typeof SEND_TIME_RECOMMENDATION_SOURCES)[number];

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * Same situation as SendGuardrail's ramp-up numbers and Phase 6's diagnosis thresholds: no real
 * send-time history exists yet for any Aeon MarkFlow org, so none of these are calibrated —
 * they're reasonable starting points, not measured fits. Treat them as a proposal to review and
 * adjust, not a final answer. The rollup/recommendation logic that uses these numbers is the
 * part that should be trusted.
 */

/** Don't trust a single (day, hour, timezone, content) bucket's reply/meeting rate below this many sends. */
export const MIN_SAMPLE_SIZE_FOR_SEND_TIME_BUCKET = 30;

/**
 * Need at least this many buckets clearing the sample-size floor for the same (org, workflow_type,
 * persona) before picking a "best" one — comparing the only bucket ever tried against nothing
 * isn't a comparison, it's just that bucket's own noise.
 */
export const MIN_CANDIDATE_BUCKETS_BEFORE_RECOMMENDING = 3;

/**
 * A newly-found best bucket must beat the currently-approved one by at least this relative
 * margin in reply rate before it's worth proposing a change — without this, ordinary week-to-week
 * noise would keep generating a new "best" combination every rollup cycle.
 */
export const SEND_TIME_IMPROVEMENT_MARGIN = 0.1; // 10% relative improvement

/** How far back the rolling rollup looks when recomputing SendTimePerformance. */
export const SEND_TIME_ROLLUP_LOOKBACK_DAYS = 90;

/** How often the rollup + recommendation cycle re-runs. Daily, matching Phase 6's analytics cadence. */
export const SEND_TIME_ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
