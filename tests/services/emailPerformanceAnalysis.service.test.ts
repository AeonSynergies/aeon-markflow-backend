jest.mock('../../src/models/DomainSendEvent.model', () => ({ DomainSendEvent: { countDocuments: jest.fn() } }));
jest.mock('../../src/models/EmailEngagement.model', () => ({ EmailEngagement: { countDocuments: jest.fn() } }));
jest.mock('../../src/models/EmailTemplate.model', () => ({ EmailTemplate: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({ EmailTemplateVersion: { findById: jest.fn() } }));
jest.mock('../../src/models/LeadActivity.model', () => ({ LeadActivity: { countDocuments: jest.fn() } }));

import { DomainSendEvent } from '../../src/models/DomainSendEvent.model';
import { EmailEngagement } from '../../src/models/EmailEngagement.model';
import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import { LeadActivity } from '../../src/models/LeadActivity.model';
import {
  computeOpenRateBaseline,
  computeVersionMetrics,
  diagnoseVersion,
} from '../../src/services/emailPerformanceAnalysis.service';

interface VersionCounts {
  sent: number;
  bounced?: number;
  opened?: number;
  clicked?: number;
  replied?: number;
}

/** Wires the four count-based models to a per-version lookup table, keyed by
 * email_template_version_id, matching how computeVersionMetrics actually queries them. */
function mockVersionCounts(table: Record<string, VersionCounts>) {
  (EmailEngagement.countDocuments as jest.Mock).mockImplementation(
    ({ email_template_version_id, opened, clicked }) => {
      const counts = table[email_template_version_id] ?? { sent: 0 };
      if (opened !== undefined) return Promise.resolve(counts.opened ?? 0);
      if (clicked !== undefined) return Promise.resolve(counts.clicked ?? 0);
      return Promise.resolve(counts.sent);
    },
  );
  (DomainSendEvent.countDocuments as jest.Mock).mockImplementation(({ email_template_version_id }) =>
    Promise.resolve(table[email_template_version_id]?.bounced ?? 0),
  );
  (LeadActivity.countDocuments as jest.Mock).mockImplementation(({ email_template_version_id }) =>
    Promise.resolve(table[email_template_version_id]?.replied ?? 0),
  );
}

describe('emailPerformanceAnalysis.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('computeVersionMetrics', () => {
    it('computes rates safely, including a zero-opens denominator', async () => {
      mockVersionCounts({ 'ver-1': { sent: 40, bounced: 2, opened: 0, clicked: 0, replied: 0 } });

      const metrics = await computeVersionMetrics('ver-1');

      expect(metrics).toEqual({
        sentCount: 40,
        bouncedCount: 2,
        openedCount: 0,
        clickedCount: 0,
        repliedCount: 0,
        bounceRate: 0.05,
        openRate: 0,
        clickThroughRate: 0,
        replyRateAmongClickers: 0,
      });
    });
  });

  describe('computeOpenRateBaseline', () => {
    it('returns null when fewer than the minimum comparable versions qualify', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { current_version_id: { toString: () => 'ver-2' } },
          { current_version_id: { toString: () => 'ver-3' } },
        ]),
      });
      mockVersionCounts({
        'ver-2': { sent: 40, opened: 10 },
        'ver-3': { sent: 40, opened: 10 },
      });

      const baseline = await computeOpenRateBaseline('org-1', 'ver-1');
      expect(baseline).toBeNull();
    });

    it('averages open rate across qualifying versions, excluding the one being diagnosed', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { current_version_id: { toString: () => 'ver-1' } }, // excluded — this is the target
          { current_version_id: { toString: () => 'ver-2' } },
          { current_version_id: { toString: () => 'ver-3' } },
          { current_version_id: { toString: () => 'ver-4' } },
          { current_version_id: { toString: () => 'ver-5' } }, // below sample floor — excluded
        ]),
      });
      mockVersionCounts({
        'ver-1': { sent: 100, opened: 5 },
        'ver-2': { sent: 40, opened: 20 }, // 50%
        'ver-3': { sent: 40, opened: 12 }, // 30%
        'ver-4': { sent: 40, opened: 16 }, // 40%
        'ver-5': { sent: 5, opened: 5 }, // 100%, but sample too small
      });

      const baseline = await computeOpenRateBaseline('org-1', 'ver-1');

      expect(baseline?.comparableVersionCount).toBe(3);
      expect(baseline?.averageOpenRate).toBeCloseTo(0.4);
    });
  });

  describe('diagnoseVersion', () => {
    beforeEach(() => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ email_template_id: 'tpl-1' }),
      });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' } }),
      });
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
    });

    it('returns null below the minimum sample size', async () => {
      mockVersionCounts({ 'ver-1': { sent: 10 } });
      await expect(diagnoseVersion('ver-1')).resolves.toBeNull();
    });

    it('returns null when the version does not exist', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(diagnoseVersion('missing')).resolves.toBeNull();
    });

    it('diagnoses high_bounce_rate first, ahead of every other check', async () => {
      mockVersionCounts({ 'ver-1': { sent: 100, bounced: 5, opened: 0 } }); // 5% bounce, 0% open
      const diagnosis = await diagnoseVersion('ver-1');
      expect(diagnosis?.symptom).toBe('high_bounce_rate');
    });

    it('diagnoses low_open_rate when a trustworthy baseline exists and this version is well below it', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { current_version_id: { toString: () => 'ver-2' } },
          { current_version_id: { toString: () => 'ver-3' } },
          { current_version_id: { toString: () => 'ver-4' } },
        ]),
      });
      mockVersionCounts({
        'ver-1': { sent: 100, bounced: 0, opened: 10 }, // 10% open
        'ver-2': { sent: 40, opened: 16 }, // 40%
        'ver-3': { sent: 40, opened: 16 },
        'ver-4': { sent: 40, opened: 16 },
      });

      const diagnosis = await diagnoseVersion('ver-1');
      expect(diagnosis?.symptom).toBe('low_open_rate');
    });

    it('does not diagnose low_open_rate when there is no trustworthy baseline yet', async () => {
      mockVersionCounts({ 'ver-1': { sent: 100, bounced: 0, opened: 1, clicked: 0 } });
      const diagnosis = await diagnoseVersion('ver-1');
      // Falls through past the (unavailable) baseline check; clicked/opened both too small for
      // the next checks to fire either, so nothing is diagnosable yet.
      expect(diagnosis).toBeNull();
    });

    it('diagnoses no_click_through when opened enough but rarely clicked', async () => {
      mockVersionCounts({ 'ver-1': { sent: 100, bounced: 0, opened: 50, clicked: 1 } }); // 2% CTR
      const diagnosis = await diagnoseVersion('ver-1');
      expect(diagnosis?.symptom).toBe('no_click_through');
    });

    it('diagnoses no_reply_after_click when clicked enough but rarely replied', async () => {
      mockVersionCounts({
        'ver-1': { sent: 100, bounced: 0, opened: 50, clicked: 20, replied: 0 },
      });
      const diagnosis = await diagnoseVersion('ver-1');
      expect(diagnosis?.symptom).toBe('no_reply_after_click');
    });

    it('returns null when every funnel stage looks healthy', async () => {
      mockVersionCounts({
        'ver-1': { sent: 100, bounced: 0, opened: 50, clicked: 20, replied: 5 },
      });
      const diagnosis = await diagnoseVersion('ver-1');
      expect(diagnosis).toBeNull();
    });
  });
});
