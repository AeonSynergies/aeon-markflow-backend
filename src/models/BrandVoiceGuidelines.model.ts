import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * The single current Brand Voice guidelines document — there is exactly one, shared across every
 * org. `Organization.brand_voice_guidelines_id` has never actually been populated or read by
 * anything (it names this model only in a comment); genuine per-org brand voice is a separate
 * product decision, not attempted here. See brandVoice.service.ts for why this replaces a static
 * file on disk.
 */
const brandVoiceGuidelinesSchema = new Schema(
  {
    text: { type: String, required: true },
    // Short content hash so every AI draft can log exactly which guideline revision it used —
    // same derivation (sha256, first 12 hex chars) as before this was DB-backed.
    version: { type: String, required: true },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export type BrandVoiceGuidelinesDocument = InferSchemaType<typeof brandVoiceGuidelinesSchema> & {
  _id: Types.ObjectId;
};

export const BrandVoiceGuidelines = model('BrandVoiceGuidelines', brandVoiceGuidelinesSchema);
