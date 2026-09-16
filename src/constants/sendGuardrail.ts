export const SEND_EVENT_KINDS = ['sent', 'bounced', 'complained', 'replied'] as const;
export type SendEventKind = (typeof SEND_EVENT_KINDS)[number];

export const GUARDRAIL_DOMAIN_STATUSES = ['active', 'paused'] as const;
export type GuardrailDomainStatus = (typeof GUARDRAIL_DOMAIN_STATUSES)[number];

export const GUARDRAIL_ACTIONS = ['allowed', 'throttled', 'paused'] as const;
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number];

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * There is no real send history for any Aeon MarkFlow domain yet, so none of the numbers below
 * are calibrated against actual data — they're a reasonable starting point assembled from
 * common ESP warmup guidance (Google/Yahoo bulk-sender postmaster guidelines, Mailgun/SendGrid's
 * published warmup schedules), not a measured fit to how Aeon Sign/Aeon Miles/etc. actually
 * send. Treat every constant in this section as a proposal for a human to review and adjust —
 * the code that *uses* them (ramp-up stepping, throttle vs. hard-stop) is the part that should
 * be trusted, not these specific thresholds.
 */

/** Day-1 daily send cap for a domain/mailbox with no send history. */
export const RAMP_UP_STARTING_DAILY_CAP = 20;

/** The daily cap multiplies by this factor every RAMP_UP_STEP_INTERVAL_DAYS. */
export const RAMP_UP_STEP_MULTIPLIER = 2;

/** How often (in days) the daily cap steps up. 20 -> 40 -> 80 -> 160 -> ... every 3 days. */
export const RAMP_UP_STEP_INTERVAL_DAYS = 3;

/** The cap stops climbing once it would exceed this — reached after ~21 days at the settings above. */
export const RAMP_UP_STEADY_STATE_DAILY_CAP = 2000;

/** Fast-reacting window for rate-based checks — catches an acute problem within the same day. */
export const GUARDRAIL_SHORT_WINDOW_HOURS = 24;

/** Slower, noise-smoothing window for rate-based checks — catches a slow-building problem. */
export const GUARDRAIL_LONG_WINDOW_DAYS = 7;

/**
 * Below this many sends in a window, a bounce/complaint rate is too noisy to act on (1 bounce
 * out of 3 sends is not a 33% bounce rate in any meaningful sense) — only the raw ramp-up volume
 * cap applies until a window has at least this much data. Bounce/complaint/reply events are now
 * live (see src/services/mailboxPoller.service.ts) rather than hypothetical, which is exactly
 * why this floor matters: 100 is deliberately conservative for a brand-new signal — a mailbox
 * still in its first days of ramp-up (starting at 20/day) won't even reach this floor in the
 * fast 24h window, so only the slower 7-day window can act on it early on, by design.
 */
export const GUARDRAIL_MIN_SAMPLE_SIZE = 100;

/** At or above this bounce rate (in either window, once past the minimum sample size), halve the ramp cap. */
export const THROTTLE_BOUNCE_RATE = 0.02; // 2%

/** At or above this spam-complaint rate, halve the ramp cap. */
export const THROTTLE_COMPLAINT_RATE = 0.0005; // 0.05%

/** At or above this bounce rate, treat it as an extreme signal: pause the domain entirely. */
export const HARD_STOP_BOUNCE_RATE = 0.05; // 5%

/** At or above this spam-complaint rate, treat it as an extreme signal: pause the domain entirely. */
export const HARD_STOP_COMPLAINT_RATE = 0.001; // 0.1%

/**
 * How long a guardrail-deferred (throttled or paused) send waits before the enrollment engine
 * retries it. Deliberately short relative to a day: the rolling windows above age out send
 * events continuously, so an hourly retry naturally finds fresh headroom as soon as it exists,
 * and self-recovers once a paused domain is resumed, without anything having to re-kick blocked
 * enrollments by hand.
 */
export const GUARDRAIL_RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour
