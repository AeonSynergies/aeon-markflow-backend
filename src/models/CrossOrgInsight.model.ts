import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { CROSS_ORG_INSIGHT_CONFIDENCE_LEVELS, CROSS_ORG_INSIGHT_TYPES } from '../constants/crossOrgInsight';

/**
 * An abstracted structural/timing pattern observed across multiple orgs — never one org's raw
 * content or org-specific metrics. `org_count`/`sample_size`/`avg_reply_rate`/`avg_meeting_rate`
 * are pooled across every qualifying org, never attributable to a single one, and a document is
 * only ever created once a pattern clears MIN_ORGS_FOR_INSIGHT distinct orgs — see
 * crossOrgInsight.service.ts's computeCrossOrgInsights. `confidence` is a coarse, non-numeric
 * label; it's what the generic (workflow-builder) view shows, while `org_count`/`sample_size`/
 * the avg_* rates are reserved for the raw, Admin/Super-Admin-only view (see the routes).
 *
 * Field usage varies by insight_type:
 *  - sequence_shape: step_kinds + workflow_type. No avg_*_rate (structural prevalence, not
 *    performance).
 *  - step_count: step_count + workflow_type. No avg_*_rate either.
 *  - send_time_window: day_of_week/hour_bucket/timezone_bucket + workflow_type/persona, with
 *    avg_reply_rate/avg_meeting_rate pooled from each qualifying org's own SendTimePerformance
 *    bucket (Phase 7).
 */
const crossOrgInsightSchema = new Schema(
  {
    insight_type: { type: String, enum: CROSS_ORG_INSIGHT_TYPES, required: true },
    workflow_type: { type: String, trim: true, default: null },
    persona: { type: String, trim: true, default: null },

    // sequence_shape — step_kinds is the human-readable form; sequence_key is the same list
    // joined with '>' (e.g. "email>wait>call_task>email"), used as the actual dedupe/upsert key
    // below, since a multikey index on the array itself can't express "these exact elements in
    // this exact order" as a uniqueness constraint.
    step_kinds: { type: [String], default: undefined },
    sequence_key: { type: String, default: undefined },
    // step_count
    step_count: { type: Number, default: undefined },
    // send_time_window
    day_of_week: { type: Number, min: 0, max: 6, default: undefined },
    hour_bucket: { type: Number, min: 0, max: 23, default: undefined },
    timezone_bucket: { type: String, trim: true, default: undefined },
    avg_reply_rate: { type: Number, min: 0, max: 1, default: undefined },
    avg_meeting_rate: { type: Number, min: 0, max: 1, default: undefined },

    // Pooled across every qualifying org — raw view only, never a single org's own numbers.
    org_count: { type: Number, required: true, min: 0 },
    sample_size: { type: Number, required: true, min: 0 },
    confidence: { type: String, enum: CROSS_ORG_INSIGHT_CONFIDENCE_LEVELS, required: true },
    computed_at: { type: Date, required: true },
  },
  { timestamps: true },
);

// One document per distinct pattern within an insight_type — a recompute upserts by this key.
// sequence_key (not step_kinds itself — see its own comment) covers sequence_shape; step_count
// covers step_count; day_of_week/hour_bucket/timezone_bucket cover send_time_window.
crossOrgInsightSchema.index(
  {
    insight_type: 1,
    workflow_type: 1,
    persona: 1,
    sequence_key: 1,
    step_count: 1,
    day_of_week: 1,
    hour_bucket: 1,
    timezone_bucket: 1,
  },
  { unique: true },
);

export type CrossOrgInsightDocument = InferSchemaType<typeof crossOrgInsightSchema> & { _id: Types.ObjectId };

export const CrossOrgInsight = model('CrossOrgInsight', crossOrgInsightSchema);
