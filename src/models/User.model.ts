import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

// Minimal shared-identity model. MarkFlow and Onboard are separate backend services that
// authenticate against the same Users collection (or the same JWT secret) rather than a
// shared backend — see "Shared identity without a shared backend" in CLAUDE.md.
interface UserFields {
  email: string;
  password_hash: string;
  name: string;
  is_active: boolean;
}

interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModelType = Model<UserFields, object, UserMethods> & {
  hashPassword(plaintext: string): Promise<string>;
};

const userSchema = new Schema<UserFields, UserModelType, UserMethods>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password_hash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.methods.comparePassword = function comparePassword(
  this: HydratedDocument<UserFields, UserMethods>,
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password_hash);
};

userSchema.statics.hashPassword = function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
};

export type UserDocument = HydratedDocument<UserFields, UserMethods> & { _id: Types.ObjectId };

export const User = model<UserFields, UserModelType>('User', userSchema);
