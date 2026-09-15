import { Schema } from 'mongoose';
import { STEP_KINDS, WAIT_UNITS } from '../../constants/workflow';

type StepContext = { kind?: string };

function requiredFor(kind: string, message: string): [(this: StepContext) => boolean, string] {
  return [function requiredForKind(this: StepContext) {
    return this.kind === kind;
  }, message];
}

/**
 * One step in a workflow sequence (email | call_task | sms | wait). Shared between
 * WorkflowTemplate.steps (the editable definition) and Enrollment.steps (a frozen snapshot
 * taken at enrollment time) so editing a template never changes a sequence a lead is already
 * enrolled in.
 */
export const workflowStepSchema = new Schema({
  kind: { type: String, enum: STEP_KINDS, required: true },

  // email — pins a specific, already-approved EmailTemplateVersion. Never "latest": resolving
  // to whatever is currently approved would let editing a template silently change a sequence
  // already enrolling leads.
  email_template_version_id: {
    type: Schema.Types.ObjectId,
    ref: 'EmailTemplateVersion',
    required: requiredFor('email', 'email_template_version_id is required for an email step'),
  },
  sending_domain: {
    type: String,
    trim: true,
    required: requiredFor('email', 'sending_domain is required for an email step'),
  },

  // sms — Zoom Phone SMS is blocked (see CLAUDE_APPS.md); the step shape is modeled now so a
  // template can be authored, but the queue processor fails this step clearly rather than
  // pretending to send.
  sms_body: {
    type: String,
    required: requiredFor('sms', 'sms_body is required for an sms step'),
  },

  // call_task — logged as a LeadActivity task for a human to complete; not an automated call.
  call_task_instructions: {
    type: String,
    required: requiredFor('call_task', 'call_task_instructions is required for a call_task step'),
  },

  // wait — delays the enqueue of the next step by this duration.
  wait_amount: {
    type: Number,
    min: 1,
    required: requiredFor('wait', 'wait_amount is required for a wait step'),
  },
  wait_unit: {
    type: String,
    enum: WAIT_UNITS,
    required: requiredFor('wait', 'wait_unit is required for a wait step'),
  },
});
