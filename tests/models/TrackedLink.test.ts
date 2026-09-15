import { Types } from 'mongoose';
import { TrackedLink } from '../../src/models/TrackedLink.model';

describe('TrackedLink model', () => {
  it('requires org_id and destination_url', () => {
    const doc = new TrackedLink({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.destination_url).toBeDefined();
  });

  it('defaults lead_id and email_template_version_id to null', () => {
    const doc = new TrackedLink({
      org_id: new Types.ObjectId(),
      destination_url: 'https://example.com/book',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.lead_id).toBeNull();
    expect(doc.email_template_version_id).toBeNull();
  });
});
