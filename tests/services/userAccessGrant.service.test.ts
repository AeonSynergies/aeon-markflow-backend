jest.mock('../../src/models/User.model', () => ({ User: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/UserAccessGrant.model', () => ({
  UserAccessGrant: { find: jest.fn(), create: jest.fn(), findById: jest.fn() },
}));

import { User } from '../../src/models/User.model';
import { UserAccessGrant } from '../../src/models/UserAccessGrant.model';
import {
  UserAccessGrantNotFoundError,
  createUserAccessGrant,
  getUserAccessGrant,
  listUserAccessGrantsForOrg,
  updateUserAccessGrant,
} from '../../src/services/userAccessGrant.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('userAccessGrant.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listUserAccessGrantsForOrg', () => {
    it('queries by (org-scoped or all-orgs) and joins the granted user\'s email', async () => {
      (UserAccessGrant.find as jest.Mock).mockReturnValue(
        sortLean([
          {
            _id: { toString: () => 'grant-1' },
            user_id: { toString: () => 'user-1' },
            app: 'markflow',
            org_id: { toString: () => 'org-1' },
            role: 'BD_SALES',
            features: [],
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            _id: { toString: () => 'grant-2' },
            user_id: { toString: () => 'user-2' },
            app: 'markflow',
            org_id: null,
            role: 'SUPER_ADMIN',
            features: [],
            createdAt: new Date('2026-01-02'),
            updatedAt: new Date('2026-01-02'),
          },
        ]),
      );
      (User.find as jest.Mock).mockReturnValue(
        lean([
          { _id: { toString: () => 'user-1' }, email: 'sales@aeonsynergies.com' },
          { _id: { toString: () => 'user-2' }, email: 'admin@aeonsynergies.com' },
        ]),
      );

      const grants = await listUserAccessGrantsForOrg('org-1');

      expect(UserAccessGrant.find).toHaveBeenCalledWith({ $or: [{ org_id: 'org-1' }, { org_id: null }] });
      expect(grants).toEqual([
        expect.objectContaining({ grantId: 'grant-1', userEmail: 'sales@aeonsynergies.com', orgId: 'org-1' }),
        expect.objectContaining({ grantId: 'grant-2', userEmail: 'admin@aeonsynergies.com', orgId: null }),
      ]);
    });

    it('returns an empty array without querying User when there are no grants', async () => {
      (UserAccessGrant.find as jest.Mock).mockReturnValue(sortLean([]));
      const grants = await listUserAccessGrantsForOrg('org-1');
      expect(grants).toEqual([]);
      expect(User.find).not.toHaveBeenCalled();
    });
  });

  describe('createUserAccessGrant', () => {
    it('creates the grant and returns it with the user email joined', async () => {
      (UserAccessGrant.create as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'grant-1' },
        user_id: { toString: () => 'user-1' },
        app: 'markflow',
        org_id: { toString: () => 'org-1' },
        role: 'BD_SALES',
        features: [],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      });
      (User.findById as jest.Mock).mockReturnValue(lean({ email: 'sales@aeonsynergies.com' }));

      const view = await createUserAccessGrant({ userId: 'user-1', app: 'markflow', orgId: 'org-1', role: 'BD_SALES' });

      expect(UserAccessGrant.create).toHaveBeenCalledWith({
        user_id: 'user-1',
        app: 'markflow',
        org_id: 'org-1',
        role: 'BD_SALES',
        features: [],
      });
      expect(view.userEmail).toBe('sales@aeonsynergies.com');
    });
  });

  describe('getUserAccessGrant', () => {
    it('throws UserAccessGrantNotFoundError when missing', async () => {
      (UserAccessGrant.findById as jest.Mock).mockResolvedValue(null);
      await expect(getUserAccessGrant('missing')).rejects.toThrow(UserAccessGrantNotFoundError);
    });
  });

  describe('updateUserAccessGrant', () => {
    it('updates role and features via .set(), leaving app/org_id/user_id untouched', async () => {
      const grant = {
        _id: { toString: () => 'grant-1' },
        user_id: { toString: () => 'user-1' },
        app: 'markflow',
        org_id: { toString: () => 'org-1' },
        role: 'BD_SALES',
        features: [] as string[],
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      (UserAccessGrant.findById as jest.Mock).mockResolvedValue(grant);
      (User.findById as jest.Mock).mockReturnValue(lean({ email: 'sales@aeonsynergies.com' }));

      const view = await updateUserAccessGrant('grant-1', { role: 'BD_MANAGER', features: ['x'] });

      expect(grant.role).toBe('BD_MANAGER');
      expect(grant.set).toHaveBeenCalledWith('features', ['x']);
      expect(grant.save).toHaveBeenCalled();
      expect(view.grantId).toBe('grant-1');
    });

    it('propagates UserAccessGrantNotFoundError when the grant does not exist', async () => {
      (UserAccessGrant.findById as jest.Mock).mockResolvedValue(null);
      await expect(updateUserAccessGrant('missing', { role: 'BD_SALES' })).rejects.toThrow(UserAccessGrantNotFoundError);
    });
  });
});
