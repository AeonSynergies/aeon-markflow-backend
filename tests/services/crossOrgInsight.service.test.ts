jest.mock('../../src/models/CrossOrgInsight.model', () => ({
  CrossOrgInsight: { findOneAndUpdate: jest.fn(), find: jest.fn() },
}));
jest.mock('../../src/models/SendTimePerformance.model', () => ({ SendTimePerformance: { find: jest.fn() } }));
jest.mock('../../src/models/WorkflowTemplate.model', () => ({ WorkflowTemplate: { find: jest.fn() } }));

import { CrossOrgInsight } from '../../src/models/CrossOrgInsight.model';
import { SendTimePerformance } from '../../src/models/SendTimePerformance.model';
import { WorkflowTemplate } from '../../src/models/WorkflowTemplate.model';
import {
  computeCrossOrgInsights,
  listGenericCrossOrgInsights,
  listRawCrossOrgInsights,
} from '../../src/services/crossOrgInsight.service';

function template(orgId: string, workflowType: string | null, stepKinds: string[]) {
  return {
    org_id: { toString: () => orgId },
    workflow_type: workflowType,
    steps: stepKinds.map((kind) => ({ kind })),
  };
}

function selectable(value: unknown[]) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

describe('crossOrgInsight.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('computeCrossOrgInsights', () => {
    beforeEach(() => {
      (SendTimePerformance.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    });

    it('creates a sequence_shape insight once the same shape is observed across enough distinct orgs', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectable([
          template('org-1', 'cold_outreach', ['email', 'wait', 'email']),
          template('org-2', 'cold_outreach', ['email', 'wait', 'email']),
          template('org-3', 'cold_outreach', ['email', 'wait', 'email']),
        ]),
      );

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).toHaveBeenCalledWith(
        { insight_type: 'sequence_shape', workflow_type: 'cold_outreach', persona: null, sequence_key: 'email>wait>email' },
        expect.objectContaining({ step_kinds: ['email', 'wait', 'email'], org_count: 3, sample_size: 3 }),
        { upsert: true },
      );
    });

    it('does not create a sequence_shape insight below the minimum org count', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectable([
          template('org-1', 'cold_outreach', ['email', 'wait', 'email']),
          template('org-2', 'cold_outreach', ['email', 'wait', 'email']),
        ]),
      );

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ insight_type: 'sequence_shape' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('the same org contributing multiple templates with the same shape only counts once toward org_count', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectable([
          template('org-1', null, ['email']),
          template('org-1', null, ['email']),
          template('org-2', null, ['email']),
          template('org-3', null, ['email']),
        ]),
      );

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ insight_type: 'sequence_shape' }),
        expect.objectContaining({ org_count: 3, sample_size: 4 }),
        { upsert: true },
      );
    });

    it('creates a step_count insight grouped by workflow_type and step length', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectable([
          template('org-1', 'cold_outreach', ['email', 'wait', 'email']),
          template('org-2', 'cold_outreach', ['call_task', 'wait', 'call_task']),
          template('org-3', 'cold_outreach', ['email', 'email', 'email']),
        ]),
      );

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).toHaveBeenCalledWith(
        { insight_type: 'step_count', workflow_type: 'cold_outreach', persona: null, step_count: 3 },
        expect.objectContaining({ org_count: 3, sample_size: 3 }),
        { upsert: true },
      );
    });

    it('labels a pattern "established" once its sample size clears the threshold, "emerging" otherwise', async () => {
      const manyTemplates = Array.from({ length: 300 }, (_, i) => template(`org-${i % 3}`, null, ['email']));
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(selectable(manyTemplates));

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ insight_type: 'sequence_shape' }),
        expect.objectContaining({ confidence: 'established' }),
        { upsert: true },
      );
    });

    it('creates a sample-size-weighted send_time_window insight across qualifying orgs', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(selectable([]));
      (SendTimePerformance.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            org_id: { toString: () => 'org-1' },
            workflow_type: 'cold_outreach',
            persona: 'fedex_isp',
            day_of_week: 3,
            hour_bucket: 9,
            timezone_bucket: 'America/New_York',
            sample_size: 40,
            reply_rate: 0.2,
            meeting_rate: 0.05,
          },
          {
            org_id: { toString: () => 'org-2' },
            workflow_type: 'cold_outreach',
            persona: 'fedex_isp',
            day_of_week: 3,
            hour_bucket: 9,
            timezone_bucket: 'America/New_York',
            sample_size: 60,
            reply_rate: 0.3,
            meeting_rate: 0.1,
          },
          {
            org_id: { toString: () => 'org-3' },
            workflow_type: 'cold_outreach',
            persona: 'fedex_isp',
            day_of_week: 3,
            hour_bucket: 9,
            timezone_bucket: 'America/New_York',
            sample_size: 40,
            reply_rate: 0.1,
            meeting_rate: 0.02,
          },
        ]),
      });

      await computeCrossOrgInsights();

      // weighted reply = (0.2*40 + 0.3*60 + 0.1*40) / 140 = (8 + 18 + 4) / 140 = 30/140 ≈ 0.2143
      const call = (CrossOrgInsight.findOneAndUpdate as jest.Mock).mock.calls.find(
        ([filter]) => filter.insight_type === 'send_time_window',
      );
      expect(call).toBeDefined();
      const [filter, update, options] = call!;
      expect(filter).toEqual({
        insight_type: 'send_time_window',
        workflow_type: 'cold_outreach',
        persona: 'fedex_isp',
        day_of_week: 3,
        hour_bucket: 9,
        timezone_bucket: 'America/New_York',
      });
      expect(update.org_count).toBe(3);
      expect(update.sample_size).toBe(140);
      expect(update.avg_reply_rate).toBeCloseTo(30 / 140, 5);
      expect(options).toEqual({ upsert: true });
    });

    it('does not create a send_time_window insight below the minimum total sample size', async () => {
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(selectable([]));
      (SendTimePerformance.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { org_id: { toString: () => 'org-1' }, workflow_type: null, persona: null, day_of_week: 1, hour_bucket: 10, timezone_bucket: 'UTC', sample_size: 30, reply_rate: 0.2, meeting_rate: 0 },
          { org_id: { toString: () => 'org-2' }, workflow_type: null, persona: null, day_of_week: 1, hour_bucket: 10, timezone_bucket: 'UTC', sample_size: 30, reply_rate: 0.2, meeting_rate: 0 },
          { org_id: { toString: () => 'org-3' }, workflow_type: null, persona: null, day_of_week: 1, hour_bucket: 10, timezone_bucket: 'UTC', sample_size: 20, reply_rate: 0.2, meeting_rate: 0 },
        ]),
      });

      await computeCrossOrgInsights();

      expect(CrossOrgInsight.findOneAndUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ insight_type: 'send_time_window' }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('listGenericCrossOrgInsights', () => {
    it('maps documents to the generic shape, omitting org_count/sample_size/avg rates', async () => {
      (CrossOrgInsight.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            insight_type: 'send_time_window',
            workflow_type: 'cold_outreach',
            persona: 'fedex_isp',
            day_of_week: 3,
            hour_bucket: 9,
            timezone_bucket: 'America/New_York',
            avg_reply_rate: 0.25,
            avg_meeting_rate: 0.05,
            org_count: 5,
            sample_size: 500,
            confidence: 'established',
          },
        ]),
      });

      const result = await listGenericCrossOrgInsights();

      expect(result).toEqual([
        {
          insightType: 'send_time_window',
          workflowType: 'cold_outreach',
          persona: 'fedex_isp',
          stepKinds: undefined,
          stepCount: undefined,
          dayOfWeek: 3,
          hourBucket: 9,
          timezoneBucket: 'America/New_York',
          confidence: 'established',
        },
      ]);
      expect(result[0]).not.toHaveProperty('orgCount');
      expect(result[0]).not.toHaveProperty('sampleSize');
      expect(result[0]).not.toHaveProperty('avgReplyRate');
    });
  });

  describe('listRawCrossOrgInsights', () => {
    it('returns the full documents unmapped', async () => {
      const docs = [{ insight_type: 'step_count', org_count: 5, sample_size: 20 }];
      (CrossOrgInsight.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) });

      const result = await listRawCrossOrgInsights();

      expect(result).toBe(docs);
    });
  });
});
