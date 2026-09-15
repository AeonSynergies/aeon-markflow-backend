import {
  ESTABLISHED_SAMPLE_SIZE_THRESHOLD,
  MIN_ORG_BUCKET_SAMPLE_SIZE,
  MIN_ORGS_FOR_INSIGHT,
  MIN_SAMPLE_SIZE_FOR_INSIGHT,
  type CrossOrgInsightConfidence,
} from '../constants/crossOrgInsight';
import { CrossOrgInsight, type CrossOrgInsightDocument } from '../models/CrossOrgInsight.model';
import { SendTimePerformance } from '../models/SendTimePerformance.model';
import { WorkflowTemplate } from '../models/WorkflowTemplate.model';

function confidenceFor(sampleSize: number): CrossOrgInsightConfidence {
  return sampleSize >= ESTABLISHED_SAMPLE_SIZE_THRESHOLD ? 'established' : 'emerging';
}

interface StructuralGroup {
  workflowType: string | null;
  stepKinds?: string[];
  stepCount?: number;
  orgIds: Set<string>;
  templateCount: number;
}

/**
 * sequence_shape and step_count insights: purely structural, drawn from every org's
 * WorkflowTemplate definitions — never their content, never their send/reply data. Gated by
 * MIN_ORGS_FOR_INSIGHT alone (see that constant's own comment for why templates don't need a
 * separate sample-size floor the way sends do).
 */
async function computeStructuralInsights(): Promise<void> {
  const templates = await WorkflowTemplate.find({}).select('org_id workflow_type steps').lean();

  const shapeGroups = new Map<string, StructuralGroup>();
  const countGroups = new Map<string, StructuralGroup>();

  for (const template of templates) {
    const orgId = template.org_id.toString();
    const workflowType = template.workflow_type ?? null;
    const stepKinds = template.steps.map((step) => step.kind);
    const sequenceKey = stepKinds.join('>');

    const shapeKey = `${workflowType ?? ''}|${sequenceKey}`;
    let shapeGroup = shapeGroups.get(shapeKey);
    if (!shapeGroup) {
      shapeGroup = { workflowType, stepKinds, orgIds: new Set(), templateCount: 0 };
      shapeGroups.set(shapeKey, shapeGroup);
    }
    shapeGroup.orgIds.add(orgId);
    shapeGroup.templateCount += 1;

    const stepCount = template.steps.length;
    const countKey = `${workflowType ?? ''}|${stepCount}`;
    let countGroup = countGroups.get(countKey);
    if (!countGroup) {
      countGroup = { workflowType, stepCount, orgIds: new Set(), templateCount: 0 };
      countGroups.set(countKey, countGroup);
    }
    countGroup.orgIds.add(orgId);
    countGroup.templateCount += 1;
  }

  for (const group of shapeGroups.values()) {
    if (group.orgIds.size < MIN_ORGS_FOR_INSIGHT) continue;
    const sequenceKey = group.stepKinds!.join('>');
    await CrossOrgInsight.findOneAndUpdate(
      {
        insight_type: 'sequence_shape',
        workflow_type: group.workflowType,
        persona: null,
        sequence_key: sequenceKey,
      },
      {
        step_kinds: group.stepKinds,
        org_count: group.orgIds.size,
        sample_size: group.templateCount,
        confidence: confidenceFor(group.templateCount),
        computed_at: new Date(),
      },
      { upsert: true },
    );
  }

  for (const group of countGroups.values()) {
    if (group.orgIds.size < MIN_ORGS_FOR_INSIGHT) continue;
    await CrossOrgInsight.findOneAndUpdate(
      {
        insight_type: 'step_count',
        workflow_type: group.workflowType,
        persona: null,
        step_count: group.stepCount,
      },
      {
        org_count: group.orgIds.size,
        sample_size: group.templateCount,
        confidence: confidenceFor(group.templateCount),
        computed_at: new Date(),
      },
      { upsert: true },
    );
  }
}

interface SendTimeGroup {
  workflowType: string | null;
  persona: string | null;
  dayOfWeek: number;
  hourBucket: number;
  timezoneBucket: string;
  orgIds: Set<string>;
  totalSent: number;
  weightedReplySum: number;
  weightedMeetingSum: number;
}

/**
 * send_time_window insights: pooled from every org's own qualifying SendTimePerformance
 * buckets (Phase 7) — never one org's own bucket surfaced alone. Reply/meeting rates are
 * sample-size-weighted across the qualifying orgs, not a flat per-org average, so a
 * higher-volume org's bucket counts proportionally more.
 */
