import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const savedListSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    // A reusable lead segment, decoupled from any one workflow — static membership for now;
    // a dynamic/query-based segment can layer on top later without a rewrite.
    lead_ids: { type: [Schema.Types.ObjectId], ref: 'Lead', default: [] },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

savedListSchema.index({ org_id: 1 });

export type SavedListDocument = InferSchemaType<typeof savedListSchema> & { _id: Types.ObjectId };

export const SavedList = model('SavedList', savedListSchema);
