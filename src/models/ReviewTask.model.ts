import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { REVIEW_TASK_KINDS, REVIEW_TASK_STATUSES } from '../constants/reviewTask';
import { requiredWhenKindIs } from '../utils/mongooseValidators';

const reviewTaskSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    // What this review task is about. Defaults to the original (and for a while only) kind so
    // every existing call site — which never set `kind` — keeps behaving exactly as before.
    kind: { type: String, enum: REVIEW_TASK_KINDS, default: 'email_template_version', required: true },
    email_template_version_id: {
      type: Schema.Types.ObjectId,
      ref: 'EmailTemplateVersion',
      required: requiredWhenKindIs('email_template_version', 'email_template_version_id is required when kind is email_template_version'),
    },
    // Set by SendGuardrail when it pauses a domain (Phase 5) — see sendGuardrail.service.ts.
    domain: {
      type: String,
      trim: true,
      required: requiredWhenKindIs('domain_guardrail', 'domain is required when kind is domain_guardrail'),
    },
    status: { type: String, enum: REVIEW_TASK_STATUSES, default: 'OPEN', required: true },
    requested_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_at: { type: Date, default: null },
    // Free-text "why". Named for its original (rejection) use, but SendGuardrail also reuses it
    // to record why it paused a domain — read as "the reason this task exists", not literally
    // limited to a rejection.
    rejection_reason: { type: String, trim: true },
  },
  { timestamps: true },
);

reviewTaskSchema.index({ org_id: 1, status: 1 });
reviewTaskSchema.index({ domain: 1, status: 1 });

export type ReviewTaskDocument = InferSchemaType<typeof reviewTaskSchema> & { _id: Types.ObjectId };

export const ReviewTask = model('ReviewTask', reviewTaskSchema);