async function computeSendTimeWindowInsights(): Promise<void> {
  const buckets = await SendTimePerformance.find({ sample_size: { $gte: MIN_ORG_BUCKET_SAMPLE_SIZE } }).lean();

  const groups = new Map<string, SendTimeGroup>();
  for (const bucket of buckets) {
    const key = [
      bucket.workflow_type ?? '',
      bucket.persona ?? '',
      bucket.day_of_week,
      bucket.hour_bucket,
      bucket.timezone_bucket,
    ].join('|');

    let group = groups.get(key);
    if (!group) {
      group = {
        workflowType: bucket.workflow_type ?? null,
        persona: bucket.persona ?? null,
        dayOfWeek: bucket.day_of_week,
        hourBucket: bucket.hour_bucket,
        timezoneBucket: bucket.timezone_bucket,
        orgIds: new Set(),
        totalSent: 0,
        weightedReplySum: 0,
        weightedMeetingSum: 0,
      };
      groups.set(key, group);
    }

    group.orgIds.add(bucket.org_id.toString());
    group.totalSent += bucket.sample_size;
    group.weightedReplySum += bucket.reply_rate * bucket.sample_size;
    group.weightedMeetingSum += bucket.meeting_rate * bucket.sample_size;
  }

  for (const group of groups.values()) {
    if (group.orgIds.size < MIN_ORGS_FOR_INSIGHT) continue;
    if (group.totalSent < MIN_SAMPLE_SIZE_FOR_INSIGHT) continue;

    await CrossOrgInsight.findOneAndUpdate(
      {
        insight_type: 'send_time_window',
        workflow_type: group.workflowType,
        persona: group.persona,
        day_of_week: group.dayOfWeek,
        hour_bucket: group.hourBucket,
        timezone_bucket: group.timezoneBucket,
      },
      {
        avg_reply_rate: group.weightedReplySum / group.totalSent,
        avg_meeting_rate: group.weightedMeetingSum / group.totalSent,
        org_count: group.orgIds.size,
        sample_size: group.totalSent,
        confidence: confidenceFor(group.totalSent),
        computed_at: new Date(),
      },
      { upsert: true },
    );
  }
}

/**
 * The scheduled Phase 8 cross-org cycle: recomputes every CrossOrgInsight from every org's
 * WorkflowTemplate/SendTimePerformance data. Scheduled weekly by crossOrgInsightQueue.ts, also
 * callable on demand.
 */
export async function computeCrossOrgInsights(): Promise<void> {
  await computeStructuralInsights();
  await computeSendTimeWindowInsights();
}

export interface GenericCrossOrgInsight {
  insightType: string;
  workflowType: string | null;
  persona: string | null;
  stepKinds?: string[];
  stepCount?: number;
  dayOfWeek?: number;
  hourBucket?: number;
  timezoneBucket?: string;
  confidence: string;
}

function toGenericInsight(doc: CrossOrgInsightDocument): GenericCrossOrgInsight {
  return {
    insightType: doc.insight_type,
    workflowType: doc.workflow_type ?? null,
    persona: doc.persona ?? null,
    stepKinds: doc.step_kinds ?? undefined,
    stepCount: doc.step_count ?? undefined,
    dayOfWeek: doc.day_of_week ?? undefined,
    hourBucket: doc.hour_bucket ?? undefined,
    timezoneBucket: doc.timezone_bucket ?? undefined,
    confidence: doc.confidence,
  };
}

/**
 * The workflow-builder-facing view: generic recommendations only. Deliberately omits
 * org_count/sample_size/avg_reply_rate/avg_meeting_rate — see listRawCrossOrgInsights for those.
 */
export async function listGenericCrossOrgInsights(): Promise<GenericCrossOrgInsight[]> {
  const docs = await CrossOrgInsight.find({}).lean();
  return docs.map((doc) => toGenericInsight(doc as unknown as CrossOrgInsightDocument));
}

/** The Admin/Super-Admin-only view: every field, including the pooled-but-real numbers. Role
 * gating happens at the route layer (ADMIN_ONLY_ROLES), matching every other read-only list here. */
export async function listRawCrossOrgInsights(): Promise<CrossOrgInsightDocument[]> {
  return CrossOrgInsight.find({}).lean();
}
