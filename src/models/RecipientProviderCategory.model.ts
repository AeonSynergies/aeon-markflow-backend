import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { PROVIDER_CATEGORIES } from '../constants/providerCategory';

/**
 * Per-domain cache of the recipient-side provider classification (consumer webmail vs.
 * corporate/enterprise) used by the "auto" image policy (see imagePolicy.service.ts). Keyed by
 * the recipient's email domain, not by org or lead — the same classification applies to every
 * lead at that domain. `mx_hosts` is kept for audit/debugging even though today's classification
 * mostly just confirms real mail infrastructure exists — see providerCategory.ts's own comment.
 */
const recipientProviderCategorySchema = new Schema(
  {
    domain: { type: String, required: true, trim: true, lowercase: true, unique: true },
    category: { type: String, enum: PROVIDER_CATEGORIES, required: true },
    mx_hosts: { type: [String], default: [] },
    checked_at: { type: Date, required: true },
  },
  { timestamps: true },
);

export type RecipientProviderCategoryDocument = InferSchemaType<typeof recipientProviderCategorySchema> & {
  _id: Types.ObjectId;
};

export const RecipientProviderCategory = model('RecipientProviderCategory', recipientProviderCategorySchema);
