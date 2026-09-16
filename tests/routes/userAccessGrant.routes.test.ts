import type { Request, Response } from 'express';

jest.mock('../../src/services/userAccessGrant.service', () => ({
  UserAccessGrantNotFoundError: jest.requireActual('../../src/services/userAccessGrant.service')
    .UserAccessGrantNotFoundError,
  createUserAccessGrant: jest.fn(),
  getUserAccessGrant: jest.fn(),
  listUserAccessGrantsForOrg: jest.fn(),
  updateUserAccessGrant: jest.fn(),
}));

import {
  UserAccessGrantNotFoundError,
  createUserAccessGrant,
  getUserAccessGrant,
  listUserAccessGrantsForOrg,
  updateUserAccessGrant,
} from '../../src/services/userAccessGrant.service';
import {
  createUserAccessGrantHandler,
  listUserAccessGrantsHandler,
  updateUserAccessGrantHandler,
} from '../../src/routes/userAccessGrant.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

const SAMPLE_VIEW = {
  grantId: 'grant-1',
  userId: 'user-1',
  userEmail: 'sales@aeonsynergies.com',
  app: 'markflow',
  orgId: 'org-1',
  role: 'BD_SALES',
  features: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('userAccessGrant.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listUserAccessGrantsHandler', () => {
    it('lists grants for the org param', async () => {
      (listUserAccessGrantsForOrg as jest.Mock).mockResolvedValue([SAMPLE_VIEW]);
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await listUserAccessGrantsHandler(req, res, jest.fn());

      expect(listUserAccessGrantsForOrg).toHaveBeenCalledWith('org-1');
      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ _id: 'grant-1', user_email: 'sales@aeonsynergies.com' })]);
    });
  });

  describe('createUserAccessGrantHandler', () => {
    it('defaults org_id to the URL org and creates the grant', async () => {
      (createUserAccessGrant as jest.Mock).mockResolvedValue(SAMPLE_VIEW);
      const req = {
        params: { orgId: 'org-1' },
        body: { user_id: 'user-1', app: 'markflow', role: 'BD_SALES' },
        orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['ADMIN'] },
      } as unknown as Request;
      const res = mockRes();

      await createUserAccessGrantHandler(req, res, jest.fn());

      expect(createUserAccessGrant).toHaveBeenCalledWith({
        userId: 'user-1',
        app: 'markflow',
        orgId: 'org-1',
        role: 'BD_SALES',
        features: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('403s when org_id is explicitly null but the caller lacks all-orgs access', async () => {
      const req = {
        params: { orgId: 'org-1' },
        body: { user_id: 'user-1', app: 'markflow', role: 'BD_SALES', org_id: null },
        orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['ADMIN'] },
      } as unknown as Request;
      const res = mockRes();

      await createUserAccessGrantHandler(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(createUserAccessGrant).not.toHaveBeenCalled();
    });

    it('allows org_id: null when the caller does hold all-orgs access', async () => {
      (createUserAccessGrant as jest.Mock).mockResolvedValue({ ...SAMPLE_VIEW, orgId: null });
      const req = {
        params: { orgId: 'org-1' },
        body: { user_id: 'user-1', app: 'markflow', role: 'SUPER_ADMIN', org_id: null },
        orgAccess: { allOrgs: true, orgIds: [], roles: ['SUPER_ADMIN'] },
      } as unknown as Request;
      const res = mockRes();

      await createUserAccessGrantHandler(req, res, jest.fn());

      expect(createUserAccessGrant).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: null }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('403s when org_id targets a different org the caller cannot access', async () => {
      const req = {
        params: { orgId: 'org-1' },
        body: { user_id: 'user-1', app: 'markflow', role: 'BD_SALES', org_id: 'org-2' },
        orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['ADMIN'] },
      } as unknown as Request;
      const res = mockRes();

      await createUserAccessGrantHandler(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(createUserAccessGrant).not.toHaveBeenCalled();
    });
  });

  describe('updateUserAccessGrantHandler', () => {
    it('404s (via next) when the grant belongs to a different single org', async () => {
      (getUserAccessGrant as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'grant-1' },
        org_id: { toString: () => 'org-2' },
      });
      const req = { params: { orgId: 'org-1', grantId: 'grant-1' }, body: {} } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await updateUserAccessGrantHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UserAccessGrantNotFoundError));
      expect(updateUserAccessGrant).not.toHaveBeenCalled();
    });

    it('allows updating an all-orgs (org_id: null) grant from any accessible org', async () => {
      (getUserAccessGrant as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'grant-1' },
        org_id: null,
      });
      (updateUserAccessGrant as jest.Mock).mockResolvedValue({ ...SAMPLE_VIEW, orgId: null, role: 'ADMIN' });
      const req = {
        params: { orgId: 'org-1', grantId: 'grant-1' },
        body: { role: 'ADMIN' },
      } as unknown as Request;
      const res = mockRes();

      await updateUserAccessGrantHandler(req, res, jest.fn());

      expect(updateUserAccessGrant).toHaveBeenCalledWith('grant-1', { role: 'ADMIN' });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'ADMIN' }));
    });

    it('updates a grant belonging to the same org', async () => {
      (getUserAccessGrant as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'grant-1' },
        org_id: { toString: () => 'org-1' },
      });
      (updateUserAccessGrant as jest.Mock).mockResolvedValue(SAMPLE_VIEW);
      const req = {
        params: { orgId: 'org-1', grantId: 'grant-1' },
        body: { features: ['x'] },
      } as unknown as Request;
      const res = mockRes();

      await updateUserAccessGrantHandler(req, res, jest.fn());

      expect(updateUserAccessGrant).toHaveBeenCalledWith('grant-1', { features: ['x'] });
    });
  });
});
