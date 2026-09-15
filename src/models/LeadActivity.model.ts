import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { LEAD_ACTIVITY_DIRECTIONS, LEAD_ACTIVITY_KINDS } from '../constants/leadActivity';

const leadActivitySchema = new Schema(
  {
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    kind: { type: String, enum: LEAD_ACTIVITY_KINDS, required: true },
    // Set once the enrollment engine (Phase 4) exists.
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    workflow_step_index: { type: Number, default: null },
    direction: { type: String, enum: LEAD_ACTIVITY_DIRECTIONS, default: null },
    subject: { type: String, trim: true },
    body_text: { type: String },
    body_html: { type: String },
    // Correlates with an EmailProvider SendResult/InboundMessage id.
    provider_message_id: { type: String, trim: true },
    occurred_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

// Reply drafting reconstructs a lead's thread in chronological order.
leadActivitySchema.index({ lead_id: 1, occurred_at: 1 });

export type LeadActivityDocument = InferSchemaType<typeof leadActivitySchema> & { _id: Types.ObjectId };

export const LeadActivity = model('LeadActivity', leadActivitySchema);
