import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const linkClickSchema = new Schema(
  {
    tracked_link_id: { type: Schema.Types.ObjectId, ref: 'TrackedLink', required: true },
    clicked_at: { type: Date, default: () => new Date() },
    ip: { type: String, trim: true },
    user_agent: { type: String, trim: true },
  },
  { timestamps: true },
);

linkClickSchema.index({ tracked_link_id: 1, clicked_at: -1 });

export type LinkClickDocument = InferSchemaType<typeof linkClickSchema> & { _id: Types.ObjectId };

export const LinkClick = model('LinkClick', linkClickSchema);
