import type { Role } from '../constants/access';
import { TEMPLATE_APPROVER_ROLES } from '../constants/emailTemplate';
import {
  MIN_CANDIDATE_BUCKETS_BEFORE_RECOMMENDING,
  MIN_SAMPLE_SIZE_FOR_SEND_TIME_BUCKET,
  SEND_TIME_IMPROVEMENT_MARGIN,
} from '../constants/sendTimeOptimization';
import { Organization } from '../models/Organization.model';
import { ReviewTask } from '../models/ReviewTask.model';
import { SendTimePerformance, type SendTimePerformanceDocument } from '../models/SendTimePerformance.model';
import { SendTimeRecommendation, type SendTimeRecommendationDocument } from '../models/SendTimeRecommendation.model';
import { UnauthorizedApproverRoleError } from './emailTemplateVersion.service';
import { sendInternalNotification } from './internalNotification.service';
import { computeSendTimeRollups } from './sendTimePerformance.service';

export class SendTimeRecommendationNotFoundError extends Error {
  constructor(id: string) {
    super(`SendTimeRecommendation ${id} not found`);
    this.name = 'SendTimeRecommendationNotFoundError';
  }
}

export class InvalidSendTimeRecommendationTransitionError extends Error {
  constructor(id: string, status: string) {
    super(`SendTimeRecommendation ${id} is not OPEN (status: ${status}) — it may already have been decided`);
    this.name = 'InvalidSendTimeRecommendationTransitionError';
  }
}

/** The currently-active (day/hour/timezone, content) pairing for one (org, workflow_type, persona)
 * group, if any — the only thing enrollmentProcessor.ts ever reads from this whole pipeline. */
export async function getActiveSendTimeRecommendation(
  orgId: string,
  workflowType: string | null,
  persona: string | null,
): Promise<SendTimeRecommendationDocument | null> {
  return SendTimeRecommendation.findOne({
    org_id: orgId,
    workflow_type: workflowType,
    persona,
    status: 'APPROVED',
  }).lean();
}

async function supersedePriorApproved(
  orgId: string,
  workflowType: string | null,
  persona: string | null,
  excludeId: string,
): Promise<void> {
  await SendTimeRecommendation.updateMany(
    { org_id: orgId, workflow_type: workflowType, persona, status: 'APPROVED', _id: { $ne: excludeId } },
    { status: 'SUPERSEDED' },
  );
}

interface GroupKey {
  orgId: string;
  workflowType: string | null;
  persona: string | null;
}

function groupKeyString(group: GroupKey): string {
  return `${group.orgId}|${group.workflowType ?? ''}|${group.persona ?? ''}`;
}

function pickBestBucket(buckets: SendTimePerformanceDocument[]): SendTimePerformanceDocument {
  return buckets.reduce((best, bucket) => {
    if (bucket.reply_rate > best.reply_rate) return bucket;
    if (bucket.reply_rate === best.reply_rate && bucket.meeting_rate > best.meeting_rate) return bucket;
    return best;
  });
}

/** Relative improvement of `candidate` over `current` — treated as unbounded improvement when
 * `current` is 0, since any relative-percentage comparison against zero is undefined. */
function relativeImprovement(candidate: number, current: number): number {
  if (current <= 0) return candidate > 0 ? Infinity : 0;
  return (candidate - current) / current;
}

function describeBucket(bucket: SendTimePerformanceDocument): string {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    `${DAY_NAMES[bucket.day_of_week]} ${bucket.hour_bucket}:00 (${bucket.timezone_bucket}) with content ` +
    `variant ${bucket.content_variant_id.toString()}: reply rate ${(bucket.reply_rate * 100).toFixed(1)}%, ` +
    `meeting rate ${(bucket.meeting_rate * 100).toFixed(1)}%, over ${bucket.sample_size} sends`
  );
}

async function evaluateGroup(group: GroupKey, strategy: 'ai_suggested' | 'ai_automatic'): Promise<boolean> {
  const buckets = await SendTimePerformance.find({
    org_id: group.orgId,
    workflow_type: group.workflowType,
    persona: group.persona,
    sample_size: { $gte: MIN_SAMPLE_SIZE_FOR_SEND_TIME_BUCKET },
  }).lean();
  if (buckets.length < MIN_CANDIDATE_BUCKETS_BEFORE_RECOMMENDING) return false;

  const best = pickBestBucket(buckets);
  const current = await getActiveSendTimeRecommendation(group.orgId, group.workflowType, group.persona);

  if (current) {
    const sameBucket =
      current.day_of_week === best.day_of_week &&
      current.hour_bucket === best.hour_bucket &&
      current.timezone_bucket === best.timezone_bucket &&
      current.content_variant_id.toString() === best.content_variant_id.toString();
    if (sameBucket) return false;

    const improvement = relativeImprovement(best.reply_rate, current.metrics.reply_rate);
    if (improvement < SEND_TIME_IMPROVEMENT_MARGIN) return false;
  }

  const alreadyPending = await SendTimeRecommendation.findOne({
    org_id: group.orgId,
    workflow_type: group.workflowType,
    persona: group.persona,
    status: 'OPEN',
  }).lean();
  if (alreadyPending) return false;

  const reason = current
    ? `Found a better-performing send-time/content combination than the current one: ${describeBucket(best)}.`
    : `First trustworthy send-time/content combination for this group: ${describeBucket(best)}.`;

  const metrics = {
    sent_count: best.sent_count,
    reply_rate: best.reply_rate,
    meeting_rate: best.meeting_rate,
    sample_size: best.sample_size,
  };

  if (strategy === 'ai_automatic') {
    const recommendation = await SendTimeRecommendation.create({
      org_id: group.orgId,
      workflow_type: group.workflowType,
      persona: group.persona,
      day_of_week: best.day_of_week,
      hour_bucket: best.hour_bucket,
      timezone_bucket: best.timezone_bucket,
      content_variant_id: best.content_variant_id,
      metrics,
      reason,
      generation_source: 'ai_automatic',
      status: 'APPROVED',
      reviewed_at: new Date(),
    });
    await supersedePriorApproved(group.orgId, group.workflowType, group.persona, recommendation._id.toString());
    await sendInternalNotification({
      subject: '[MarkFlow] Send-time optimization applied automatically',
      html: `<p>Applied a new send-time/content combination automatically (ai_automatic).</p><p>${reason}</p>`,
    });
    return true;
  }

  const recommendation = await SendTimeRecommendation.create({
    org_id: group.orgId,
    workflow_type: group.workflowType,
    persona: group.persona,
    day_of_week: best.day_of_week,
    hour_bucket: best.hour_bucket,
    timezone_bucket: best.timezone_bucket,
    content_variant_id: best.content_variant_id,
    metrics,
    reason,
    generation_source: 'ai_suggested',
    status: 'OPEN',
  });
  await ReviewTask.create({
    org_id: group.orgId,
    kind: 'send_time_recommendation',
    send_time_recommendation_id: recommendation._id,
    status: 'OPEN',
  });
  await sendInternalNotification({
    subject: '[MarkFlow] New send-time recommendation pending review',
    html: `<p>A new send-time/content combination is pending approval (ai_suggested).</p><p>${reason}</p>`,
  });
  return true;
}

