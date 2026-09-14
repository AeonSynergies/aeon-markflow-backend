import type { Request, Response } from 'express';
import { attachOrgScope, requireOrgAccess } from '../../src/middleware/orgScope.middleware';
import * as orgAccessService from '../../src/services/orgAccess.service';

jest.mock('../../src/services/orgAccess.service');

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('attachOrgScope', () => {
  afterEach(() => jest.clearAllMocks());

  it('401s when there is no authenticated user', async () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn();

    await attachOrgScope(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves org access for the authenticated user and calls next', async () => {
    const access = { allOrgs: false, orgIds: ['org-1'], roles: ['BD_SALES' as const] };
    jest.spyOn(orgAccessService, 'getOrgAccessForUser').mockResolvedValue(access);

    const req = { user: { id: 'user-1', email: 'u@aeonsynergies.com' } } as Request;
    const res = mockRes();
    const next = jest.fn();

    await attachOrgScope(req, res, next);

    expect(orgAccessService.getOrgAccessForUser).toHaveBeenCalledWith('user-1', 'markflow');
    expect(req.orgAccess).toEqual(access);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireOrgAccess', () => {
  it('403s when the resolved org is outside the caller\'s access', () => {
    jest.spyOn(orgAccessService, 'canAccessOrg').mockReturnValue(false);

    const req = { orgAccess: { allOrgs: false, orgIds: [], roles: [] }, params: { orgId: 'org-2' } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requireOrgAccess((r) => (r.params as { orgId: string }).orgId)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the org is within the caller\'s access', () => {
    jest.spyOn(orgAccessService, 'canAccessOrg').mockReturnValue(true);

    const req = { orgAccess: { allOrgs: true, orgIds: [], roles: [] }, params: { orgId: 'org-1' } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requireOrgAccess((r) => (r.params as { orgId: string }).orgId)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
