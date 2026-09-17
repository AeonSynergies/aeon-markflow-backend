import type { Request, Response } from 'express';

jest.mock('../../src/services/savedList.service', () => ({
  SavedListNotFoundError: jest.requireActual('../../src/services/savedList.service').SavedListNotFoundError,
  toSavedListSummary: jest.requireActual('../../src/services/savedList.service').toSavedListSummary,
  createSavedList: jest.fn(),
  listSavedListsForOrg: jest.fn(),
  getSavedList: jest.fn(),
  addLeadsToSavedList: jest.fn(),
}));

import {
  SavedListNotFoundError,
  addLeadsToSavedList,
  createSavedList,
  getSavedList,
  listSavedListsForOrg,
} from '../../src/services/savedList.service';
import {
  addLeadsToSavedListHandler,
  createSavedListHandler,
  listSavedListsHandler,
} from '../../src/routes/savedList.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

function savedListDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: { toString: () => 'list-1' },
    org_id: { toString: () => 'org-1' },
    name: 'Q1 cold list',
    lead_ids: [],
    created_by: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('savedList.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createSavedListHandler', () => {
    it('creates the list under the requesting user and returns 201 with the bulk-action summary', async () => {
      (createSavedList as jest.Mock).mockResolvedValue({
        savedList: savedListDoc({ lead_ids: ['lead-1'] }),
        addedCount: 1,
        skippedCount: 1,
      });
      const req = {
        params: { orgId: 'org-1' },
        body: { name: 'Q1 cold list', lead_ids: ['lead-1', 'lead-2'] },
        user: { id: 'user-1', email: 'u@example.com' },
      } as unknown as Request;
      const res = mockRes();

      await createSavedListHandler(req, res, jest.fn());

      expect(createSavedList).toHaveBeenCalledWith('org-1', 'Q1 cold list', ['lead-1', 'lead-2'], 'user-1');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        saved_list: expect.objectContaining({ _id: 'list-1', name: 'Q1 cold list', lead_count: 1 }),
        added_count: 1,
        skipped_count: 1,
      });
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (createSavedList as jest.Mock).mockRejectedValue(error);
      const req = {
        params: { orgId: 'org-1' },
        body: { name: 'x' },
        user: { id: 'user-1', email: 'u@example.com' },
      } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await createSavedListHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('listSavedListsHandler', () => {
    it('lists SavedLists for the org', async () => {
      (listSavedListsForOrg as jest.Mock).mockResolvedValue([
        {
          savedListId: 'list-1',
          orgId: 'org-1',
          name: 'Q1',
          leadCount: 3,
          createdBy: 'user-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await listSavedListsHandler(req, res, jest.fn());

      expect(listSavedListsForOrg).toHaveBeenCalledWith('org-1');
      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ _id: 'list-1', lead_count: 3 })]);
    });
  });

  describe('addLeadsToSavedListHandler', () => {
    it('404s (via next) when the list belongs to a different org', async () => {
      (getSavedList as jest.Mock).mockResolvedValue(savedListDoc({ org_id: { toString: () => 'org-2' } }));
      const req = {
        params: { orgId: 'org-1', savedListId: 'list-1' },
        body: { lead_ids: ['lead-1'] },
      } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await addLeadsToSavedListHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(SavedListNotFoundError));
      expect(addLeadsToSavedList).not.toHaveBeenCalled();
    });

    it('adds the bulk lead selection and returns the updated summary', async () => {
      (getSavedList as jest.Mock).mockResolvedValue(savedListDoc());
      (addLeadsToSavedList as jest.Mock).mockResolvedValue({
        savedList: savedListDoc({ lead_ids: ['lead-1', 'lead-2'] }),
        addedCount: 1,
        skippedCount: 1,
      });
      const req = {
        params: { orgId: 'org-1', savedListId: 'list-1' },
        body: { lead_ids: ['lead-2', 'lead-3'] },
      } as unknown as Request;
      const res = mockRes();

      await addLeadsToSavedListHandler(req, res, jest.fn());

      expect(addLeadsToSavedList).toHaveBeenCalledWith('list-1', ['lead-2', 'lead-3']);
      expect(res.json).toHaveBeenCalledWith({
        saved_list: expect.objectContaining({ _id: 'list-1', lead_count: 2 }),
        added_count: 1,
        skipped_count: 1,
      });
    });

    it('propagates a not-found lookup error to next', async () => {
      const error = new SavedListNotFoundError('missing');
      (getSavedList as jest.Mock).mockRejectedValue(error);
      const req = {
        params: { orgId: 'org-1', savedListId: 'missing' },
        body: { lead_ids: [] },
      } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await addLeadsToSavedListHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
