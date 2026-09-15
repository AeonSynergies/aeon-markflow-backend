import type { Request, Response } from 'express';
import { attachOrgScope, requireOrgAccess, requireRole } from '../../src/middleware/orgScope.middleware';
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

describe('requireRole', () => {
  it('401s when there is no resolved org access', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn();

    requireRole(['ADMIN'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when none of the caller's roles are allowed", () => {
    const req = { orgAccess: { allOrgs: true, orgIds: [], roles: ['BD_LEAD_GEN' as const] } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requireRole(['ADMIN', 'BD_SALES'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when one of the caller\'s roles is allowed', () => {
    const req = {
      orgAccess: { allOrgs: true, orgIds: [], roles: ['BD_SALES' as const, 'BD_LEAD_GEN' as const] },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requireRole(['ADMIN', 'BD_SALES'])(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
