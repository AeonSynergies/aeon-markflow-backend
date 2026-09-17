import type { Request, Response } from 'express';

jest.mock('../../src/services/lead.service', () => ({ listLeadsForOrg: jest.fn() }));

import { listLeadsForOrg } from '../../src/services/lead.service';
import { listLeadsHandler } from '../../src/routes/lead.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

const SAMPLE_LEAD = {
  leadId: 'lead-1',
  orgId: 'org-1',
  contactId: 'contact-1',
  name: 'Jane Doe',
  company: 'Acme DSP',
  email: 'jane@acme.com',
  phone: '+15550001234',
  status: 'NEW-COLD',
  emailDeliverability: 'GOOD',
  phoneDndStatus: false,
  lostReason: null,
  lostStage: null,
  recycledFromDealId: null,
  eligibleForReengagementAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('lead.routes listLeadsHandler', () => {
  afterEach(() => jest.clearAllMocks());

  it('lists leads for the org with no filters when none are given', async () => {
    (listLeadsForOrg as jest.Mock).mockResolvedValue([SAMPLE_LEAD]);
    const req = {
      params: { orgId: 'org-1' },
      query: {},
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_LEAD_GEN'] },
    } as unknown as Request;
    const res = mockRes();

    await listLeadsHandler(req, res, jest.fn());

    expect(listLeadsForOrg).toHaveBeenCalledWith('org-1', {
      status: undefined,
      recycledSegment: false,
      search: undefined,
    });
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        _id: 'lead-1',
        name: 'Jane Doe',
        company: 'Acme DSP',
        status: 'NEW-COLD',
      }),
    ]);
  });

  it('parses a valid status filter and the search query', async () => {
    (listLeadsForOrg as jest.Mock).mockResolvedValue([]);
    const req = {
      params: { orgId: 'org-1' },
      query: { status: 'PROSPECT', search: 'acme' },
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_LEAD_GEN'] },
    } as unknown as Request;
    const res = mockRes();

    await listLeadsHandler(req, res, jest.fn());

    expect(listLeadsForOrg).toHaveBeenCalledWith('org-1', {
      status: 'PROSPECT',
      recycledSegment: false,
      search: 'acme',
    });
  });

  it('ignores an invalid status value', async () => {
    (listLeadsForOrg as jest.Mock).mockResolvedValue([]);
    const req = {
      params: { orgId: 'org-1' },
      query: { status: 'WON' },
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_LEAD_GEN'] },
    } as unknown as Request;
    const res = mockRes();

    await listLeadsHandler(req, res, jest.fn());

    expect(listLeadsForOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ status: undefined }));
  });

  it('allows segment=recycled for a role in RECYCLED_SEGMENT_ROLES', async () => {
    (listLeadsForOrg as jest.Mock).mockResolvedValue([]);
    const req = {
      params: { orgId: 'org-1' },
      query: { segment: 'recycled' },
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_SALES'] },
    } as unknown as Request;
    const res = mockRes();

    await listLeadsHandler(req, res, jest.fn());

    expect(listLeadsForOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ recycledSegment: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('403s segment=recycled for BD-Lead Gen, per the RBAC table, without calling the service', async () => {
    const req = {
      params: { orgId: 'org-1' },
      query: { segment: 'recycled' },
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_LEAD_GEN'] },
    } as unknown as Request;
    const res = mockRes();

    await listLeadsHandler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(listLeadsForOrg).not.toHaveBeenCalled();
  });

  it('forwards a service error to next', async () => {
    const error = new Error('boom');
    (listLeadsForOrg as jest.Mock).mockRejectedValue(error);
    const req = {
      params: { orgId: 'org-1' },
      query: {},
      orgAccess: { allOrgs: false, orgIds: ['org-1'], roles: ['BD_SALES'] },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    await listLeadsHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
