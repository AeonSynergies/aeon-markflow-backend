import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  EMAIL_TEMPLATE_VERSION_STATUSES,
  GENERATION_SOURCES,
  IMAGE_POLICIES,
} from '../constants/emailTemplate';

const imageBlockSchema = new Schema(
  {
    block_id: { type: String, required: true },
    alt_text: { type: String, trim: true },
    placeholder_src: { type: String, trim: true },
  },
  { _id: false },
);

const aiDraftSnapshotSchema = new Schema(
  {
    subject_line: { type: String, required: true },
    body_html: { type: String, required: true },
  },
  { _id: false },
);

const aiGenerationMetadataSchema = new Schema(
  {
    // Which Winning Email Library examples (approved EmailTemplateVersions) grounded this
    // draft — there's no separate library collection, so this points straight at them.
    reference_templates: { type: [Schema.Types.ObjectId], ref: 'EmailTemplateVersion', default: [] },
    reason: { type: String, required: true, trim: true },
    brand_voice_guidelines_version: { type: String, required: true },
    model: { type: String, required: true },
    generated_at: { type: Date, required: true },
  },
  { _id: false },
);

const emailTemplateVersionSchema = new Schema(
  {
    email_template_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', required: true },
    version_number: { type: Number, required: true, min: 1 },
    subject_line: { type: String, required: true, trim: true },
    body_html: { type: String, required: true },
    image_blocks: { type: [imageBlockSchema], default: [] },
    image_policy: { type: String, enum: IMAGE_POLICIES, default: 'auto' },
    generation_source: { type: String, enum: GENERATION_SOURCES, required: true },
    // The raw AI output, preserved even after human edits (ai_edited_by_human) so a reviewer
    // can diff what changed.
    ai_draft_snapshot: { type: aiDraftSnapshotSchema, default: undefined },
    status: { type: String, enum: EMAIL_TEMPLATE_VERSION_STATUSES, default: 'DRAFT', required: true },
    ai_generation_metadata: {
      type: aiGenerationMetadataSchema,
      default: undefined,
      // Required only for ai/ai_edited_by_human — a plain `.validate()` is skipped by
      // Mongoose when the value is undefined, so conditional presence has to go through
      // `required` itself.
      required: [
        function requireAiMetadata(this: { generation_source?: string }) {
          return this.generation_source !== 'human';
        },
        'ai_generation_metadata is required when generation_source is "ai" or "ai_edited_by_human"',
      ],
    },
  },
  { timestamps: true },
);

// One EmailTemplateVersion per (template, version_number); status lookups (open review
// queues, etc.) are also common.
emailTemplateVersionSchema.index({ email_template_id: 1, version_number: 1 }, { unique: true });
emailTemplateVersionSchema.index({ status: 1 });

export type EmailTemplateVersionDocument = InferSchemaType<typeof emailTemplateVersionSchema> & {
  _id: Types.ObjectId;
};

export const EmailTemplateVersion = model('EmailTemplateVersion', emailTemplateVersionSchema);
