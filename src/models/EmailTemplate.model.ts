import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const emailTemplateSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    // Audience/cadence-position labels, matching the Winning Email Library seed's
    // persona/position keys (e.g. persona: 'fedex_isp', workflow_position: 'cold_open').
    persona: { type: String, trim: true },
    workflow_position: { type: String, trim: true },
    // Groups an incumbent with its challenger variant(s) for A/B testing (Phase 6) — plain id,
    // not a ref, since there's still no separate AbGroup collection: every EmailTemplate sharing
    // one just IS a variant in that test. See abTesting.service.ts.
    ab_group_id: { type: Schema.Types.ObjectId, default: null },
    current_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', default: null },
  },
  { timestamps: true },
);

emailTemplateSchema.index({ org_id: 1 });

export type EmailTemplateDocument = InferSchemaType<typeof emailTemplateSchema> & { _id: Types.ObjectId };

export const EmailTemplate = model('EmailTemplate', emailTemplateSchema);
