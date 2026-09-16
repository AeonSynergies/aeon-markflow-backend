import type { Request, Response } from 'express';

jest.mock('../../src/models/Organization.model', () => ({ Organization: { find: jest.fn() } }));

import { Organization } from '../../src/models/Organization.model';
import { getMeHandler } from '../../src/routes/me.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

function sortLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('me.routes getMeHandler', () => {
  afterEach(() => jest.clearAllMocks());

  it('lists only the orgs the caller has an explicit grant for when they lack all-orgs access', async () => {
    (Organization.find as jest.Mock).mockReturnValue(
      sortLean([
        { _id: { toString: () => 'org-1' }, name: 'Aeon Miles' },
        { _id: { toString: () => 'org-2' }, name: 'Aeon Sign' },
      ]),
    );
    const req = {
      user: { id: 'user-1', email: 'sales@aeonsynergies.com' },
      orgAccess: { allOrgs: false, orgIds: ['org-1', 'org-2'], roles: ['BD_SALES'] },
    } as unknown as Request;
    const res = mockRes();

    await getMeHandler(req, res, jest.fn());

    expect(Organization.find).toHaveBeenCalledWith({ _id: { $in: ['org-1', 'org-2'] } }, 'name');
    expect(res.json).toHaveBeenCalledWith({
      user: { id: 'user-1', email: 'sales@aeonsynergies.com' },
      org_access: { all_orgs: false, roles: ['BD_SALES'] },
      orgs: [
        { id: 'org-1', name: 'Aeon Miles' },
        { id: 'org-2', name: 'Aeon Sign' },
      ],
    });
  });

  it('lists every org when the caller holds all-orgs access', async () => {
    (Organization.find as jest.Mock).mockReturnValue(
      sortLean([{ _id: { toString: () => 'org-1' }, name: 'Aeon Miles' }]),
    );
    const req = {
      user: { id: 'user-1', email: 'admin@aeonsynergies.com' },
      orgAccess: { allOrgs: true, orgIds: [], roles: ['SUPER_ADMIN'] },
    } as unknown as Request;
    const res = mockRes();

    await getMeHandler(req, res, jest.fn());

    expect(Organization.find).toHaveBeenCalledWith({}, 'name');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ org_access: { all_orgs: true, roles: ['SUPER_ADMIN'] } }),
    );
  });

  it('forwards a lookup error to next', async () => {
    const error = new Error('boom');
    (Organization.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(error) }),
    });
    const req = {
      user: { id: 'user-1', email: 'x@example.com' },
      orgAccess: { allOrgs: false, orgIds: [], roles: [] },
    } as unknown as Request;
    const next = jest.fn();

    await getMeHandler(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
