// sequence_shape: the ordered list of step kinds a WorkflowTemplate uses (e.g.
//   email -> wait -> call_task -> email), observed across multiple orgs' templates.
// step_count: how many steps a sequence tends to have, for a given workflow_type.
// send_time_window: a (day_of_week, hour_bucket, timezone_bucket) combination that performs
//   well across multiple orgs' own SendTimePerformance rollups (Phase 7).
export const CROSS_ORG_INSIGHT_TYPES = ['sequence_shape', 'step_count', 'send_time_window'] as const;
export type CrossOrgInsightType = (typeof CROSS_ORG_INSIGHT_TYPES)[number];

// A coarse, non-numeric label shown alongside a generic recommendation in the workflow builder —
// deliberately hides the exact org_count/sample_size backing it, so even the generic view never
// lets someone infer exactly how many orgs or sends are behind a pattern. Only the raw,
// Admin/Super-Admin-only view exposes the real numbers (see crossOrgInsight.service.ts).
export const CROSS_ORG_INSIGHT_CONFIDENCE_LEVELS = ['emerging', 'established'] as const;
export type CrossOrgInsightConfidence = (typeof CROSS_ORG_INSIGHT_CONFIDENCE_LEVELS)[number];

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * Same situation as every other phase's thresholds: no real cross-org history exists yet, so
 * these are reasonable starting points, not measured fits.
 */

/**
 * A pattern only becomes a CrossOrgInsight once independently observed across at least this
 * many distinct orgs — this is the actual abstraction mechanism, not just a trust threshold: an
 * insight can never exist that traces back to fewer than this many orgs, so it can never reveal
 * one specific org's own behavior.
 */
export const MIN_ORGS_FOR_INSIGHT = 3;

/**
 * Below this many total sends backing a send_time_window pattern (summed across all its
 * qualifying orgs' own SendTimePerformance buckets), don't trust it. Doesn't apply to
 * sequence_shape/step_count insights — those are gated by MIN_ORGS_FOR_INSIGHT alone, since
 * their "sample" is templates, not sends, and templates are inherently low-volume.
 */
export const MIN_SAMPLE_SIZE_FOR_INSIGHT = 90;

/** A send_time_window insight only pulls from an org's own SendTimePerformance buckets that
 * already clear Phase 7's own per-bucket floor — never a single low-volume bucket. */
export const MIN_ORG_BUCKET_SAMPLE_SIZE = 30;

/** sample_size at or above this, for a send_time_window or sequence_shape/step_count insight,
 * is labeled "established" in the generic view; below it, "emerging". */
export const ESTABLISHED_SAMPLE_SIZE_THRESHOLD = 300;

/** How often the cross-org rollup recomputes. Weekly, not daily — structural/timing patterns
 * shared across orgs move far slower than one org's own content/timing tuning (Phase 6/7). */
export const CROSS_ORG_INSIGHT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
