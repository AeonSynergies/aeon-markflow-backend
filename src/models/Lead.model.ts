import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { LEAD_STATUSES, EMAIL_DELIVERABILITY_STATUSES } from '../constants/lead';

const leadSchema = new Schema(
  {
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    status: { type: String, enum: LEAD_STATUSES, required: true, default: 'NEW-COLD' },
    email_deliverability: {
      type: String,
      enum: EMAIL_DELIVERABILITY_STATUSES,
      default: 'GOOD',
    },
    phone_dnd_status: { type: Boolean, default: false },
    // Set when this lead was recycled back from a lost Deal in Onboard (Lost+Recycle event).
    // Deal lives in Onboard's own database, so this is an opaque cross-service id, not a ref.
    recycled_from_deal_id: { type: Schema.Types.ObjectId, default: null },
    lost_reason: { type: String, trim: true },
    lost_stage: { type: String, trim: true },
    eligible_for_reengagement_at: { type: Date },
    // Set when status becomes DISCOVERY_RETRY (leadRecycle.service.ts's recycleLead), cleared
    // once it leaves that status — this, not updatedAt (which changes on any field edit), is
    // what discoveryRetryQueue's daily sweep checks against DISCOVERY_RETRY_GRADUATION_DAYS.
    discovery_retry_started_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// A Lead is exactly one per (Contact, Organization) pair.
leadSchema.index({ contact_id: 1, org_id: 1 }, { unique: true });
// Every list/filter query in the app is scoped to an org first.
leadSchema.index({ org_id: 1, status: 1 });

export type LeadDocument = InferSchemaType<typeof leadSchema> & { _id: Types.ObjectId };

export const Lead = model('Lead', leadSchema);
