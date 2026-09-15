import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { SENDING_DOMAIN_PURPOSES } from '../constants/organization';

// Each org uses subdomains by purpose rather than one flat domain — e.g. for Aeon Synergies:
// aeonsynergies.com is transactional, mail.aeonsynergies.com is marketing. DomainRouter picks a
// sending route by (domain, purpose), not just by domain, so a marketing send can never
// accidentally go out from — and dilute the reputation of — a transactional/alerts domain.
const sendingDomainSchema = new Schema(
  {
    domain: { type: String, required: true, trim: true, lowercase: true },
    purpose: { type: String, enum: SENDING_DOMAIN_PURPOSES, required: true },
  },
  { _id: false },
);

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
    // Aeon Synergies domain) — never assume a 1:1 org-to-domain mapping. Each entry's purpose is
    // per-org: the same physical domain could in principle be transactional for one org and
    // marketing for another, though in practice a domain's purpose is usually fixed by whoever
    // owns its DKIM/reputation.
    sending_domains: { type: [sendingDomainSchema], default: [] },
  },
  { timestamps: true },
);

export type OrganizationDocument = InferSchemaType<typeof organizationSchema> & { _id: Types.ObjectId };

export const Organization = model('Organization', organizationSchema);
