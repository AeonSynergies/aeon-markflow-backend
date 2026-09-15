import type { Role } from '../constants/access';
import {
  GUARDRAIL_LONG_WINDOW_DAYS,
  GUARDRAIL_MIN_SAMPLE_SIZE,
  GUARDRAIL_SHORT_WINDOW_HOURS,
  HARD_STOP_BOUNCE_RATE,
  HARD_STOP_COMPLAINT_RATE,
  RAMP_UP_STARTING_DAILY_CAP,
  RAMP_UP_STEADY_STATE_DAILY_CAP,
  RAMP_UP_STEP_INTERVAL_DAYS,
  RAMP_UP_STEP_MULTIPLIER,
  THROTTLE_BOUNCE_RATE,
  THROTTLE_COMPLAINT_RATE,
  type GuardrailAction,
  type SendEventKind,
} from '../constants/sendGuardrail';
import { TEMPLATE_APPROVER_ROLES } from '../constants/emailTemplate';
import { DomainGuardrailState } from '../models/DomainGuardrailState.model';
import { DomainSendEvent } from '../models/DomainSendEvent.model';
import { ReviewTask } from '../models/ReviewTask.model';
import { UnauthorizedApproverRoleError } from './emailTemplateVersion.service';

export interface GuardrailDecision {
  allowed: boolean;
  action: GuardrailAction;
  reason?: string;
  dailyCap?: number;
  sentInWindow?: number;
}

interface WindowCounts {
  sent: number;
  bounced: number;
  complained: number;
  replied: number;
}

const EMPTY_COUNTS: WindowCounts = { sent: 0, bounced: 0, complained: 0, replied: 0 };

async function windowCounts(domain: string, since: Date): Promise<WindowCounts> {
  const rows = await DomainSendEvent.aggregate<{ _id: SendEventKind; count: number }>([
    { $match: { domain, createdAt: { $gte: since } } },
    { $group: { _id: '$kind', count: { $sum: 1 } } },
  ]);

  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

interface RateBreach {
  breached: boolean;
  reason?: string;
}

function rateBreach(
  counts: WindowCounts,
  windowLabel: string,
  bounceThreshold: number,
  complaintThreshold: number,
): RateBreach {
  if (counts.sent < GUARDRAIL_MIN_SAMPLE_SIZE) return { breached: false };

  const bounceRate = counts.bounced / counts.sent;
  if (bounceRate >= bounceThreshold) {
    return {
      breached: true,
      reason: `Bounce rate ${(bounceRate * 100).toFixed(1)}% over the trailing ${windowLabel} (${counts.bounced}/${counts.sent}) is at or above the ${(bounceThreshold * 100).toFixed(1)}% threshold`,
    };
  }

  const complaintRate = counts.complained / counts.sent;
  if (complaintRate >= complaintThreshold) {
    return {
      breached: true,
      reason: `Spam-complaint rate ${(complaintRate * 100).toFixed(2)}% over the trailing ${windowLabel} (${counts.complained}/${counts.sent}) is at or above the ${(complaintThreshold * 100).toFixed(2)}% threshold`,
    };
  }

  return { breached: false };
}

/** The ramp-up daily cap for a domain, based on how long ago it first sent anything. */
export async function getRampCapForDomain(domain: string): Promise<number> {
  const firstSend = await DomainSendEvent.findOne({ domain, kind: 'sent' })
    .sort({ createdAt: 1 })
    .lean();
  if (!firstSend) return RAMP_UP_STARTING_DAILY_CAP;

  const daysSinceFirstSend = Math.floor((Date.now() - firstSend.createdAt.getTime()) / 86_400_000);
  const steps = Math.floor(daysSinceFirstSend / RAMP_UP_STEP_INTERVAL_DAYS);
  const cap = RAMP_UP_STARTING_DAILY_CAP * RAMP_UP_STEP_MULTIPLIER ** steps;
  return Math.min(cap, RAMP_UP_STEADY_STATE_DAILY_CAP);
}

/**
 * Records a real outbound send. Call this only after the provider actually accepted the message
 * — this is the "volume sent" input to both the ramp-up cap and the sample-size floor on rate
 * checks.
 */
export async function recordSend(context: {
  domain: string;
  mailbox: string;
  orgId: string;
  leadId?: string;
  enrollmentId?: string;
}): Promise<void> {
  await DomainSendEvent.create({
    domain: context.domain,
    mailbox: context.mailbox,
    org_id: context.orgId,
    lead_id: context.leadId ?? null,
    enrollment_id: context.enrollmentId ?? null,
    kind: 'sent',
  });
}

/**
 * Records a bounce/complaint/reply outcome for a domain. Nothing in this codebase calls this
 * yet: there is no ESP webhook receiver (Microsoft Graph change notifications, Gmail Pub/Sub
 * push, Zoho's webhook mechanism) and no inbound-message poller using EmailProvider's own
 * fetchNewMessages, so bounce/complaint/reply rates always read as zero from real data today.
 * This function is the integration point a future webhook handler or poller should call — the
 * rate-based throttle/hard-stop logic below is fully implemented and tested against it, it just
 * has no live inputs yet. Flagging this clearly rather than silently shipping a guardrail that
 * looks complete but can never actually detect a bad domain by rate.
 */
export async function recordDeliverabilityEvent(
  domain: string,
  mailbox: string,
  orgId: string,
  kind: Exclude<SendEventKind, 'sent'>,
  context: { leadId?: string; enrollmentId?: string } = {},
): Promise<void> {
  await DomainSendEvent.create({
    domain,
    mailbox,
    org_id: orgId,
    lead_id: context.leadId ?? null,
    enrollment_id: context.enrollmentId ?? null,
    kind,
  });
}

/**
 * Pauses a domain entirely and opens a ReviewTask so a human notices — the one significant
 * action SendGuardrail takes autonomously (per CLAUDE.md's human-in-the-loop exception for
 * sending guardrails). Idempotent: calling it again while already paused does nothing, so a
 * string of denied sends against the same breach doesn't spam a ReviewTask per attempt.
 */
export async function pauseDomain(domain: string, mailbox: string, orgId: string, reason: string): Promise<void> {
  const existing = await DomainGuardrailState.findOne({ domain });
  if (existing?.status === 'paused') return;

  const reviewTask = await ReviewTask.create({
    org_id: orgId,
    kind: 'domain_guardrail',
    domain,
    status: 'OPEN',
    rejection_reason: reason,
  });

  await DomainGuardrailState.findOneAndUpdate(
    { domain },
    {
      domain,
      mailbox,
      status: 'paused',
      paused_at: new Date(),
      paused_reason: reason,
      review_task_id: reviewTask._id,
      resumed_at: null,
      resumed_by: null,
    },
    { upsert: true },
  );
}

/**
 * Resumes a paused domain and resolves its ReviewTask. Only a role that could also approve an
 * EmailTemplateVersion may call this — resuming a domain SendGuardrail paused for an extreme
 * bounce/complaint rate is at least as consequential as approving template content.
 */
export async function resumeDomain(domain: string, userId: string, role: Role): Promise<void> {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }

  const state = await DomainGuardrailState.findOne({ domain }).lean();
  if (!state || state.status !== 'paused') return;

  await DomainGuardrailState.findOneAndUpdate(
    { domain },
    { status: 'active', resumed_at: new Date(), resumed_by: userId },
  );

  if (state.review_task_id) {
    await ReviewTask.findByIdAndUpdate(state.review_task_id, {
      status: 'APPROVED',
      reviewed_by: userId,
      reviewed_at: new Date(),
    });
  }
}

