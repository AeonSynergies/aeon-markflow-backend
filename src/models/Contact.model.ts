import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const firmographicsSchema = new Schema(
  {
    dsp_code: { type: String, trim: true },
    drivers: { type: Number, min: 0 },
    vans: { type: Number, min: 0 },
    stations: { type: [String], default: [] },
  },
  { _id: false },
);

const contactSchema = new Schema(
  {
    // Contacts are shared across orgs (a single person may be a lead for more than one
    // organization) — org-specific state lives on Lead, not here.
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: EMAIL_REGEX,
      unique: true,
      sparse: true,
    },
    phone: { type: String, trim: true },
    // IANA time zone name (e.g. "America/New_York"), when known — send-time optimization
    // (Phase 7) resolves sends to this contact's own local time rather than the server's.
    // Nothing currently populates this automatically; nullable, and every consumer must fall
    // back to UTC when it's missing (see src/utils/timezone.ts).
    timezone: { type: String, trim: true, default: null },
    firmographics: { type: firmographicsSchema, default: undefined },
    // Hard suppress override — takes precedence over any org-level or lead-level
    // deliverability/DND state.
    global_do_not_contact: { type: Boolean, default: false },
  },
  { timestamps: true },
);

contactSchema.index({ phone: 1 }, { sparse: true });

export type ContactDocument = InferSchemaType<typeof contactSchema> & { _id: Types.ObjectId };

export const Contact = model('Contact', contactSchema);
