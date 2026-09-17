import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ENROLLMENT_STATUSES } from '../constants/workflow';
import { SEND_TIME_STRATEGIES } from '../constants/sendTimeOptimization';
import { workflowStepSchema } from './schemas/workflowStep.schema';

const assignedMailboxSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true },
    mailbox: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const enrollmentSchema = new Schema(
  {
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    workflow_template_id: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true },
    // A snapshot of the template's steps taken at enrollment time — never read live from
    // WorkflowTemplate, so editing a template can never silently change a sequence a lead is
    // already enrolled in.
    steps: { type: [workflowStepSchema], required: true },
    // One mailbox per distinct sending_domain among this enrollment's own email steps, assigned
    // once by domainRouter.service.ts's assignMailboxesForDomains at enrollment creation
    // (enrollment.service.ts) and reused by every step that sends from that domain — never
    // re-resolved per send. Without this, the same lead's sequence could visibly send from a
    // different named mailbox at every touch instead of one consistent sender throughout.
    // Defaults to [] for an enrollment created before this existed; sendWorkflowEmail falls back
    // to resolving a mailbox on the spot for those (see resolveSendingRoute).
    assigned_mailboxes: { type: [assignedMailboxSchema], default: [] },
    // Same snapshot reasoning as steps: SendGuardrail reads this to decide whether to apply
    // ramp-up throttling to this enrollment's email sends (see sendGuardrail.service.ts). Frozen
    // at enrollment time so toggling a template's warmup flag never silently changes behavior
    // for a lead already mid-sequence.
    requires_warmup: { type: Boolean, default: false },
    // Both snapshotted at enrollment time for the same reason as requires_warmup — from the
    // template (workflow_type) and the org (send_time_strategy) respectively, so a lead's own
    // enrollment behavior can never change just because someone edited the template's category
    // or toggled the org's send-time optimization setting mid-sequence. See
    // sendTimeOptimization.service.ts / enrollmentProcessor.ts.
    workflow_type: { type: String, trim: true, default: null },
    send_time_strategy: { type: String, enum: SEND_TIME_STRATEGIES, default: 'manual' },
    current_step_index: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ENROLLMENT_STATUSES, default: 'active', required: true },
    started_at: { type: Date, default: () => new Date() },
    completed_at: { type: Date, default: null },
    exit_reason: { type: String, trim: true },
  },
  { timestamps: true },
);

// At most one active enrollment per (lead, template) — a completed/exited one doesn't block
// re-enrollment (e.g. after a Lost+Recycle win-back).
enrollmentSchema.index(
  { lead_id: 1, workflow_template_id: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
enrollmentSchema.index({ workflow_template_id: 1, status: 1 });

export type EnrollmentDocument = InferSchemaType<typeof enrollmentSchema> & { _id: Types.ObjectId };

export const Enrollment = model('Enrollment', enrollmentSchema);
