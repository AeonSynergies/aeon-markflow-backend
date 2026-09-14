import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    enabled_features: { type: [String], default: [] },
    // Free-text description of what the org sells and its ICP (e.g. "Amazon DSP back-office
    // suite (payroll, bookkeeping, disputes, analytics, dispatch, recruitment)") — grounds the
    // AI template assistant, not a fixed set of org names.
    product_context: { type: String, required: true, trim: true, minlength: 1 },
    // Points at a BrandVoiceGuidelines document introduced in the AI template assistant phase.
    brand_voice_guidelines_id: { type: Schema.Types.ObjectId, ref: 'BrandVoiceGuidelines' },
    // An org can send from more than one domain (e.g. Aeon Miles sometimes sends from the
    // Aeon Synergies domain) — never assume a 1:1 org-to-domain mapping.
    sending_domains: { type: [String], default: [] },
  },
  { timestamps: true },
);

export type OrganizationDocument = InferSchemaType<typeof organizationSchema> & { _id: Types.ObjectId };

export const Organization = model('Organization', organizationSchema);
