import { Types } from 'mongoose';
import { SavedList } from '../../src/models/SavedList.model';

describe('SavedList model', () => {
  it('requires org_id and name', () => {
    const doc = new SavedList({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.name).toBeDefined();
  });

  it('defaults lead_ids to empty and created_by to null', () => {
    const doc = new SavedList({ org_id: new Types.ObjectId(), name: 'Q1 cold list' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.lead_ids).toEqual([]);
    expect(doc.created_by).toBeNull();
  });

  it('accepts a populated list of lead ids', () => {
    const doc = new SavedList({
      org_id: new Types.ObjectId(),
      name: 'Q1 cold list',
      lead_ids: [new Types.ObjectId(), new Types.ObjectId()],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.lead_ids).toHaveLength(2);
  });
});
