jest.mock('../../src/models/EmailEngagement.model', () => ({ EmailEngagement: { find: jest.fn() } }));
jest.mock('../../src/models/LeadActivity.model', () => ({ LeadActivity: { find: jest.fn() } }));
jest.mock('../../src/models/SendTimePerformance.model', () => ({ SendTimePerformance: { findOneAndUpdate: jest.fn() } }));

import { EmailEngagement } from '../../src/models/EmailEngagement.model';
import { LeadActivity } from '../../src/models/LeadActivity.model';
import { SendTimePerformance } from '../../src/models/SendTimePerformance.model';
import { computeSendTimeRollups } from '../../src/services/sendTimePerformance.service';

function selectableFind(returnValue: unknown[]) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(returnValue) }) };
}

function engagement(overrides: Record<string, unknown>) {
  return {
    org_id: { toString: () => 'org-1' },
    enrollment_id: { toString: () => 'enr-1' },
    email_template_version_id: { toString: () => 'ver-1' },
    workflow_type: 'cold_outreach',
    persona: 'fedex_isp',
    day_of_week: 3,
    hour_bucket: 9,
    timezone_bucket: 'America/New_York',
    sent_at: new Date('2026-01-07T14:00:00Z'),
    ...overrides,
  };
}

describe('sendTimePerformance.service computeSendTimeRollups', () => {
  afterEach(() => jest.clearAllMocks());

  it('skips engagements sent before bucket fields existed (null day/hour/timezone)', async () => {
    (EmailEngagement.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue([engagement({ day_of_week: null, hour_bucket: null, timezone_bucket: null })]),
    });
    (LeadActivity.find as jest.Mock).mockReturnValue(selectableFind([]));

    const summary = await computeSendTimeRollups();

    expect(summary).toEqual({ engagementsScanned: 0, bucketsUpserted: 0 });
    expect(SendTimePerformance.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('groups sends into one bucket, attributes a reply and a last-touch meeting, and upserts', async () => {
    const rowA = engagement({ enrollment_id: { toString: () => 'enr-1' }, sent_at: new Date('2026-01-07T14:00:00Z') });
    const rowB = engagement({ enrollment_id: { toString: () => 'enr-2' }, sent_at: new Date('2026-01-14T14:00:00Z') });

    (EmailEngagement.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([rowA, rowB]) });
    (LeadActivity.find as jest.Mock).mockImplementation(({ kind }: { kind: string }) => {
      if (kind === 'email') {
        return selectableFind([
          { enrollment_id: { toString: () => 'enr-1' }, email_template_version_id: { toString: () => 'ver-1' } },
        ]);
      }
      // kind === 'meeting'
      return selectableFind([
        { enrollment_id: { toString: () => 'enr-2' }, occurred_at: new Date('2026-01-15T00:00:00Z') },
      ]);
    });

    const summary = await computeSendTimeRollups();

    expect(summary).toEqual({ engagementsScanned: 2, bucketsUpserted: 1 });
    expect(SendTimePerformance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        org_id: 'org-1',
        workflow_type: 'cold_outreach',
        persona: 'fedex_isp',
        day_of_week: 3,
        hour_bucket: 9,
        timezone_bucket: 'America/New_York',
        content_variant_id: 'ver-1',
      },
      { sent_count: 2, reply_rate: 0.5, meeting_rate: 0.5, sample_size: 2 },
      { upsert: true },
    );
  });

  it('separates buckets by day_of_week/hour_bucket/timezone_bucket/content_variant', async () => {
    const rowA = engagement({ day_of_week: 3 });
    const rowB = engagement({ day_of_week: 4 });

    (EmailEngagement.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([rowA, rowB]) });
    (LeadActivity.find as jest.Mock).mockReturnValue(selectableFind([]));

    const summary = await computeSendTimeRollups();

    expect(summary.bucketsUpserted).toBe(2);
    expect(SendTimePerformance.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not attribute a meeting that occurred before any send in its enrollment', async () => {
    const row = engagement({ sent_at: new Date('2026-01-07T14:00:00Z') });
    (EmailEngagement.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([row]) });
    (LeadActivity.find as jest.Mock).mockImplementation(({ kind }: { kind: string }) => {
      if (kind === 'email') return selectableFind([]);
      return selectableFind([{ enrollment_id: { toString: () => 'enr-1' }, occurred_at: new Date('2026-01-01T00:00:00Z') }]);
    });

    await computeSendTimeRollups();

    expect(SendTimePerformance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meeting_rate: 0 }),
      expect.anything(),
    );
  });
});
