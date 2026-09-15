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

    // Denormalized at send time (from the enrollment's own snapshot and the template's persona)
    // so send-time performance rollups (Phase 7, sendTimePerformance.service.ts) can aggregate
    // straight off this collection without joining Enrollment/EmailTemplate per row.
    workflow_type: { type: String, trim: true, default: null },
    persona: { type: String, trim: true, default: null },
    // Recipient-local day-of-week (0=Sun..6=Sat) / hour (0-23) at the moment this was sent,
    // resolved via the lead's Contact.timezone (falls back to UTC when unknown) — see
    // src/utils/timezone.ts. Never the server's own timezone.
    day_of_week: { type: Number, min: 0, max: 6, default: null },
    hour_bucket: { type: Number, min: 0, max: 23, default: null },
    timezone_bucket: { type: String, default: null },

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
// The send-time rollup's window query (sendTimePerformance.service.ts).
emailEngagementSchema.index({ sent_at: 1 });

export type EmailEngagementDocument = InferSchemaType<typeof emailEngagementSchema> & { _id: Types.ObjectId };

export const EmailEngagement = model('EmailEngagement', emailEngagementSchema);
