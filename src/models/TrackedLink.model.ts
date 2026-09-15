import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const trackedLinkSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    destination_url: { type: String, required: true, trim: true },
    // Set once the workflow/enrollment engine (a later build-order phase) exists; nullable so
    // click tracking is usable standalone, ahead of that.
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    email_template_version_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplateVersion', default: null },
  },
  { timestamps: true },
);

trackedLinkSchema.index({ org_id: 1 });

export type TrackedLinkDocument = InferSchemaType<typeof trackedLinkSchema> & { _id: Types.ObjectId };

export const TrackedLink = model('TrackedLink', trackedLinkSchema);
