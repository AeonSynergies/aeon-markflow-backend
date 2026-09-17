import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * One row per (org, workflow_type, persona, day_of_week, hour_bucket, timezone_bucket,
 * content_variant) bucket — recomputed on a rolling basis (see sendTimePerformance.service.ts's
 * computeSendTimeRollups, scheduled by sendTimePerformanceQueue.ts), not written incrementally
 * per send. Each recompute upserts every bucket it finds over the rolling lookback window, so a
 * bucket's numbers always reflect that recent window, not all-time history.
 *
 * reply_rate/meeting_rate — never open_rate, per CLAUDE.md's "must never violate" rule 1. Opens
 * stay Phase 6's diagnosis-only signal; send-time optimization only ever acts on reply/meeting
 * outcomes.
 */
const sendTimePerformanceSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    workflow_type: { type: String, trim: true, default: null },
    persona: { type: String, trim: true, default: null },
    day_of_week: { type: Number, required: true, min: 0, max: 6 },
    hour_bucket: { type: Number, required: true, min: 0, max: 23 },
    timezone_bucket: { type: String, required: true, trim: true },
    content_variant_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', required: true },
    sent_count: { type: Number, required: true, min: 0, default: 0 },
    reply_rate: { type: Number, required: true, min: 0, max: 1, default: 0 },
    meeting_rate: { type: Number, required: true, min: 0, max: 1, default: 0 },
    // Equal to sent_count at this granularity today — kept as its own field (per CLAUDE.md's
    // schema) since it's conceptually "how much data backs this rate," not "how much volume this
    // bucket sent," in case those two ever diverge.
    sample_size: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

// One document per bucket — a recompute upserts by this key rather than accumulating duplicates.
sendTimePerformanceSchema.index(
  { org_id: 1, workflow_type: 1, persona: 1, day_of_week: 1, hour_bucket: 1, timezone_bucket: 1, content_variant_id: 1 },
  { unique: true },
);
// The recommendation pipeline's lookup: every qualifying bucket for one (org, workflow_type, persona) group.
sendTimePerformanceSchema.index({ org_id: 1, workflow_type: 1, persona: 1 });

export type SendTimePerformanceDocument = InferSchemaType<typeof sendTimePerformanceSchema> & { _id: Types.ObjectId };

export const SendTimePerformance = model('SendTimePerformance', sendTimePerformanceSchema);
