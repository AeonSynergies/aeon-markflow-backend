import { Types } from 'mongoose';
import { ReviewTask } from '../../src/models/ReviewTask.model';

describe('ReviewTask model', () => {
  it('requires org_id and email_template_version_id', () => {
    const doc = new ReviewTask({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.email_template_version_id).toBeDefined();
  });

  it('defaults status to OPEN and reviewer fields to null', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('OPEN');
    expect(doc.reviewed_by).toBeNull();
    expect(doc.reviewed_at).toBeNull();
  });

  it('rejects an unknown status', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
      status: 'IN_PROGRESS',
    });
    expect(doc.validateSync()?.errors.status).toBeDefined();
  });
});
