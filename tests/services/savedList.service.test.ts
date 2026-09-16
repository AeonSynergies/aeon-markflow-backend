jest.mock('../../src/models/Lead.model', () => ({ Lead: { find: jest.fn() } }));
jest.mock('../../src/models/SavedList.model', () => ({
  SavedList: { create: jest.fn(), find: jest.fn(), findById: jest.fn() },
}));

import { Lead } from '../../src/models/Lead.model';
import { SavedList } from '../../src/models/SavedList.model';
import {
  SavedListNotFoundError,
  addLeadsToSavedList,
  createSavedList,
  getSavedList,
  listSavedListsForOrg,
} from '../../src/services/savedList.service';

const LEAD_1 = '507f1f77bcf86cd799439011';
const LEAD_2 = '507f1f77bcf86cd799439012';
const LEAD_3 = '507f1f77bcf86cd799439013';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('savedList.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createSavedList', () => {
    it('seeds the list with only the lead ids that resolve to a Lead in this org', async () => {
      (Lead.find as jest.Mock).mockReturnValue(lean([{ _id: { toString: () => LEAD_1 } }]));
      (SavedList.create as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'list-1' },
        org_id: { toString: () => 'org-1' },
        name: 'Q1 cold list',
        lead_ids: [LEAD_1],
        created_by: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      });

      const result = await createSavedList('org-1', 'Q1 cold list', [LEAD_1, LEAD_2], 'user-1');

      expect(Lead.find).toHaveBeenCalledWith({ _id: { $in: [LEAD_1, LEAD_2] }, org_id: 'org-1' }, '_id');
      expect(SavedList.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        name: 'Q1 cold list',
        lead_ids: [LEAD_1],
        created_by: 'user-1',
      });
      expect(result.addedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
    });

    it('creates an empty list without querying Lead when no lead ids are given', async () => {
      (SavedList.create as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'list-1' },
        org_id: { toString: () => 'org-1' },
        name: 'Empty list',
        lead_ids: [],
        created_by: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await createSavedList('org-1', 'Empty list');

      expect(Lead.find).not.toHaveBeenCalled();
      expect(SavedList.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        name: 'Empty list',
        lead_ids: [],
        created_by: null,
      });
    });
  });

  describe('listSavedListsForOrg', () => {
    it('lists and summarizes SavedLists for an org', async () => {
      (SavedList.find as jest.Mock).mockReturnValue(
        sortLean([
          {
            _id: { toString: () => 'list-1' },
            org_id: { toString: () => 'org-1' },
            name: 'Q1',
            lead_ids: [LEAD_1, LEAD_2],
            created_by: { toString: () => 'user-1' },
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      );

      const result = await listSavedListsForOrg('org-1');

      expect(SavedList.find).toHaveBeenCalledWith({ org_id: 'org-1' });
      expect(result).toEqual([
        {
          savedListId: 'list-1',
          orgId: 'org-1',
          name: 'Q1',
          leadCount: 2,
          createdBy: 'user-1',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ]);
    });
  });

  describe('getSavedList', () => {
    it('throws SavedListNotFoundError when missing', async () => {
      (SavedList.findById as jest.Mock).mockResolvedValue(null);
      await expect(getSavedList('missing')).rejects.toThrow(SavedListNotFoundError);
    });

    it('returns the document when found', async () => {
      const doc = { _id: 'list-1' };
      (SavedList.findById as jest.Mock).mockResolvedValue(doc);
      await expect(getSavedList('list-1')).resolves.toBe(doc);
    });
  });

  describe('addLeadsToSavedList', () => {
    it('adds only new, org-scoped lead ids and dedupes against existing membership', async () => {
      const leadIds: { toString(): string }[] = [{ toString: () => LEAD_1 }];
      (leadIds as unknown as { push: jest.Mock }).push = jest.fn((...items) =>
        Array.prototype.push.apply(leadIds, items),
      );
      const savedListDoc = {
        _id: { toString: () => 'list-1' },
        org_id: { toString: () => 'org-1' },
        name: 'Q1',
        lead_ids: leadIds,
        created_by: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      (SavedList.findById as jest.Mock).mockResolvedValue(savedListDoc);
      (Lead.find as jest.Mock).mockReturnValue(
        lean([{ _id: { toString: () => LEAD_2 } }, { _id: { toString: () => LEAD_1 } }]),
      );

      const result = await addLeadsToSavedList('list-1', [LEAD_1, LEAD_2, LEAD_3]);

      expect(Lead.find).toHaveBeenCalledWith({ _id: { $in: [LEAD_1, LEAD_2, LEAD_3] }, org_id: 'org-1' }, '_id');
      expect(savedListDoc.save).toHaveBeenCalled();
      // LEAD_2 is newly added; LEAD_1 was already a member; LEAD_3 doesn't belong to this org.
      expect(result.addedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
    });

    it('propagates SavedListNotFoundError when the list does not exist', async () => {
      (SavedList.findById as jest.Mock).mockResolvedValue(null);
      await expect(addLeadsToSavedList('missing', [LEAD_1])).rejects.toThrow(SavedListNotFoundError);
    });
  });
});
