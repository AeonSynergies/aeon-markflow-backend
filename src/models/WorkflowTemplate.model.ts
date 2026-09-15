import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { workflowStepSchema } from './schemas/workflowStep.schema';

const workflowTemplateSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    requires_warmup: { type: Boolean, default: false },
    // Free-text category label (e.g. "cold_outreach", "win_back") — not this specific template's
    // name/id. Lets send-time performance (Phase 7) roll up across every template of the same
    // type rather than fragmenting sample size per exact template.
    workflow_type: { type: String, trim: true, default: null },
    steps: { type: [workflowStepSchema], default: [] },
  },
  { timestamps: true },
);

workflowTemplateSchema.index({ org_id: 1 });

export type WorkflowStep = InferSchemaType<typeof workflowStepSchema> & { _id: Types.ObjectId };
export type WorkflowTemplateDocument = InferSchemaType<typeof workflowTemplateSchema> & { _id: Types.ObjectId };

export const WorkflowTemplate = model('WorkflowTemplate', workflowTemplateSchema);
