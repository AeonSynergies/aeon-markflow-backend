import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ENROLLMENT_STATUSES } from '../constants/workflow';
import { workflowStepSchema } from './schemas/workflowStep.schema';

const enrollmentSchema = new Schema(
  {
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    workflow_template_id: { type: Schema.Types.ObjectId, ref: 'WorkflowTemplate', required: true },
    // A snapshot of the template's steps taken at enrollment time — never read live from
    // WorkflowTemplate, so editing a template can never silently change a sequence a lead is
    // already enrolled in.
    steps: { type: [workflowStepSchema], required: true },
    // Same snapshot reasoning as steps: SendGuardrail reads this to decide whether to apply
    // ramp-up throttling to this enrollment's email sends (see sendGuardrail.service.ts). Frozen
    // at enrollment time so toggling a template's warmup flag never silently changes behavior
    // for a lead already mid-sequence.
    requires_warmup: { type: Boolean, default: false },
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
