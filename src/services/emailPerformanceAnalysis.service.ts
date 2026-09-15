import { THROTTLE_BOUNCE_RATE } from '../constants/sendGuardrail';
import {
  LOW_CLICK_THROUGH_RATE,
  LOW_OPEN_RATE_RELATIVE_THRESHOLD,
  LOW_REPLY_AMONG_CLICKERS_RATE,
  MIN_BASELINE_COMPARABLE_VERSIONS,
  MIN_DENOMINATOR_FOR_SUBRATE,
  MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS,
  type DiagnosisSymptom,
} from '../constants/emailAnalytics';
import { DomainSendEvent } from '../models/DomainSendEvent.model';
import { EmailEngagement } from '../models/EmailEngagement.model';
import { EmailTemplate } from '../models/EmailTemplate.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import { LeadActivity } from '../models/LeadActivity.model';

export interface VersionMetrics {
  sentCount: number;
  bouncedCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bounceRate: number;
  openRate: number;
  /** Of opens, not sends — "did the body/CTA land once they opened it." */
  clickThroughRate: number;
  /** Of clicks, not sends — "did the CTA/timing actually produce a reply." */
  replyRateAmongClickers: number;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Raw engagement metrics for one EmailTemplateVersion, from the live tracking data. */
export async function computeVersionMetrics(versionId: string): Promise<VersionMetrics> {
  const [sentCount, bouncedCount, openedCount, clickedCount, repliedCount] = await Promise.all([
    EmailEngagement.countDocuments({ email_template_version_id: versionId }),
    DomainSendEvent.countDocuments({ email_template_version_id: versionId, kind: 'bounced' }),
    EmailEngagement.countDocuments({ email_template_version_id: versionId, opened: true }),
    EmailEngagement.countDocuments({ email_template_version_id: versionId, clicked: true }),
    LeadActivity.countDocuments({ email_template_version_id: versionId, kind: 'email', direction: 'inbound' }),
  ]);

  return {
    sentCount,
    bouncedCount,
    openedCount,
    clickedCount,
    repliedCount,
    bounceRate: rate(bouncedCount, sentCount),
    openRate: rate(openedCount, sentCount),
    clickThroughRate: rate(clickedCount, openedCount),
    replyRateAmongClickers: rate(repliedCount, clickedCount),
  };
}

export interface OpenRateBaseline {
  averageOpenRate: number;
  comparableVersionCount: number;
}

/**
 * This org's own baseline open rate, from its other live (currently-approved) template
 * versions that individually clear the sample-size floor — excludes the version being
 * diagnosed. Never an absolute threshold: open rate is only ever meaningful relative to how
 * this same org's other sends usually perform (see CLAUDE.md's "must never violate" rule 1).
 * Returns null when there isn't enough comparable history to trust a comparison at all.
 */
export async function computeOpenRateBaseline(
  orgId: string,
  excludeVersionId: string,
): Promise<OpenRateBaseline | null> {
  const templates = await EmailTemplate.find({ org_id: orgId, current_version_id: { $ne: null } })
    .select('current_version_id')
    .lean();

  const candidateVersionIds = templates
    .map((template) => template.current_version_id?.toString())
    .filter((id): id is string => Boolean(id) && id !== excludeVersionId);

  const openRates: number[] = [];
  for (const versionId of candidateVersionIds) {
    const metrics = await computeVersionMetrics(versionId);
    if (metrics.sentCount >= MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS) {
      openRates.push(metrics.openRate);
    }
  }

  if (openRates.length < MIN_BASELINE_COMPARABLE_VERSIONS) return null;

  return {
    averageOpenRate: openRates.reduce((sum, r) => sum + r, 0) / openRates.length,
    comparableVersionCount: openRates.length,
  };
}

export interface SymptomDiagnosis {
  symptom: DiagnosisSymptom;
  reason: string;
  metrics: VersionMetrics;
}

/**
 * Diagnosis-by-symptom, evaluated as a waterfall in delivery-funnel order — sent → not bounced
 * → opened → clicked → replied. Stops at the first symptom found, since a bounce makes every
 * downstream metric meaningless, and so on down the funnel. Returns null when there isn't
 * enough sample size to diagnose anything yet, or when nothing about the funnel looks off.
 */
export async function diagnoseVersion(versionId: string): Promise<SymptomDiagnosis | null> {
  const version = await EmailTemplateVersion.findById(versionId).lean();
  if (!version) return null;

  const metrics = await computeVersionMetrics(versionId);
  if (metrics.sentCount < MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS) return null;

  // 1. Bounce — a deliverability issue, not a content one. SendGuardrail already watches
  // domain-wide bounce rate; this just notices when one specific version is a contributor,
  // which a domain-wide aggregate could otherwise dilute away.
  if (metrics.bounceRate >= THROTTLE_BOUNCE_RATE) {
    return {
      symptom: 'high_bounce_rate',
      reason:
        `Bounce rate ${(metrics.bounceRate * 100).toFixed(1)}% over ${metrics.sentCount} sends ` +
        `(${metrics.bouncedCount} bounced) is a deliverability issue, not a content problem — ` +
        'route to SendGuardrail rather than rewriting this email.',
      metrics,
    };
  }

  // 2. Low opens relative to this org's own baseline — weak signal, treated cautiously: never
  // an absolute threshold, and skipped entirely when there's no trustworthy baseline yet.
  const template = await EmailTemplate.findById(version.email_template_id).lean();
  if (template) {
    const baseline = await computeOpenRateBaseline(template.org_id.toString(), versionId);
    if (baseline && metrics.openRate <= baseline.averageOpenRate * LOW_OPEN_RATE_RELATIVE_THRESHOLD) {
      return {
        symptom: 'low_open_rate',
        reason:
          `Open rate ${(metrics.openRate * 100).toFixed(1)}% is well below this org's baseline of ` +
          `${(baseline.averageOpenRate * 100).toFixed(1)}% (from ${baseline.comparableVersionCount} ` +
          'comparable versions). Opens are a weak signal on their own (Apple Mail Privacy Protection, ' +
          'Gmail image-proxy prefetching) — worth trying a subject-line variant, not a confirmed diagnosis.',
        metrics,
      };
    }
  }

  // 3. Opened but not clicked — the body/CTA isn't landing.
  if (
    metrics.openedCount >= MIN_DENOMINATOR_FOR_SUBRATE &&
    metrics.clickThroughRate <= LOW_CLICK_THROUGH_RATE
  ) {
    return {
      symptom: 'no_click_through',
      reason:
        `Click-through rate ${(metrics.clickThroughRate * 100).toFixed(1)}% of ${metrics.openedCount} ` +
        'opens suggests the body isn\'t landing once people open it.',
      metrics,
    };
  }

  // 4. Clicked but no reply — the CTA is compelling enough to click, but not to respond.
  if (
    metrics.clickedCount >= MIN_DENOMINATOR_FOR_SUBRATE &&
    metrics.replyRateAmongClickers <= LOW_REPLY_AMONG_CLICKERS_RATE
  ) {
    return {
      symptom: 'no_reply_after_click',
      reason:
        `Reply rate ${(metrics.replyRateAmongClickers * 100).toFixed(1)}% of ${metrics.clickedCount} ` +
        'clicks suggests the call-to-action is too aggressive, or the next step\'s timing/channel needs adjusting.',
      metrics,
    };
  }

  return null;
}
