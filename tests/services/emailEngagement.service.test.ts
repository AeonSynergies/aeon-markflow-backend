jest.mock('../../src/models/EmailEngagement.model', () => ({
  EmailEngagement: { create: jest.fn(), findById: jest.fn(), findOne: jest.fn() },
}));

import { EmailEngagement } from '../../src/models/EmailEngagement.model';
import {
  createEngagementRecord,
  recordClickForEngagement,
  recordOpen,
} from '../../src/services/emailEngagement.service';

describe('emailEngagement.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createEngagementRecord', () => {
    it('persists a new per-send row', async () => {
      const sentAt = new Date('2026-01-01');
      await createEngagementRecord({
        orgId: 'org-1',
        leadId: 'lead-1',
        emailTemplateVersionId: 'ver-1',
        enrollmentId: 'enr-1',
        workflowStepIndex: 2,
        sentAt,
      });

      expect(EmailEngagement.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        lead_id: 'lead-1',
        email_template_version_id: 'ver-1',
        enrollment_id: 'enr-1',
        workflow_step_index: 2,
        sent_at: sentAt,
      });
    });
  });

  describe('recordOpen', () => {
    it('marks opened, increments open_count, and sets first/last_opened_at on the first open', async () => {
      const doc = {
        opened: false,
        open_count: 0,
        first_opened_at: null as Date | null,
        last_opened_at: null as Date | null,
        save: jest.fn().mockResolvedValue(undefined),
      };
      (EmailEngagement.findById as jest.Mock).mockResolvedValue(doc);

      await recordOpen('engagement-1');

      expect(doc.opened).toBe(true);
      expect(doc.open_count).toBe(1);
      expect(doc.first_opened_at).toBeInstanceOf(Date);
      expect(doc.last_opened_at).toBeInstanceOf(Date);
      expect(doc.save).toHaveBeenCalled();
    });

    it('leaves first_opened_at alone but bumps the count and last_opened_at on a repeat open', async () => {
      const firstOpen = new Date('2026-01-01');
      const doc = {
        opened: true,
        open_count: 1,
        first_opened_at: firstOpen,
        last_opened_at: firstOpen,
        save: jest.fn().mockResolvedValue(undefined),
      };
      (EmailEngagement.findById as jest.Mock).mockResolvedValue(doc);

      await recordOpen('engagement-1');

      expect(doc.open_count).toBe(2);
      expect(doc.first_opened_at).toBe(firstOpen);
      expect(doc.last_opened_at).not.toBe(firstOpen);
    });

    it('does nothing when the engagement record does not exist', async () => {
      (EmailEngagement.findById as jest.Mock).mockResolvedValue(null);
      await expect(recordOpen('missing')).resolves.toBeUndefined();
    });
  });

  describe('recordClickForEngagement', () => {
    it('finds the most recent send of this version to this lead and marks it clicked', async () => {
      const doc = {
        clicked: false,
        click_count: 0,
        first_clicked_at: null as Date | null,
        last_clicked_at: null as Date | null,
        save: jest.fn().mockResolvedValue(undefined),
      };
      (EmailEngagement.findOne as jest.Mock).mockReturnValue({ sort: jest.fn().mockResolvedValue(doc) });

      await recordClickForEngagement('lead-1', 'ver-1');

      expect(EmailEngagement.findOne).toHaveBeenCalledWith({ lead_id: 'lead-1', email_template_version_id: 'ver-1' });
      expect(doc.clicked).toBe(true);
      expect(doc.click_count).toBe(1);
      expect(doc.first_clicked_at).toBeInstanceOf(Date);
      expect(doc.save).toHaveBeenCalled();
    });

    it('does nothing when there is no matching engagement record', async () => {
      (EmailEngagement.findOne as jest.Mock).mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
      await expect(recordClickForEngagement('lead-1', 'ver-1')).resolves.toBeUndefined();
    });
  });
});
