import { Types } from 'mongoose';
import { LinkClick } from '../../src/models/LinkClick.model';

describe('LinkClick model', () => {
  it('requires tracked_link_id', () => {
    const doc = new LinkClick({});
    const err = doc.validateSync();
    expect(err?.errors.tracked_link_id).toBeDefined();
  });

  it('defaults clicked_at to now', () => {
    const doc = new LinkClick({ tracked_link_id: new Types.ObjectId() });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.clicked_at).toBeInstanceOf(Date);
  });
});
