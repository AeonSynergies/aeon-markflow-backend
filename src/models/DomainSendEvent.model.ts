import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { SEND_EVENT_KINDS } from '../constants/sendGuardrail';

/**
 * An append-only log of what happened on a sending domain: one row per outbound send, plus one
 * row per bounce/complaint/reply outcome as they become known. SendGuardrail (see
 * sendGuardrail.service.ts) aggregates this over rolling windows rather than maintaining a
 * running counter, so its rate calculations are always exactly reproducible from raw events and
 * never drift from double-counting or a missed decrement.
 *
 * `kind: 'sent'` is recorded for real, from the actual send path in enrollmentProcessor.
 * `bounced` / `complained` / `replied` are recorded by recordDeliverabilityEvent() — nothing in
 * this codebase calls that yet, since no ESP webhook receiver or inbound-message poller exists
 * (see that function's own doc comment). Until one does, rate-based enforcement has no live
 * bounce/complaint/reply data to react to.
 */
const domainSendEventSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true },
    mailbox: { type: String, required: true, trim: true },
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    kind: { type: String, enum: SEND_EVENT_KINDS, required: true },
  },
  { timestamps: true },
);

// Rolling-window aggregation always filters by (domain, kind, createdAt range).
domainSendEventSchema.index({ domain: 1, kind: 1, createdAt: 1 });

export type DomainSendEventDocument = InferSchemaType<typeof domainSendEventSchema> & { _id: Types.ObjectId };

export const DomainSendEvent = model('DomainSendEvent', domainSendEventSchema);
