import { Types } from 'mongoose';
import { UserAccessGrant } from '../../src/models/UserAccessGrant.model';

describe('UserAccessGrant model', () => {
  const user_id = new Types.ObjectId();

  it('requires user_id, app, and role', () => {
    const doc = new UserAccessGrant({});
    const err = doc.validateSync();
    expect(err?.errors.user_id).toBeDefined();
    expect(err?.errors.app).toBeDefined();
    expect(err?.errors.role).toBeDefined();
  });

  it('allows a null org_id to mean access to all orgs', () => {
    const doc = new UserAccessGrant({ user_id, app: 'markflow', role: 'ADMIN' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.org_id).toBeNull();
  });

  it('rejects a role outside the RBAC table', () => {
    const doc = new UserAccessGrant({ user_id, app: 'markflow', role: 'SUPERUSER' });
    const err = doc.validateSync();
    expect(err?.errors.role).toBeDefined();
  });

  it('rejects an unknown app', () => {
    const doc = new UserAccessGrant({ user_id, app: 'somewhere-else', role: 'ADMIN' });
    const err = doc.validateSync();
    expect(err?.errors.app).toBeDefined();
  });

  it('scopes a BD-Lead Gen grant to a single org', () => {
    const org_id = new Types.ObjectId();
    const doc = new UserAccessGrant({ user_id, app: 'markflow', org_id, role: 'BD_LEAD_GEN' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.org_id?.toString()).toBe(org_id.toString());
  });

  it('enforces one grant per (user_id, app, org_id) via a compound unique index', () => {
    const indexes = UserAccessGrant.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.user_id === 1 && fields.app === 1 && fields.org_id === 1,
    );
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
  });
});