export interface SendTimeOptimizationSummary {
  rollup: { engagementsScanned: number; bucketsUpserted: number };
  groupsEvaluated: number;
  recommendationsCreated: number;
}

/**
 * The scheduled Phase 7 cycle: recompute the rolling SendTimePerformance rollups, then evaluate
 * every (org, workflow_type, persona) group belonging to an org whose send_time_strategy isn't
 * 'manual'. Mirrors Phase 6's runEmailPerformanceAnalysis shape — one function, scheduled by
 * sendTimePerformanceQueue.ts, also callable on demand.
 */
export async function runSendTimeOptimization(): Promise<SendTimeOptimizationSummary> {
  const rollup = await computeSendTimeRollups();

  const orgs = await Organization.find({ send_time_strategy: { $ne: 'manual' } })
    .select('send_time_strategy')
    .lean();

  let groupsEvaluated = 0;
  let recommendationsCreated = 0;

  for (const org of orgs) {
    const orgId = org._id.toString();
    const strategy = org.send_time_strategy as 'ai_suggested' | 'ai_automatic';

    const buckets = await SendTimePerformance.find({ org_id: orgId }).select('workflow_type persona').lean();
    const groups = new Map<string, GroupKey>();
    for (const bucket of buckets) {
      const group: GroupKey = { orgId, workflowType: bucket.workflow_type ?? null, persona: bucket.persona ?? null };
      groups.set(groupKeyString(group), group);
    }

    for (const group of groups.values()) {
      groupsEvaluated += 1;
      const created = await evaluateGroup(group, strategy);
      if (created) recommendationsCreated += 1;
    }
  }

  return { rollup, groupsEvaluated, recommendationsCreated };
}

/** Approves an OPEN recommendation, making it the active one for its group and superseding
 * whichever recommendation was previously active. Same approver bar as an EmailTemplateVersion. */
export async function approveSendTimeRecommendation(
  recommendationId: string,
  userId: string,
  role: Role,
): Promise<SendTimeRecommendationDocument> {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }

  const existing = await SendTimeRecommendation.findById(recommendationId).lean();
  if (!existing) throw new SendTimeRecommendationNotFoundError(recommendationId);
  if (existing.status !== 'OPEN') {
    throw new InvalidSendTimeRecommendationTransitionError(recommendationId, existing.status);
  }

  const recommendation = await SendTimeRecommendation.findByIdAndUpdate(
    recommendationId,
    { status: 'APPROVED', reviewed_by: userId, reviewed_at: new Date() },
    { new: true },
  );

  await supersedePriorApproved(
    existing.org_id.toString(),
    existing.workflow_type ?? null,
    existing.persona ?? null,
    recommendationId,
  );

  await ReviewTask.findOneAndUpdate(
    { send_time_recommendation_id: recommendationId, status: 'OPEN' },
    { status: 'APPROVED', reviewed_by: userId, reviewed_at: new Date() },
  );

  return recommendation!;
}

/** Rejects an OPEN recommendation. Same approver bar as an EmailTemplateVersion. */
export async function rejectSendTimeRecommendation(
  recommendationId: string,
  userId: string,
  role: Role,
): Promise<SendTimeRecommendationDocument> {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }

  const existing = await SendTimeRecommendation.findById(recommendationId).lean();
  if (!existing) throw new SendTimeRecommendationNotFoundError(recommendationId);
  if (existing.status !== 'OPEN') {
    throw new InvalidSendTimeRecommendationTransitionError(recommendationId, existing.status);
  }

  const recommendation = await SendTimeRecommendation.findByIdAndUpdate(
    recommendationId,
    { status: 'REJECTED', reviewed_by: userId, reviewed_at: new Date() },
    { new: true },
  );

  await ReviewTask.findOneAndUpdate(
    { send_time_recommendation_id: recommendationId, status: 'OPEN' },
    { status: 'REJECTED', reviewed_by: userId, reviewed_at: new Date() },
  );

  return recommendation!;
}
