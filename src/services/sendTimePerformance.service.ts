import { SEND_TIME_ROLLUP_LOOKBACK_DAYS } from '../constants/sendTimeOptimization';
import { EmailEngagement } from '../models/EmailEngagement.model';
import { LeadActivity } from '../models/LeadActivity.model';
import { SendTimePerformance } from '../models/SendTimePerformance.model';

interface EngagementRow {
  org_id: { toString(): string };
  enrollment_id?: { toString(): string } | null;
  email_template_version_id: { toString(): string };
  workflow_type?: string | null;
  persona?: string | null;
  day_of_week?: number | null;
  hour_bucket?: number | null;
  timezone_bucket?: string | null;
  sent_at: Date;
}

interface BucketAccumulator {
  orgId: string;
  workflowType: string | null;
  persona: string | null;
  dayOfWeek: number;
  hourBucket: number;
  timezoneBucket: string;
  contentVariantId: string;
  sentCount: number;
  repliedCount: number;
  meetingCount: number;
}

function bucketKey(row: EngagementRow): string {
  return [
    row.org_id.toString(),
    row.workflow_type ?? '',
    row.persona ?? '',
    row.day_of_week,
    row.hour_bucket,
    row.timezone_bucket,
    row.email_template_version_id.toString(),
  ].join('|');
}

/**
 * Which engagements got a reply attributable to them: a reply threads to a specific
 * EmailTemplateVersion (mailboxPoller correlation already denormalizes that onto the inbound
 * LeadActivity — see emailPerformanceAnalysis.service.ts's own reply counting), and an enrollment
 * only ever sends a given version once, so (enrollment_id, email_template_version_id) uniquely
 * identifies which send a reply answers.
 */
async function findRepliedKeys(enrollmentIds: string[], versionIds: string[]): Promise<Set<string>> {
  if (enrollmentIds.length === 0 || versionIds.length === 0) return new Set();

  const replies = await LeadActivity.find({
    kind: 'email',
    direction: 'inbound',
    enrollment_id: { $in: enrollmentIds },
    email_template_version_id: { $in: versionIds },
  })
    .select('enrollment_id email_template_version_id')
    .lean();

  return new Set(replies.map((reply) => `${reply.enrollment_id!.toString()}:${reply.email_template_version_id!.toString()}`));
}

/**
 * Which engagements a meeting-booked LeadActivity attributes to, one meeting at a time: a
 * meeting isn't tied to one specific message the way a reply is, so it's attributed to the most
 * recent prior send within its own enrollment (last-touch) — a documented simplification, not
 * multi-touch attribution. Returns a set of `${enrollment_id}:${email_template_version_id}` keys,
 * matching findRepliedKeys's shape, one entry per engagement that was some meeting's last touch.
 */
async function findMeetingAttributedKeys(enrollmentIds: string[], rows: EngagementRow[]): Promise<Set<string>> {
  if (enrollmentIds.length === 0) return new Set();

  const meetings = await LeadActivity.find({ kind: 'meeting', enrollment_id: { $in: enrollmentIds } })
    .select('enrollment_id occurred_at')
    .lean();
  if (meetings.length === 0) return new Set();

  const rowsByEnrollment = new Map<string, EngagementRow[]>();
  for (const row of rows) {
    if (!row.enrollment_id) continue;
    const key = row.enrollment_id.toString();
    if (!rowsByEnrollment.has(key)) rowsByEnrollment.set(key, []);
    rowsByEnrollment.get(key)!.push(row);
  }

  const attributed = new Set<string>();
  for (const meeting of meetings) {
    const enrollmentId = meeting.enrollment_id?.toString();
    if (!enrollmentId) continue;

    const candidates = (rowsByEnrollment.get(enrollmentId) ?? []).filter(
      (row) => row.sent_at.getTime() <= meeting.occurred_at.getTime(),
    );
    if (candidates.length === 0) continue;

    const lastTouch = candidates.reduce((latest, row) => (row.sent_at > latest.sent_at ? row : latest));
    attributed.add(`${enrollmentId}:${lastTouch.email_template_version_id.toString()}`);
  }

  return attributed;
}

export interface SendTimeRollupSummary {
  engagementsScanned: number;
  bucketsUpserted: number;
}

/**
 * Recomputes every SendTimePerformance bucket from the last SEND_TIME_ROLLUP_LOOKBACK_DAYS of
 * EmailEngagement rows. Rolling, not incremental: each run replaces every bucket it touches with
 * fresh numbers over the current window, so a bucket's rates always reflect recent behavior, not
 * an ever-growing all-time average. Scheduled via sendTimePerformanceQueue.ts; also callable on
 * demand.
 */
export async function computeSendTimeRollups(): Promise<SendTimeRollupSummary> {
  const since = new Date(Date.now() - SEND_TIME_ROLLUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const allRows = (await EmailEngagement.find({ sent_at: { $gte: since } }).lean()) as unknown as EngagementRow[];
  // Bucket keys require a real day/hour/timezone — rows sent before this field existed (or any
  // future row created without them) can't be bucketed and are skipped rather than guessed at.
  const rows = allRows.filter(
    (row) => row.day_of_week !== null && row.day_of_week !== undefined && row.hour_bucket !== null && row.hour_bucket !== undefined && row.timezone_bucket,
  );

  const enrollmentIds = [...new Set(rows.map((row) => row.enrollment_id?.toString()).filter((id): id is string => Boolean(id)))];
  const versionIds = [...new Set(rows.map((row) => row.email_template_version_id.toString()))];

  const [repliedKeys, meetingKeys] = await Promise.all([
    findRepliedKeys(enrollmentIds, versionIds),
    findMeetingAttributedKeys(enrollmentIds, rows),
  ]);

  const buckets = new Map<string, BucketAccumulator>();
  for (const row of rows) {
    const key = bucketKey(row);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        orgId: row.org_id.toString(),
        workflowType: row.workflow_type ?? null,
        persona: row.persona ?? null,
        dayOfWeek: row.day_of_week!,
        hourBucket: row.hour_bucket!,
        timezoneBucket: row.timezone_bucket!,
        contentVariantId: row.email_template_version_id.toString(),
        sentCount: 0,
        repliedCount: 0,
        meetingCount: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.sentCount += 1;
    const attributionKey = row.enrollment_id ? `${row.enrollment_id.toString()}:${row.email_template_version_id.toString()}` : null;
    if (attributionKey && repliedKeys.has(attributionKey)) bucket.repliedCount += 1;
    if (attributionKey && meetingKeys.has(attributionKey)) bucket.meetingCount += 1;
  }

  for (const bucket of buckets.values()) {
    await SendTimePerformance.findOneAndUpdate(
      {
        org_id: bucket.orgId,
        workflow_type: bucket.workflowType,
        persona: bucket.persona,
        day_of_week: bucket.dayOfWeek,
        hour_bucket: bucket.hourBucket,
        timezone_bucket: bucket.timezoneBucket,
        content_variant_id: bucket.contentVariantId,
      },
      {
        sent_count: bucket.sentCount,
        reply_rate: bucket.repliedCount / bucket.sentCount,
        meeting_rate: bucket.meetingCount / bucket.sentCount,
        sample_size: bucket.sentCount,
      },
      { upsert: true },
    );
  }

  return { engagementsScanned: rows.length, bucketsUpserted: buckets.size };
}
