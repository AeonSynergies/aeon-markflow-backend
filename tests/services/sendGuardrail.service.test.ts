jest.mock('../../src/models/DomainSendEvent.model', () => ({
  DomainSendEvent: { aggregate: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('../../src/models/DomainGuardrailState.model', () => ({
  DomainGuardrailState: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/ReviewTask.model', () => ({
  ReviewTask: { create: jest.fn(), findByIdAndUpdate: jest.fn() },
}));

import { DomainGuardrailState } from '../../src/models/DomainGuardrailState.model';
import { DomainSendEvent } from '../../src/models/DomainSendEvent.model';
import { ReviewTask } from '../../src/models/ReviewTask.model';
import { UnauthorizedApproverRoleError } from '../../src/services/emailTemplateVersion.service';
import {
  canSend,
  getRampCapForDomain,
  pauseDomain,
  recordDeliverabilityEvent,
  recordSend,
  resumeDomain,
} from '../../src/services/sendGuardrail.service';

function lean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

function mockCounts(counts: Partial<Record<'sent' | 'bounced' | 'complained' | 'replied', number>>) {
  (DomainSendEvent.aggregate as jest.Mock).mockResolvedValue(
    Object.entries(counts).map(([kind, count]) => ({ _id: kind, count })),
  );
}

describe('sendGuardrail.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getRampCapForDomain', () => {
    it('returns the starting cap for a domain with no send history', async () => {
      (DomainSendEvent.findOne as jest.Mock).mockReturnValue(lean(null));
      await expect(getRampCapForDomain('new.com')).resolves.toBe(20);
    });

    it('doubles the cap every step interval since the first send', async () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      (DomainSendEvent.findOne as jest.Mock).mockReturnValue(lean({ createdAt: sixDaysAgo }));
      // 6 days / 3-day step interval = 2 steps -> 20 * 2^2 = 80
      await expect(getRampCapForDomain('warming.com')).resolves.toBe(80);
    });

    it('never exceeds the steady-state cap', async () => {
      const wayInThePast = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      (DomainSendEvent.findOne as jest.Mock).mockReturnValue(lean({ createdAt: wayInThePast }));
      await expect(getRampCapForDomain('old.com')).resolves.toBe(2000);
    });
  });

  describe('recordSend / recordDeliverabilityEvent', () => {
    it('records a sent event', async () => {
      await recordSend({ domain: 'x.com', mailbox: 'sales@x.com', orgId: 'org-1', leadId: 'lead-1' });
      expect(DomainSendEvent.create).toHaveBeenCalledWith({
        domain: 'x.com',
        mailbox: 'sales@x.com',
        org_id: 'org-1',
        lead_id: 'lead-1',
        enrollment_id: null,
        kind: 'sent',
      });
    });

    it('records a bounced/complained/replied event', async () => {
      await recordDeliverabilityEvent('x.com', 'sales@x.com', 'org-1', 'bounced', { leadId: 'lead-1' });
      expect(DomainSendEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'x.com', kind: 'bounced', lead_id: 'lead-1' }),
      );
    });
  });

  describe('pauseDomain', () => {
    it('creates a domain_guardrail ReviewTask and upserts a paused state', async () => {
      (DomainGuardrailState.findOne as jest.Mock).mockResolvedValue(null);
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'review-1' });

      await pauseDomain('x.com', 'sales@x.com', 'org-1', 'bounce rate too high');

      expect(ReviewTask.create).toHaveBeenCalledWith(
        expect.objectContaining({ org_id: 'org-1', kind: 'domain_guardrail', domain: 'x.com', status: 'OPEN' }),
      );
      expect(DomainGuardrailState.findOneAndUpdate).toHaveBeenCalledWith(
        { domain: 'x.com' },
        expect.objectContaining({ status: 'paused', paused_reason: 'bounce rate too high', review_task_id: 'review-1' }),
        { upsert: true },
      );
    });

    it('is a no-op when the domain is already paused (no duplicate ReviewTask)', async () => {
      (DomainGuardrailState.findOne as jest.Mock).mockResolvedValue({ status: 'paused' });

      await pauseDomain('x.com', 'sales@x.com', 'org-1', 'still bad');

      expect(ReviewTask.create).not.toHaveBeenCalled();
      expect(DomainGuardrailState.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('resumeDomain', () => {
    it('rejects a role that cannot approve templates', async () => {
      await expect(resumeDomain('x.com', 'user-1', 'BD_LEAD_GEN')).rejects.toThrow(UnauthorizedApproverRoleError);
      expect(DomainGuardrailState.findOne).not.toHaveBeenCalled();
    });

    it('no-ops when the domain is not currently paused', async () => {
      (DomainGuardrailState.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await resumeDomain('x.com', 'user-1', 'ADMIN');
      expect(DomainGuardrailState.findOneAndUpdate).not.toHaveBeenCalled();
      expect(ReviewTask.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('reactivates a paused domain and resolves its ReviewTask', async () => {
      (DomainGuardrailState.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: 'paused', review_task_id: 'review-1' }),
      });

      await resumeDomain('x.com', 'user-1', 'ADMIN');

      expect(DomainGuardrailState.findOneAndUpdate).toHaveBeenCalledWith(
        { domain: 'x.com' },
        expect.objectContaining({ status: 'active', resumed_by: 'user-1' }),
      );
      expect(ReviewTask.findByIdAndUpdate).toHaveBeenCalledWith(
        'review-1',
        expect.objectContaining({ status: 'APPROVED', reviewed_by: 'user-1' }),
      );
    });
  });

  describe('canSend', () => {
    beforeEach(() => {
      (DomainGuardrailState.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (DomainSendEvent.findOne as jest.Mock).mockReturnValue(lean(null));
    });

    it('denies immediately when the domain is already paused, without touching metrics', async () => {
      (DomainGuardrailState.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: 'paused', paused_reason: 'extreme bounce rate' }),
      });

      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });

      expect(decision).toEqual({ allowed: false, action: 'paused', reason: 'extreme bounce rate' });
      expect(DomainSendEvent.aggregate).not.toHaveBeenCalled();
    });

    it('hard-stops and pauses on an extreme bounce rate once the sample size is met', async () => {
      mockCounts({ sent: 150, bounced: 25, complained: 0, replied: 0 }); // ~16.7% bounce >> 5% hard-stop
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'review-1' });

      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });

      expect(decision.allowed).toBe(false);
      expect(decision.action).toBe('paused');
      expect(decision.reason).toMatch(/Bounce rate/);
      expect(ReviewTask.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'domain_guardrail', domain: 'x.com' }));
      expect(DomainGuardrailState.findOneAndUpdate).toHaveBeenCalled();
    });

    it('hard-stops on an extreme complaint rate', async () => {
      mockCounts({ sent: 1000, bounced: 0, complained: 5, replied: 0 }); // 0.5% complaint >> 0.1% hard-stop
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'review-1' });

      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });

      expect(decision.allowed).toBe(false);
      expect(decision.action).toBe('paused');
      expect(decision.reason).toMatch(/complaint rate/);
    });

    it('ignores a high rate below the minimum sample size', async () => {
      mockCounts({ sent: 3, bounced: 2, complained: 0, replied: 0 }); // 66% bounce, but sample too small
      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: false });
      expect(decision).toEqual({ allowed: true, action: 'allowed' });
    });

    it('still enforces the hard stop when requiresWarmup is false', async () => {
      mockCounts({ sent: 150, bounced: 25, complained: 0, replied: 0 });
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'review-1' });

      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: false });

      expect(decision.allowed).toBe(false);
      expect(decision.action).toBe('paused');
    });

    it('skips ramp-up throttling when requiresWarmup is false and there is no hard-stop breach', async () => {
      mockCounts({ sent: 500, bounced: 0, complained: 0, replied: 0 }); // way over the starting cap
      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: false });
      expect(decision).toEqual({ allowed: true, action: 'allowed' });
    });

    it('allows a requiresWarmup send under the ramp cap', async () => {
      mockCounts({ sent: 5, bounced: 0, complained: 0, replied: 0 }); // under the 20/day starting cap
      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });
      expect(decision.allowed).toBe(true);
      expect(decision.action).toBe('allowed');
      expect(decision.dailyCap).toBe(20);
      expect(decision.sentInWindow).toBe(5);
    });

    it('throttles a requiresWarmup send once the ramp cap is reached', async () => {
      mockCounts({ sent: 20, bounced: 0, complained: 0, replied: 0 }); // exactly at the 20/day starting cap
      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });
      expect(decision.allowed).toBe(false);
      expect(decision.action).toBe('throttled');
      expect(decision.dailyCap).toBe(20);
    });

    it('halves the ramp cap when the bounce rate is elevated but below the hard-stop threshold', async () => {
      // 3% bounce: at/above the 2% throttle threshold, well below the 5% hard-stop threshold.
      mockCounts({ sent: 100, bounced: 3, complained: 0, replied: 0 });
      const decision = await canSend('x.com', 'sales@x.com', 'org-1', { requiresWarmup: true });
      expect(decision.action).toBe('throttled');
      expect(decision.dailyCap).toBe(10); // 20 / 2
      expect(decision.reason).toMatch(/Elevated bounce\/complaint rate/);
    });
  });
});
