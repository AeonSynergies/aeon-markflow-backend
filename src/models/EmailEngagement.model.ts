import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * One row per outbound email send, updated in place as engagement signals come in — the open
 * pixel (src/routes/tracking.routes.ts's `/o/:token`, token = this document's _id) and the
 * click redirect (`/r/:token`, via linkTracking.service's recordClick). Every rate the
 * diagnosis-by-symptom logic computes (src/services/emailPerformanceAnalysis.service.ts) shares
 * this same per-send denominator, so open/click/reply rates are always comparable to each other.
 *
 * Open tracking is a 1x1 pixel — the same well-known unreliability applies as to any ESP's open
 * tracking (Apple Mail Privacy Protection and Gmail's image-proxy prefetching both cause
 * false-positive "opens" that never happened). Never used as "response rate" anywhere — see
 * CLAUDE.md's "must never violate" rule 1. Click tracking (already used for link redirects) is
 * far more reliable: a click is a real, deliberate action.
 */
const emailEngagementSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    email_template_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', required: true },
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    workflow_step_index: { type: Number, default: null },
    sent_at: { type: Date, required: true },

    opened: { type: Boolean, default: false },
    open_count: { type: Number, default: 0, min: 0 },
    first_opened_at: { type: Date, default: null },
    last_opened_at: { type: Date, default: null },

    clicked: { type: Boolean, default: false },
    click_count: { type: Number, default: 0, min: 0 },
    first_clicked_at: { type: Date, default: null },
    last_clicked_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// The diagnosis pipeline's primary aggregation: rates for one version.
emailEngagementSchema.index({ email_template_version_id: 1, opened: 1 });
emailEngagementSchema.index({ email_template_version_id: 1, clicked: 1 });
// The click redirect's lookup: which send does this (lead, version) click belong to.
emailEngagementSchema.index({ lead_id: 1, email_template_version_id: 1 });

export type EmailEngagementDocument = InferSchemaType<typeof emailEngagementSchema> & { _id: Types.ObjectId };

export const EmailEngagement = model('EmailEngagement', emailEngagementSchema);
