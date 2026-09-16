import type { Request, Response } from 'express';

jest.mock('../../src/services/reviewTask.service', () => ({
  listReviewTasksForOrg: jest.fn(),
}));

import { listReviewTasksForOrg } from '../../src/services/reviewTask.service';
import { listReviewTasksHandler } from '../../src/routes/reviewTask.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('reviewTask.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listReviewTasksHandler', () => {
    it('lists tasks for the org param with no filters when none are given', async () => {
      (listReviewTasksForOrg as jest.Mock).mockResolvedValue([{ _id: 'task-1' }]);
      const req = { params: { orgId: 'org-1' }, query: {} } as unknown as Request;
      const res = mockRes();

      await listReviewTasksHandler(req, res, jest.fn());

      expect(listReviewTasksForOrg).toHaveBeenCalledWith('org-1', { status: undefined, kind: undefined });
      expect(res.json).toHaveBeenCalledWith([{ _id: 'task-1' }]);
    });

    it('parses status and kind query filters', async () => {
      (listReviewTasksForOrg as jest.Mock).mockResolvedValue([]);
      const req = {
        params: { orgId: 'org-1' },
        query: { status: 'REJECTED', kind: 'domain_guardrail' },
      } as unknown as Request;
      const res = mockRes();

      await listReviewTasksHandler(req, res, jest.fn());

      expect(listReviewTasksForOrg).toHaveBeenCalledWith('org-1', { status: 'REJECTED', kind: 'domain_guardrail' });
    });

    it('ignores an invalid status or kind value', async () => {
      (listReviewTasksForOrg as jest.Mock).mockResolvedValue([]);
      const req = {
        params: { orgId: 'org-1' },
        query: { status: 'not-a-real-status', kind: 'not-a-real-kind' },
      } as unknown as Request;
      const res = mockRes();

      await listReviewTasksHandler(req, res, jest.fn());

      expect(listReviewTasksForOrg).toHaveBeenCalledWith('org-1', { status: undefined, kind: undefined });
    });
  });
});
