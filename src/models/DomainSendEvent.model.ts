import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { SEND_EVENT_KINDS } from '../constants/sendGuardrail';

/**
 * An append-only log of what happened on a sending domain: one row per outbound send, plus one
 * row per bounce/complaint/reply outcome as they become known (recorded live by the mailbox
 * poller, src/services/mailboxPoller.service.ts). SendGuardrail (see sendGuardrail.service.ts)
 * aggregates this over rolling windows rather than maintaining a running counter, so its rate
 * calculations are always exactly reproducible from raw events and never drift from
 * double-counting or a missed decrement.
 *
 * `email_template_version_id` is optional — SendGuardrail's own domain-level aggregation never
 * filters by it, but the diagnosis-by-symptom analysis
 * (src/services/emailPerformanceAnalysis.service.ts) uses it to compute a specific version's own
 * bounce rate, separate from the domain's aggregate.
 */
const domainSendEventSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true },
    mailbox: { type: String, required: true, trim: true },
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    email_template_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', default: null },
    kind: { type: String, enum: SEND_EVENT_KINDS, required: true },
  },
  { timestamps: true },
);

// Rolling-window aggregation always filters by (domain, kind, createdAt range).
domainSendEventSchema.index({ domain: 1, kind: 1, createdAt: 1 });
// The diagnosis pipeline's per-version bounce-rate query.
domainSendEventSchema.index({ email_template_version_id: 1, kind: 1 }, { sparse: true });

export type DomainSendEventDocument = InferSchemaType<typeof domainSendEventSchema> & { _id: Types.ObjectId };

export const DomainSendEvent = model('DomainSendEvent', domainSendEventSchema);
