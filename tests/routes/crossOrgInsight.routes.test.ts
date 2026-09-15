import type { Request, Response } from 'express';

jest.mock('../../src/services/crossOrgInsight.service', () => ({
  listGenericCrossOrgInsights: jest.fn(),
  listRawCrossOrgInsights: jest.fn(),
}));

import { listCrossOrgInsightsHandler, listRawCrossOrgInsightsHandler } from '../../src/routes/crossOrgInsight.routes';
import { listGenericCrossOrgInsights, listRawCrossOrgInsights } from '../../src/services/crossOrgInsight.service';

function mockRes() {
  const res: Partial<Response> = { json: jest.fn().mockReturnThis() };
  return res as Response;
}

describe('crossOrgInsight.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listCrossOrgInsightsHandler', () => {
    it('maps the generic insight list to the response DTO shape', async () => {
      (listGenericCrossOrgInsights as jest.Mock).mockResolvedValue([
        {
          insightType: 'send_time_window',
          workflowType: 'cold_outreach',
          persona: 'fedex_isp',
          dayOfWeek: 3,
          hourBucket: 9,
          timezoneBucket: 'America/New_York',
          confidence: 'established',
        },
      ]);
      const req = {} as Request;
      const res = mockRes();
      const next = jest.fn();

      await listCrossOrgInsightsHandler(req, res, next);

      expect(res.json).toHaveBeenCalledWith([
        {
          insight_type: 'send_time_window',
          workflow_type: 'cold_outreach',
          persona: 'fedex_isp',
          step_kinds: undefined,
          step_count: undefined,
          day_of_week: 3,
          hour_bucket: 9,
          timezone_bucket: 'America/New_York',
          confidence: 'established',
        },
      ]);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (listGenericCrossOrgInsights as jest.Mock).mockRejectedValue(error);
      const req = {} as Request;
      const res = mockRes();
      const next = jest.fn();

      await listCrossOrgInsightsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('listRawCrossOrgInsightsHandler', () => {
    it('returns the raw documents, including org_count/sample_size', async () => {
      (listRawCrossOrgInsights as jest.Mock).mockResolvedValue([
        { insight_type: 'step_count', step_count: 4, org_count: 5, sample_size: 20, confidence: 'emerging' },
      ]);
      const req = {} as Request;
      const res = mockRes();
      const next = jest.fn();

      await listRawCrossOrgInsightsHandler(req, res, next);

      expect(res.json).toHaveBeenCalledWith([
        { insight_type: 'step_count', step_count: 4, org_count: 5, sample_size: 20, confidence: 'emerging' },
      ]);
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (listRawCrossOrgInsights as jest.Mock).mockRejectedValue(error);
      const req = {} as Request;
      const res = mockRes();
      const next = jest.fn();

      await listRawCrossOrgInsightsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
