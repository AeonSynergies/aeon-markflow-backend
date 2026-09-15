import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { GUARDRAIL_DOMAIN_STATUSES } from '../constants/sendGuardrail';

/**
 * The one piece of SendGuardrail state that has to persist rather than be recomputed on every
 * check: whether a domain is currently paused. Everything else (today's ramp cap, current
 * bounce/complaint rates) is derived fresh from DomainSendEvent each time — but a pause has to
 * *stick* until a human resumes it (see resumeDomain in sendGuardrail.service.ts), or the very
 * next rolling-window recalculation could silently un-pause a domain the moment a bad batch of
 * events ages out of the window, defeating the point of raising a ReviewTask about it at all.
 */
const domainGuardrailStateSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true, unique: true },
    mailbox: { type: String, required: true, trim: true },
    status: { type: String, enum: GUARDRAIL_DOMAIN_STATUSES, default: 'active', required: true },
    paused_at: { type: Date, default: null },
    paused_reason: { type: String, trim: true },
    review_task_id: { type: Schema.Types.ObjectId, ref: 'ReviewTask', default: null },
    resumed_at: { type: Date, default: null },
    resumed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export type DomainGuardrailStateDocument = InferSchemaType<typeof domainGuardrailStateSchema> & {
  _id: Types.ObjectId;
};

export const DomainGuardrailState = model('DomainGuardrailState', domainGuardrailStateSchema);