/**
 * The gate: call this before dispatching a send through a Phase 2 email adapter. Always
 * enforces the hard safety stops (extreme bounce/complaint rate) regardless of
 * `requiresWarmup` — those are a safety mechanism, not a per-workflow strategy choice. Ramp-up
 * volume throttling only applies when `requiresWarmup` is true, per WorkflowTemplate's own flag.
 */
export async function canSend(
  domain: string,
  mailbox: string,
  orgId: string,
  options: { requiresWarmup: boolean },
): Promise<GuardrailDecision> {
  const state = await DomainGuardrailState.findOne({ domain }).lean();
  if (state?.status === 'paused') {
    return {
      allowed: false,
      action: 'paused',
      reason: state.paused_reason ?? 'Domain is paused pending review',
    };
  }

  const shortSince = new Date(Date.now() - GUARDRAIL_SHORT_WINDOW_HOURS * 60 * 60 * 1000);
  const longSince = new Date(Date.now() - GUARDRAIL_LONG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [shortCounts, longCounts] = await Promise.all([
    windowCounts(domain, shortSince),
    windowCounts(domain, longSince),
  ]);

  const shortLabel = `${GUARDRAIL_SHORT_WINDOW_HOURS}h`;
  const longLabel = `${GUARDRAIL_LONG_WINDOW_DAYS}d`;

  const shortHardStop = rateBreach(shortCounts, shortLabel, HARD_STOP_BOUNCE_RATE, HARD_STOP_COMPLAINT_RATE);
  const longHardStop = rateBreach(longCounts, longLabel, HARD_STOP_BOUNCE_RATE, HARD_STOP_COMPLAINT_RATE);
  const hardStop = shortHardStop.breached ? shortHardStop : longHardStop;

  if (hardStop.breached) {
    await pauseDomain(domain, mailbox, orgId, hardStop.reason!);
    return { allowed: false, action: 'paused', reason: hardStop.reason };
  }

  if (!options.requiresWarmup) {
    return { allowed: true, action: 'allowed' };
  }

  const throttled =
    rateBreach(shortCounts, shortLabel, THROTTLE_BOUNCE_RATE, THROTTLE_COMPLAINT_RATE).breached ||
    rateBreach(longCounts, longLabel, THROTTLE_BOUNCE_RATE, THROTTLE_COMPLAINT_RATE).breached;

  const baseCap = await getRampCapForDomain(domain);
  const dailyCap = throttled ? Math.max(1, Math.floor(baseCap / 2)) : baseCap;
  const sentInWindow = shortCounts.sent;

  if (sentInWindow >= dailyCap) {
    return {
      allowed: false,
      action: 'throttled',
      reason: throttled
        ? `Elevated bounce/complaint rate halved the ramp cap to ${dailyCap}/day; already sent ${sentInWindow} in the last ${shortLabel}`
        : `Ramp-up cap for this domain's warmup stage is ${dailyCap}/day; already sent ${sentInWindow} in the last ${shortLabel}`,
      dailyCap,
      sentInWindow,
    };
  }

  return { allowed: true, action: 'allowed', dailyCap, sentInWindow };
}
