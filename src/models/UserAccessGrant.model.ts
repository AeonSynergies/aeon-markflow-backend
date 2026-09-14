import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { APPS, ROLES } from '../constants/access';

const userAccessGrantSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    app: { type: String, enum: APPS, required: true },
    // null means access to all orgs for this app.
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    role: { type: String, enum: ROLES, required: true },
    features: { type: [String], default: [] },
  },
  { timestamps: true },
);

// One grant per (user, app, org) scope — a user can still hold several grants across orgs.
userAccessGrantSchema.index({ user_id: 1, app: 1, org_id: 1 }, { unique: true });

export type UserAccessGrantDocument = InferSchemaType<typeof userAccessGrantSchema> & {
  _id: Types.ObjectId;
};

export const UserAccessGrant = model('UserAccessGrant', userAccessGrantSchema);
