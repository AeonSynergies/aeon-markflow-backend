jest.mock('../../src/models/ReviewTask.model', () => ({
  ReviewTask: { find: jest.fn() },
}));

import { ReviewTask } from '../../src/models/ReviewTask.model';
import { listReviewTasksForOrg } from '../../src/services/reviewTask.service';

function sorted(value: unknown) {
  return { sort: jest.fn().mockResolvedValue(value) };
}

describe('reviewTask.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listReviewTasksForOrg', () => {
    it('defaults to status OPEN with no kind filter', async () => {
      (ReviewTask.find as jest.Mock).mockReturnValue(sorted([{ _id: 'task-1' }]));

      const result = await listReviewTasksForOrg('org-1');

      expect(ReviewTask.find).toHaveBeenCalledWith({ org_id: 'org-1', status: 'OPEN' });
      expect(result).toEqual([{ _id: 'task-1' }]);
    });

    it('passes an explicit status through instead of defaulting', async () => {
      (ReviewTask.find as jest.Mock).mockReturnValue(sorted([]));

      await listReviewTasksForOrg('org-1', { status: 'APPROVED' });

      expect(ReviewTask.find).toHaveBeenCalledWith({ org_id: 'org-1', status: 'APPROVED' });
    });

    it('adds a kind filter when given', async () => {
      (ReviewTask.find as jest.Mock).mockReturnValue(sorted([]));

      await listReviewTasksForOrg('org-1', { kind: 'domain_guardrail' });

      expect(ReviewTask.find).toHaveBeenCalledWith({
        org_id: 'org-1',
        status: 'OPEN',
        kind: 'domain_guardrail',
      });
    });

    it('sorts newest first', async () => {
      const sortMock = jest.fn().mockResolvedValue([]);
      (ReviewTask.find as jest.Mock).mockReturnValue({ sort: sortMock });

      await listReviewTasksForOrg('org-1');

      expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });
});
