export const DIAGNOSIS_SYMPTOMS = [
  'high_bounce_rate',
  'low_open_rate',
  'no_click_through',
  'no_reply_after_click',
] as const;
export type DiagnosisSymptom = (typeof DIAGNOSIS_SYMPTOMS)[number];

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * Same situation as SendGuardrail's ramp-up numbers (src/constants/sendGuardrail.ts): there is
 * no real send/open/click/reply history for any Aeon MarkFlow template yet, so none of these
 * are calibrated — they're reasonable starting points, not measured fits. Treat them as a
 * proposal to review and adjust, not a final answer. The diagnosis waterfall order and the
 * gating logic that uses these numbers is the part that should be trusted.
 */

/**
 * Don't diagnose a version's performance at all below this many sends — mirrors SendGuardrail's
 * own minimum-sample-size principle (GUARDRAIL_MIN_SAMPLE_SIZE), scaled down because this gates
 * a single template version's own volume rather than a whole domain's aggregate traffic across
 * every template using it.
 */
export const MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS = 30;

/**
 * The click-through and reply-among-clickers checks divide by a narrower count (opens, clicks)
 * than the top-level sent count — without its own floor, a version with 30 sends but only 1
 * open would compute a "0% click-through rate" off a single data point. Applied to whichever
 * count is the denominator for that specific check.
 */
export const MIN_DENOMINATOR_FOR_SUBRATE = 10;

/**
 * Open rate is an explicitly weak signal (Apple MPP, Gmail image-proxy prefetching — see
 * CLAUDE.md's "must never violate" rule 1) — never compared against an absolute threshold, only
 * ever against this org's own other versions, and only when there's enough of them to trust the
 * comparison at all.
 */
export const MIN_BASELINE_COMPARABLE_VERSIONS = 3;

/** Flag "low open rate" when a version's open rate is at or below this fraction of its baseline. */
export const LOW_OPEN_RATE_RELATIVE_THRESHOLD = 0.75;

/** Flag "opened but no click": click-through-rate among openers at or below this fraction. */
export const LOW_CLICK_THROUGH_RATE = 0.1;

/** Flag "clicks but no reply": reply rate among clickers at or below this fraction. */
export const LOW_REPLY_AMONG_CLICKERS_RATE = 0.05;

/**
 * A defined sample per variant before an A/B test is considered ready to decide — deliberately
 * larger than MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS, since detecting a *difference* between two
 * variants needs more volume than just characterizing one version's own rates.
 */
export const AB_TEST_MIN_SAMPLE_SIZE_PER_VARIANT = 200;

/** How often the diagnosis pipeline re-scans every org's live (APPROVED, in-use) template versions. */
export const EMAIL_ANALYTICS_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
