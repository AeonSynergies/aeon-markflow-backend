import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { LEAD_ACTIVITY_DIRECTIONS, LEAD_ACTIVITY_KINDS } from '../constants/leadActivity';
import { REPLY_INTENTS } from '../constants/replyIntent';

// Same shape/naming convention as EmailTemplateVersion's ai_generation_metadata — see
// replyIntentClassifier.service.ts. Optional (undefined by default): only set on an inbound
// email reply that was actually run through classification, never on outbound sends,
// bounces/complaints, or non-email activity kinds.
const aiReplyClassificationSchema = new Schema(
  {
    intent: { type: String, enum: REPLY_INTENTS, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    reasoning: { type: String, required: true, trim: true },
    model: { type: String, required: true },
    classified_at: { type: Date, required: true },
  },
  { _id: false },
);

const leadActivitySchema = new Schema(
  {
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    kind: { type: String, enum: LEAD_ACTIVITY_KINDS, required: true },
    // Set once the enrollment engine (Phase 4) exists.
    enrollment_id: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    workflow_step_index: { type: Number, default: null },
    // Which EmailTemplateVersion this was — set on outbound sends directly, and on inbound
    // replies via the mailbox poller's correlation. The diagnosis-by-symptom analysis
    // (src/services/emailPerformanceAnalysis.service.ts) uses this to compute a version's reply
    // rate without joining through Enrollment.steps.
    email_template_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', default: null },
    direction: { type: String, enum: LEAD_ACTIVITY_DIRECTIONS, default: null },
    subject: { type: String, trim: true },
    body_text: { type: String },
    body_html: { type: String },
    // Correlates with an EmailProvider SendResult/InboundMessage id.
    provider_message_id: { type: String, trim: true },
    // Correlates with an EmailProvider SendResult/InboundMessage thread/conversation id — lets
    // the mailbox poller (src/services/mailboxPoller.service.ts) match an inbound bounce/reply
    // back to the outbound LeadActivity it responded to.
    provider_thread_id: { type: String, trim: true },
    occurred_at: { type: Date, required: true, default: () => new Date() },
    // AI-classified reply intent (mailboxPoller.service.ts's processCandidateReply) — a triage
    // aid for a human, never something that drafts or sends anything on its own. See
    // src/constants/replyIntent.ts.
    ai_reply_classification: { type: aiReplyClassificationSchema, default: undefined },
  },
  { timestamps: true },
);

// Reply drafting reconstructs a lead's thread in chronological order.
leadActivitySchema.index({ lead_id: 1, occurred_at: 1 });
// The mailbox poller's primary correlation path: find the outbound send a bounce/reply answers.
leadActivitySchema.index({ provider_thread_id: 1 }, { sparse: true });
// Its idempotency check: has this exact inbound message already been logged?
leadActivitySchema.index({ provider_message_id: 1, direction: 1 }, { sparse: true });
// The diagnosis pipeline's per-version reply-rate query.
leadActivitySchema.index({ email_template_version_id: 1, kind: 1, direction: 1 }, { sparse: true });

export type LeadActivityDocument = InferSchemaType<typeof leadActivitySchema> & { _id: Types.ObjectId };

export const LeadActivity = model('LeadActivity', leadActivitySchema);
