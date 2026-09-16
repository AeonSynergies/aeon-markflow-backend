import type { App, Role } from '../constants/access';
import { User } from '../models/User.model';
import { UserAccessGrant } from '../models/UserAccessGrant.model';

export class UserAccessGrantNotFoundError extends Error {
  constructor(id: string) {
    super(`UserAccessGrant ${id} not found`);
    this.name = 'UserAccessGrantNotFoundError';
  }
}

export interface UserAccessGrantView {
  grantId: string;
  userId: string;
  /** Denormalized for display — null only if the referenced User no longer exists. */
  userEmail: string | null;
  app: App;
  /** null means access to all orgs for this app. */
  orgId: string | null;
  role: Role;
  features: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface GrantLike {
  _id: { toString(): string };
  user_id: { toString(): string };
  app: string;
  org_id?: { toString(): string } | null;
  role: string;
  features: string[];
  createdAt: Date;
  updatedAt: Date;
}

async function toView(grant: GrantLike): Promise<UserAccessGrantView> {
  const user = await User.findById(grant.user_id, 'email').lean();
  return {
    grantId: grant._id.toString(),
    userId: grant.user_id.toString(),
    userEmail: user?.email ?? null,
    app: grant.app as App,
    orgId: grant.org_id ? grant.org_id.toString() : null,
    role: grant.role as Role,
    features: grant.features,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

/** Every grant relevant to one org: those scoped to exactly this org, plus any "all orgs"
 * (org_id: null) grant, for any app — a global grant affects this org's access too. */
export async function listUserAccessGrantsForOrg(orgId: string): Promise<UserAccessGrantView[]> {
  const grants = await UserAccessGrant.find({ $or: [{ org_id: orgId }, { org_id: null }] })
    .sort({ createdAt: -1 })
    .lean();
  if (grants.length === 0) return [];

  const users = await User.find({ _id: { $in: grants.map((grant) => grant.user_id) } }, 'email').lean();
  const emailByUserId = new Map(users.map((user) => [user._id.toString(), user.email]));

  return grants.map((grant) => ({
    grantId: grant._id.toString(),
    userId: grant.user_id.toString(),
    userEmail: emailByUserId.get(grant.user_id.toString()) ?? null,
    app: grant.app as App,
    orgId: grant.org_id ? grant.org_id.toString() : null,
    role: grant.role as Role,
    features: grant.features,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  }));
}

export interface CreateUserAccessGrantInput {
  userId: string;
  app: App;
  orgId: string | null;
  role: Role;
  features?: string[];
}

export async function createUserAccessGrant(input: CreateUserAccessGrantInput): Promise<UserAccessGrantView> {
  const grant = await UserAccessGrant.create({
    user_id: input.userId,
    app: input.app,
    org_id: input.orgId,
    role: input.role,
    features: input.features ?? [],
  });
  return toView(grant);
}

export async function getUserAccessGrant(grantId: string) {
  const grant = await UserAccessGrant.findById(grantId);
  if (!grant) throw new UserAccessGrantNotFoundError(grantId);
  return grant;
}

export interface UpdateUserAccessGrantInput {
  role?: Role;
  features?: string[];
}

/** Updates role and/or features only — app/org_id/user_id are immutable after creation (the
 * model's own unique index is on exactly that triple, so changing any of them is really "a
 * different grant": create a new one and let the old one be updated/removed separately). */
export async function updateUserAccessGrant(
  grantId: string,
  updates: UpdateUserAccessGrantInput,
): Promise<UserAccessGrantView> {
  const grant = await getUserAccessGrant(grantId);

  if (updates.role !== undefined) grant.role = updates.role;
  if (updates.features !== undefined) grant.set('features', updates.features);

  await grant.save();
  return toView(grant);
}
