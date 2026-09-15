jest.mock('../../src/models/Organization.model', () => ({ Organization: { find: jest.fn() } }));
jest.mock('../../src/models/ReviewTask.model', () => ({
  ReviewTask: { create: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/SendTimePerformance.model', () => ({ SendTimePerformance: { find: jest.fn() } }));
jest.mock('../../src/models/SendTimeRecommendation.model', () => ({
  SendTimeRecommendation: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
}));
jest.mock('../../src/services/internalNotification.service', () => ({ sendInternalNotification: jest.fn() }));
jest.mock('../../src/services/sendTimePerformance.service', () => ({ computeSendTimeRollups: jest.fn() }));

import { Organization } from '../../src/models/Organization.model';
import { ReviewTask } from '../../src/models/ReviewTask.model';
import { SendTimePerformance } from '../../src/models/SendTimePerformance.model';
import { SendTimeRecommendation } from '../../src/models/SendTimeRecommendation.model';
import {
  InvalidSendTimeRecommendationTransitionError,
  SendTimeRecommendationNotFoundError,
  approveSendTimeRecommendation,
  getActiveSendTimeRecommendation,
  rejectSendTimeRecommendation,
  runSendTimeOptimization,
} from '../../src/services/sendTimeOptimization.service';
import { UnauthorizedApproverRoleError } from '../../src/services/emailTemplateVersion.service';
import { sendInternalNotification } from '../../src/services/internalNotification.service';
import { computeSendTimeRollups } from '../../src/services/sendTimePerformance.service';

function bucket(overrides: Record<string, unknown> = {}) {
  return {
    day_of_week: 3,
    hour_bucket: 9,
    timezone_bucket: 'America/New_York',
    content_variant_id: { toString: () => 'ver-1' },
    sent_count: 40,
    reply_rate: 0.2,
    meeting_rate: 0.05,
    sample_size: 40,
    ...overrides,
  };
}

describe('sendTimeOptimization.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getActiveSendTimeRecommendation', () => {
    it('queries for the APPROVED recommendation matching the group', async () => {
      const lean = jest.fn().mockResolvedValue({ _id: 'rec-1' });
      (SendTimeRecommendation.findOne as jest.Mock).mockReturnValue({ lean });

      const result = await getActiveSendTimeRecommendation('org-1', 'cold_outreach', 'fedex_isp');

      expect(SendTimeRecommendation.findOne).toHaveBeenCalledWith({
        org_id: 'org-1',
        workflow_type: 'cold_outreach',
        persona: 'fedex_isp',
        status: 'APPROVED',
      });
      expect(result).toEqual({ _id: 'rec-1' });
    });
  });

  describe('runSendTimeOptimization', () => {
    beforeEach(() => {
      (computeSendTimeRollups as jest.Mock).mockResolvedValue({ engagementsScanned: 10, bucketsUpserted: 3 });
    });

    it('recomputes rollups first, and skips orgs on manual strategy entirely', async () => {
      (Organization.find as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });

      const summary = await runSendTimeOptimization();

      expect(computeSendTimeRollups).toHaveBeenCalled();
      expect(Organization.find).toHaveBeenCalledWith({ send_time_strategy: { $ne: 'manual' } });
      expect(summary).toEqual({
        rollup: { engagementsScanned: 10, bucketsUpserted: 3 },
        groupsEvaluated: 0,
        recommendationsCreated: 0,
      });
    });

    it('skips a group with fewer than the minimum candidate buckets', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_suggested' }]),
      });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: 'cold_outreach', persona: 'fedex_isp' }]),
        })
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([bucket(), bucket()]) }); // only 2, need 3

      const summary = await runSendTimeOptimization();

      expect(summary.groupsEvaluated).toBe(1);
      expect(summary.recommendationsCreated).toBe(0);
      expect(SendTimeRecommendation.create).not.toHaveBeenCalled();
    });

    it('creates an ai_suggested recommendation + ReviewTask + notification for a first trustworthy combination', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_suggested' }]),
      });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: 'cold_outreach', persona: 'fedex_isp' }]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([bucket({ reply_rate: 0.3 }), bucket({ reply_rate: 0.1 }), bucket({ reply_rate: 0.2 })]),
        });
      (SendTimeRecommendation.findOne as jest.Mock)
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }) // no current approved
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }); // no pending
      (SendTimeRecommendation.create as jest.Mock).mockResolvedValue({ _id: 'rec-1' });

      const summary = await runSendTimeOptimization();

      expect(SendTimeRecommendation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: 'org-1',
          workflow_type: 'cold_outreach',
          persona: 'fedex_isp',
          generation_source: 'ai_suggested',
          status: 'OPEN',
        }),
      );
      expect(ReviewTask.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        kind: 'send_time_recommendation',
        send_time_recommendation_id: 'rec-1',
        status: 'OPEN',
      });
      expect(sendInternalNotification).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('pending review') }),
      );
      expect(summary.recommendationsCreated).toBe(1);
    });

    it('creates an ai_automatic recommendation directly APPROVED, superseding the prior one, with no ReviewTask', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_automatic' }]),
      });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: null, persona: null }]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([
            bucket({ reply_rate: 0.4, hour_bucket: 10 }),
            bucket({ reply_rate: 0.1 }),
            bucket({ reply_rate: 0.15 }),
          ]),
        });
      (SendTimeRecommendation.findOne as jest.Mock)
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({
            day_of_week: 3,
            hour_bucket: 9,
            timezone_bucket: 'America/New_York',
            content_variant_id: { toString: () => 'ver-1' },
            metrics: { reply_rate: 0.1, meeting_rate: 0.02, sent_count: 40, sample_size: 40 },
          }),
        }) // current approved, much worse than the new best (0.4 vs 0.1)
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }); // no pending suggestion
      (SendTimeRecommendation.create as jest.Mock).mockResolvedValue({ _id: 'rec-2' });

      const summary = await runSendTimeOptimization();

      expect(SendTimeRecommendation.create).toHaveBeenCalledWith(
        expect.objectContaining({ generation_source: 'ai_automatic', status: 'APPROVED' }),
      );
      expect(SendTimeRecommendation.updateMany).toHaveBeenCalledWith(
        { org_id: 'org-1', workflow_type: null, persona: null, status: 'APPROVED', _id: { $ne: 'rec-2' } },
        { status: 'SUPERSEDED' },
      );
      expect(ReviewTask.create).not.toHaveBeenCalled();
      expect(sendInternalNotification).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('applied automatically') }),
      );
      expect(summary.recommendationsCreated).toBe(1);
    });

    it('does nothing when the best bucket is already the currently-approved one', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_suggested' }]),
      });
      const sameBucket = bucket({ reply_rate: 0.3 });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: 'cold_outreach', persona: 'fedex_isp' }]),
        })
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([sameBucket, bucket({ reply_rate: 0.1 }), bucket({ reply_rate: 0.05 })]) });
      (SendTimeRecommendation.findOne as jest.Mock).mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          day_of_week: sameBucket.day_of_week,
          hour_bucket: sameBucket.hour_bucket,
          timezone_bucket: sameBucket.timezone_bucket,
          content_variant_id: sameBucket.content_variant_id,
          metrics: { reply_rate: 0.3 },
        }),
      });

      const summary = await runSendTimeOptimization();

      expect(SendTimeRecommendation.create).not.toHaveBeenCalled();
      expect(summary.recommendationsCreated).toBe(0);
    });

    it('does nothing when the improvement over the current approved bucket is below the margin', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_suggested' }]),
      });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: 'cold_outreach', persona: 'fedex_isp' }]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([
            bucket({ reply_rate: 0.205, hour_bucket: 11 }),
            bucket({ reply_rate: 0.1 }),
            bucket({ reply_rate: 0.05 }),
          ]),
        });
      (SendTimeRecommendation.findOne as jest.Mock).mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          day_of_week: 3,
          hour_bucket: 9,
          timezone_bucket: 'America/New_York',
          content_variant_id: { toString: () => 'ver-2' },
          metrics: { reply_rate: 0.2 },
        }),
      }); // only ~2.5% relative improvement, below the 10% margin

      const summary = await runSendTimeOptimization();

      expect(SendTimeRecommendation.create).not.toHaveBeenCalled();
      expect(summary.recommendationsCreated).toBe(0);
    });

    it('does nothing when a suggestion is already pending for the group', async () => {
      (Organization.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => 'org-1' }, send_time_strategy: 'ai_suggested' }]),
      });
      (SendTimePerformance.find as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ workflow_type: 'cold_outreach', persona: 'fedex_isp' }]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([bucket({ reply_rate: 0.3 }), bucket({ reply_rate: 0.1 }), bucket({ reply_rate: 0.05 })]),
        });
      (SendTimeRecommendation.findOne as jest.Mock)
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }) // no current approved
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: 'already-pending' }) }); // already OPEN

      const summary = await runSendTimeOptimization();

      expect(SendTimeRecommendation.create).not.toHaveBeenCalled();
      expect(summary.recommendationsCreated).toBe(0);
    });
  });

  describe('approveSendTimeRecommendation', () => {
    it('rejects a non-approver role', async () => {
      await expect(approveSendTimeRecommendation('rec-1', 'user-1', 'BD_SDR' as never)).rejects.toBeInstanceOf(
        UnauthorizedApproverRoleError,
      );
      expect(SendTimeRecommendation.findById).not.toHaveBeenCalled();
    });

    it('throws when the recommendation does not exist', async () => {
      (SendTimeRecommendation.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(approveSendTimeRecommendation('missing', 'user-1', 'ADMIN')).rejects.toBeInstanceOf(
        SendTimeRecommendationNotFoundError,
      );
    });

    it('throws when the recommendation is not OPEN', async () => {
      (SendTimeRecommendation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
      });
      await expect(approveSendTimeRecommendation('rec-1', 'user-1', 'ADMIN')).rejects.toBeInstanceOf(
        InvalidSendTimeRecommendationTransitionError,
      );
    });

    it('approves, supersedes the prior approved recommendation, and resolves the ReviewTask', async () => {
      (SendTimeRecommendation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: 'rec-1',
          status: 'OPEN',
          org_id: { toString: () => 'org-1' },
          workflow_type: 'cold_outreach',
          persona: 'fedex_isp',
        }),
      });
      (SendTimeRecommendation.findByIdAndUpdate as jest.Mock).mockResolvedValue({ _id: 'rec-1', status: 'APPROVED' });

      const result = await approveSendTimeRecommendation('rec-1', 'user-1', 'ADMIN');

      expect(SendTimeRecommendation.findByIdAndUpdate).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: 'APPROVED', reviewed_by: 'user-1' }),
        { new: true },
      );
      expect(SendTimeRecommendation.updateMany).toHaveBeenCalledWith(
        { org_id: 'org-1', workflow_type: 'cold_outreach', persona: 'fedex_isp', status: 'APPROVED', _id: { $ne: 'rec-1' } },
        { status: 'SUPERSEDED' },
      );
      expect(ReviewTask.findOneAndUpdate).toHaveBeenCalledWith(
        { send_time_recommendation_id: 'rec-1', status: 'OPEN' },
        expect.objectContaining({ status: 'APPROVED', reviewed_by: 'user-1' }),
      );
      expect(result).toEqual({ _id: 'rec-1', status: 'APPROVED' });
    });
  });

  describe('rejectSendTimeRecommendation', () => {
    it('rejects a non-approver role', async () => {
      await expect(rejectSendTimeRecommendation('rec-1', 'user-1', 'BD_SDR' as never)).rejects.toBeInstanceOf(
        UnauthorizedApproverRoleError,
      );
    });

    it('throws when the recommendation is not OPEN', async () => {
      (SendTimeRecommendation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: 'REJECTED' }),
      });
      await expect(rejectSendTimeRecommendation('rec-1', 'user-1', 'ADMIN')).rejects.toBeInstanceOf(
        InvalidSendTimeRecommendationTransitionError,
      );
    });

    it('rejects and resolves the ReviewTask', async () => {
      (SendTimeRecommendation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'rec-1', status: 'OPEN' }),
      });
      (SendTimeRecommendation.findByIdAndUpdate as jest.Mock).mockResolvedValue({ _id: 'rec-1', status: 'REJECTED' });

      const result = await rejectSendTimeRecommendation('rec-1', 'user-1', 'ADMIN');

      expect(SendTimeRecommendation.findByIdAndUpdate).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: 'REJECTED', reviewed_by: 'user-1' }),
        { new: true },
      );
      expect(ReviewTask.findOneAndUpdate).toHaveBeenCalledWith(
        { send_time_recommendation_id: 'rec-1', status: 'OPEN' },
        expect.objectContaining({ status: 'REJECTED' }),
      );
      expect(result).toEqual({ _id: 'rec-1', status: 'REJECTED' });
    });
  });
});
