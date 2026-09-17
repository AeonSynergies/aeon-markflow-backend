import type { Role } from '../constants/access';
import { type GuardrailAction, type SendEventKind } from '../constants/sendGuardrail';
import { TEMPLATE_APPROVER_ROLES } from '../constants/emailTemplate';
import { DomainGuardrailState } from '../models/DomainGuardrailState.model';
import { DomainSendEvent } from '../models/DomainSendEvent.model';
import { ReviewTask } from '../models/ReviewTask.model';
import { UnauthorizedApproverRoleError } from './emailTemplateVersion.service';
import { GUARDRAIL_SETTINGS_DEFAULTS, resolveGuardrailSettings } from './guardrailSettings.service';
import { sendInternalNotification } from './internalNotification.service';

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

async function windowCounts(domain: string, mailbox: string, since: Date): Promise<WindowCounts> {
  const rows = await DomainSendEvent.aggregate<{ _id: SendEventKind; count: number }>([
    { $match: { domain, mailbox, createdAt: { $gte: since } } },
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
  minSampleSize: number,
): RateBreach {
  if (counts.sent < minSampleSize) return { breached: false };

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

/**
 * The ramp-up daily cap for one mailbox on a domain, based on how long ago *that mailbox* first
 * sent anything — not how long the domain itself has been sending. A newly added mailbox has no
 * DomainSendEvent rows of its own yet, so this always starts it fresh at the starting daily cap
 * regardless of how established the domain (or its other mailboxes) already are.
 *
 * The starting cap, step multiplier/interval, and steady-state cap all come from
 * `resolveGuardrailSettings` (an optional per-(org, domain) override over the hardcoded defaults
 * in src/constants/sendGuardrail.ts) when `orgId` is given, or the hardcoded defaults directly
 * when it's omitted — this function's own math is unchanged either way.
 */
export async function getRampCapForMailbox(domain: string, mailbox: string, orgId?: string): Promise<number> {
  const settings = orgId ? await resolveGuardrailSettings(orgId, domain) : GUARDRAIL_SETTINGS_DEFAULTS;

  const firstSend = await DomainSendEvent.findOne({ domain, mailbox, kind: 'sent' })
    .sort({ createdAt: 1 })
    .lean();
  if (!firstSend) return settings.rampUpStartingDailyCap;

  const daysSinceFirstSend = Math.floor((Date.now() - firstSend.createdAt.getTime()) / 86_400_000);
  const steps = Math.floor(daysSinceFirstSend / settings.rampUpStepIntervalDays);
  const cap = settings.rampUpStartingDailyCap * settings.rampUpStepMultiplier ** steps;
  return Math.min(cap, settings.rampUpSteadyStateDailyCap);
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
  emailTemplateVersionId?: string;
}): Promise<void> {
  await DomainSendEvent.create({
    domain: context.domain,
    mailbox: context.mailbox,
    org_id: context.orgId,
    lead_id: context.leadId ?? null,
    enrollment_id: context.enrollmentId ?? null,
    email_template_version_id: context.emailTemplateVersionId ?? null,
    kind: 'sent',
  });
}

/**
 * Records a bounce/complaint/reply outcome for a (domain, mailbox) pair — called live by the
 * mailbox poller (src/services/mailboxPoller.service.ts) as it classifies inbound messages.
 */
export async function recordDeliverabilityEvent(
  domain: string,
  mailbox: string,
  orgId: string,
  kind: Exclude<SendEventKind, 'sent'>,
  context: { leadId?: string; enrollmentId?: string; emailTemplateVersionId?: string } = {},
): Promise<void> {
  await DomainSendEvent.create({
    domain,
    mailbox,
    org_id: orgId,
    lead_id: context.leadId ?? null,
    enrollment_id: context.enrollmentId ?? null,
    email_template_version_id: context.emailTemplateVersionId ?? null,
    kind,
  });
}

/**
 * Pauses one (domain, mailbox) pair and opens a ReviewTask so a human notices — the one
 * significant action SendGuardrail takes autonomously (per CLAUDE.md's human-in-the-loop
 * exception for sending guardrails). Idempotent: calling it again while already paused does
 * nothing, so a string of denied sends against the same breach doesn't spam a ReviewTask per
 * attempt. Deliberately scoped to this one mailbox, not the whole domain: another mailbox
 * sharing the domain keeps sending under its own independently-tracked history.
 */
export async function pauseDomain(domain: string, mailbox: string, orgId: string, reason: string): Promise<void> {
  const existing = await DomainGuardrailState.findOne({ domain, mailbox });
  if (existing?.status === 'paused') return;

  const reviewTask = await ReviewTask.create({
    org_id: orgId,
    kind: 'domain_guardrail',
    domain,
    mailbox,
    status: 'OPEN',
    rejection_reason: reason,
  });

  await DomainGuardrailState.findOneAndUpdate(
    { domain, mailbox },
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

  await sendInternalNotification({
    subject: `[MarkFlow] Mailbox paused: ${mailbox} (${domain})`,
    html:
      `<p>SendGuardrail paused mailbox <strong>${mailbox}</strong> on domain ${domain}.</p>` +
      `<p>Reason: ${reason}</p>` +
      `<p>A ReviewTask (id ${reviewTask._id}) is open — resuming this mailbox requires a template-approver role.</p>`,
  });
}

/**
 * Resumes a paused (domain, mailbox) pair and resolves its ReviewTask. Only a role that could
 * also approve an EmailTemplateVersion may call this — resuming a mailbox SendGuardrail paused
 * for an extreme bounce/complaint rate is at least as consequential as approving template
 * content.
 */
export async function resumeDomain(domain: string, mailbox: string, userId: string, role: Role): Promise<void> {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }

  const state = await DomainGuardrailState.findOne({ domain, mailbox }).lean();
  if (!state || state.status !== 'paused') return;

  await DomainGuardrailState.findOneAndUpdate(
    { domain, mailbox },
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
 *
 * Every check here is scoped to this one (domain, mailbox) pair, never pooled across every
 * mailbox sharing the domain — see DomainSendEvent's index comment. A domain with an established
 * mailbox and a brand-new one enforces two independent ramp-ups and two independent
 * bounce/complaint rates, not one blended average.
 */
export async function canSend(
  domain: string,
  mailbox: string,
  orgId: string,
  options: { requiresWarmup: boolean },
): Promise<GuardrailDecision> {
  const state = await DomainGuardrailState.findOne({ domain, mailbox }).lean();
  if (state?.status === 'paused') {
    return {
      allowed: false,
      action: 'paused',
      reason: state.paused_reason ?? 'Mailbox is paused pending review',
    };
  }

  const settings = await resolveGuardrailSettings(orgId, domain);

  const shortSince = new Date(Date.now() - settings.guardrailShortWindowHours * 60 * 60 * 1000);
  const longSince = new Date(Date.now() - settings.guardrailLongWindowDays * 24 * 60 * 60 * 1000);
  const [shortCounts, longCounts] = await Promise.all([
    windowCounts(domain, mailbox, shortSince),
    windowCounts(domain, mailbox, longSince),
  ]);

  const shortLabel = `${settings.guardrailShortWindowHours}h`;
  const longLabel = `${settings.guardrailLongWindowDays}d`;

  const shortHardStop = rateBreach(
    shortCounts,
    shortLabel,
    settings.hardStopBounceRate,
    settings.hardStopComplaintRate,
    settings.guardrailMinSampleSize,
  );
  const longHardStop = rateBreach(
    longCounts,
    longLabel,
    settings.hardStopBounceRate,
    settings.hardStopComplaintRate,
    settings.guardrailMinSampleSize,
  );
  const hardStop = shortHardStop.breached ? shortHardStop : longHardStop;

  if (hardStop.breached) {
    await pauseDomain(domain, mailbox, orgId, hardStop.reason!);
    return { allowed: false, action: 'paused', reason: hardStop.reason };
  }

  if (!options.requiresWarmup) {
    return { allowed: true, action: 'allowed' };
  }

  const throttled =
    rateBreach(shortCounts, shortLabel, settings.throttleBounceRate, settings.throttleComplaintRate, settings.guardrailMinSampleSize)
      .breached ||
    rateBreach(longCounts, longLabel, settings.throttleBounceRate, settings.throttleComplaintRate, settings.guardrailMinSampleSize)
      .breached;

  const baseCap = await getRampCapForMailbox(domain, mailbox, orgId);
  const dailyCap = throttled ? Math.max(1, Math.floor(baseCap / 2)) : baseCap;
  const sentInWindow = shortCounts.sent;

  if (sentInWindow >= dailyCap) {
    return {
      allowed: false,
      action: 'throttled',
      reason: throttled
        ? `Elevated bounce/complaint rate halved the ramp cap to ${dailyCap}/day; already sent ${sentInWindow} in the last ${shortLabel}`
        : `Ramp-up cap for this mailbox's warmup stage is ${dailyCap}/day; already sent ${sentInWindow} in the last ${shortLabel}`,
      dailyCap,
      sentInWindow,
    };
  }

  return { allowed: true, action: 'allowed', dailyCap, sentInWindow };
}
