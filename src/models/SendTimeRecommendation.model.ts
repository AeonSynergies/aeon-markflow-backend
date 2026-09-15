import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  SEND_TIME_RECOMMENDATION_SOURCES,
  SEND_TIME_RECOMMENDATION_STATUSES,
} from '../constants/sendTimeOptimization';

const metricsSnapshotSchema = new Schema(
  {
    sent_count: { type: Number, required: true },
    reply_rate: { type: Number, required: true },
    meeting_rate: { type: Number, required: true },
    sample_size: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * A proposed (or already-applied) (day_of_week, hour_bucket, timezone_bucket, content_variant)
 * pairing for one (org, workflow_type, persona) group — the "existing ReviewTask/PENDING_APPROVAL-
 * style gate" CLAUDE.md's build order calls for. `ai_suggested` creates one with status OPEN plus
 * a ReviewTask; `ai_automatic` creates one already APPROVED, with no ReviewTask, since per Phase
 * 7's spec it schedules within a validated window without per-send approval. Either way,
 * enrollmentProcessor.ts only ever reads the currently APPROVED row for its group — see
 * sendTimeOptimization.service.ts's getActiveSendTimeRecommendation.
 */
const sendTimeRecommendationSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    workflow_type: { type: String, trim: true, default: null },
    persona: { type: String, trim: true, default: null },
    day_of_week: { type: Number, required: true, min: 0, max: 6 },
    hour_bucket: { type: Number, required: true, min: 0, max: 23 },
    timezone_bucket: { type: String, required: true, trim: true },
    content_variant_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', required: true },
    metrics: { type: metricsSnapshotSchema, required: true },
    // Free-text justification, mirroring EmailTemplateVersion.ai_generation_metadata.reason —
    // states the metrics behind the pick, for the ReviewTask/audit trail.
    reason: { type: String, required: true, trim: true },
    generation_source: { type: String, enum: SEND_TIME_RECOMMENDATION_SOURCES, required: true },
    status: { type: String, enum: SEND_TIME_RECOMMENDATION_STATUSES, default: 'OPEN', required: true },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// At most one OPEN (pending) suggestion per group at a time — same dedupe purpose as Phase 6's
// hasOutstandingSuggestion, enforced at the schema level here instead. Deliberately does NOT
// also constrain APPROVED: the previously-approved row for a group stays APPROVED (still the
// active one enrollmentProcessor.ts reads) right up until the new OPEN one is itself approved,
// at which point approveSendTimeRecommendation flips the old one to SUPERSEDED.
sendTimeRecommendationSchema.index(
  { org_id: 1, workflow_type: 1, persona: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } },
);
// enrollmentProcessor.ts's read path: the active recommendation for one group.
sendTimeRecommendationSchema.index({ org_id: 1, workflow_type: 1, persona: 1, status: 1 });

export type SendTimeRecommendationDocument = InferSchemaType<typeof sendTimeRecommendationSchema> & {
  _id: Types.ObjectId;
};

export const SendTimeRecommendation = model('SendTimeRecommendation', sendTimeRecommendationSchema);
