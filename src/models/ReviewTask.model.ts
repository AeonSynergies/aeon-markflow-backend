import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { REVIEW_TASK_STATUSES } from '../constants/emailTemplate';

const reviewTaskSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    // Only kind of review task so far — a WorkflowTemplate change review (Phase 4+) will need
    // its own subject field alongside this one, not a rework of it.
    email_template_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', required: true },
    status: { type: String, enum: REVIEW_TASK_STATUSES, default: 'OPEN', required: true },
    requested_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_at: { type: Date, default: null },
    rejection_reason: { type: String, trim: true },
  },
  { timestamps: true },
);

reviewTaskSchema.index({ org_id: 1, status: 1 });

export type ReviewTaskDocument = InferSchemaType<typeof reviewTaskSchema> & { _id: Types.ObjectId };

export const ReviewTask = model('ReviewTask', reviewTaskSchema);
