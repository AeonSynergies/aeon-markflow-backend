jest.mock('../../src/config/domainProviders', () => ({ getDomainProviderMap: jest.fn() }));
jest.mock('../../src/emailProviders/providerRegistry', () => ({ getEmailProvider: jest.fn() }));
jest.mock('../../src/models/Contact.model', () => ({ Contact: { findOne: jest.fn() } }));
jest.mock('../../src/models/Lead.model', () => ({ Lead: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/models/LeadActivity.model', () => ({
  LeadActivity: { findOne: jest.fn(), create: jest.fn(), exists: jest.fn() },
}));
jest.mock('../../src/models/MailboxPollCursor.model', () => ({
  MailboxPollCursor: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/Organization.model', () => ({ Organization: { findOne: jest.fn(), find: jest.fn() } }));
jest.mock('../../src/services/inboundMessageClassifier', () => ({
  classifySystemMessage: jest.fn(),
  extractReferencedRecipient: jest.fn(),
}));
jest.mock('../../src/services/sendGuardrail.service', () => ({ recordDeliverabilityEvent: jest.fn() }));

import { getDomainProviderMap } from '../../src/config/domainProviders';
import { getEmailProvider } from '../../src/emailProviders/providerRegistry';
import type { InboundMessage } from '../../src/emailProviders/types';
import { Contact } from '../../src/models/Contact.model';
import { Lead } from '../../src/models/Lead.model';
import { LeadActivity } from '../../src/models/LeadActivity.model';
import { MailboxPollCursor } from '../../src/models/MailboxPollCursor.model';
import { Organization } from '../../src/models/Organization.model';
import { classifySystemMessage, extractReferencedRecipient } from '../../src/services/inboundMessageClassifier';
import { recordDeliverabilityEvent } from '../../src/services/sendGuardrail.service';
import { pollAllMailboxes, pollMailbox } from '../../src/services/mailboxPoller.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

function inboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    providerMessageId: 'msg-1',
    from: 'someone@example.com',
    to: ['sales@aeonsign.com'],
    subject: 'Hello',
    receivedAt: new Date('2026-01-05'),
    isRead: false,
    ...overrides,
  };
}

function mockProvider(messages: InboundMessage[]) {
  return {
    name: 'microsoft_graph' as const,
    send: jest.fn(),
    fetchNewMessages: jest.fn().mockResolvedValue(messages),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    getThread: jest.fn(),
  };
}

describe('mailboxPoller.service', () => {
  afterEach(() => jest.clearAllMocks());

  beforeEach(() => {
    (MailboxPollCursor.findOne as jest.Mock).mockReturnValue(lean(null));
    (MailboxPollCursor.findOneAndUpdate as jest.Mock).mockResolvedValue(undefined);
    (LeadActivity.exists as jest.Mock).mockResolvedValue(null);
    (Organization.find as jest.Mock).mockReturnValue(lean([]));
  });

  describe('pollMailbox', () => {
    it('passes the stored cursor as `since`, and upserts a new cursor at poll start time', async () => {
      const lastPolledAt = new Date('2026-01-01');
      (MailboxPollCursor.findOne as jest.Mock).mockReturnValue(lean({ last_polled_at: lastPolledAt }));
      const provider = mockProvider([]);

      await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

      expect(provider.fetchNewMessages).toHaveBeenCalledWith('sales@aeonsign.com', {
        since: lastPolledAt,
        maxResults: expect.any(Number),
      });
      expect(MailboxPollCursor.findOneAndUpdate).toHaveBeenCalledWith(
        { mailbox: 'sales@aeonsign.com' },
        expect.objectContaining({ mailbox: 'sales@aeonsign.com', domain: 'aeonsign.com', last_polled_at: expect.any(Date) }),
        { upsert: true },
      );
    });

    it('passes since: undefined when there is no prior cursor', async () => {
      const provider = mockProvider([]);
      await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);
      expect(provider.fetchNewMessages).toHaveBeenCalledWith('sales@aeonsign.com', {
        since: undefined,
        maxResults: expect.any(Number),
      });
    });

    describe('bounce/complaint handling', () => {
      it('records a bounce correlated to a known lead, and marks the message read', async () => {
        const message = inboundMessage({ from: 'mailer-daemon@aeonsign.com' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('bounce');
        (extractReferencedRecipient as jest.Mock).mockReturnValue('jane.doe@example.com');
        (Contact.findOne as jest.Mock).mockReturnValue(lean({ _id: 'contact-1' }));
        (Lead.find as jest.Mock).mockReturnValue(lean([{ _id: 'lead-1', org_id: { toString: () => 'org-1' } }]));
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({ lead_id: { toString: () => 'lead-1' }, enrollment_id: { toString: () => 'enr-1' }, occurred_at: new Date('2026-01-02') }),
        );

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(Contact.findOne).toHaveBeenCalledWith({ email: 'jane.doe@example.com' });
        expect(recordDeliverabilityEvent).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', 'bounced', {
          leadId: 'lead-1',
          enrollmentId: 'enr-1',
        });
        expect(provider.markAsRead).toHaveBeenCalledWith('sales@aeonsign.com', 'msg-1');
        expect(summary.bounced).toBe(1);
      });

      it('records a complaint using kind "complained"', async () => {
        const message = inboundMessage({ from: 'feedback@yahoo-inc.com' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('complaint');
        (extractReferencedRecipient as jest.Mock).mockReturnValue(undefined);
        (Organization.findOne as jest.Mock).mockReturnValue(lean({ _id: { toString: () => 'org-fallback' } }));

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(recordDeliverabilityEvent).toHaveBeenCalledWith(
          'aeonsign.com',
          'sales@aeonsign.com',
          'org-fallback',
          'complained',
          { leadId: undefined, enrollmentId: undefined },
        );
        expect(summary.complained).toBe(1);
      });

      it('falls back to an org configured for the domain when correlation fails', async () => {
        const message = inboundMessage({ from: 'mailer-daemon@aeonsign.com' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('bounce');
        (extractReferencedRecipient as jest.Mock).mockReturnValue('unknown@example.com');
        (Contact.findOne as jest.Mock).mockReturnValue(lean(null));
        (Organization.findOne as jest.Mock).mockReturnValue(lean({ _id: { toString: () => 'org-fallback' } }));

        await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(Organization.findOne).toHaveBeenCalledWith({ 'sending_domains.domain': 'aeonsign.com' });
        expect(recordDeliverabilityEvent).toHaveBeenCalledWith(
          'aeonsign.com',
          'sales@aeonsign.com',
          'org-fallback',
          'bounced',
          expect.anything(),
        );
      });

      it('skips recording entirely when no org can be resolved at all', async () => {
        const message = inboundMessage({ from: 'mailer-daemon@aeonsign.com' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('bounce');
        (extractReferencedRecipient as jest.Mock).mockReturnValue(undefined);
        (Contact.findOne as jest.Mock).mockReturnValue(lean(null));
        (Organization.findOne as jest.Mock).mockReturnValue(lean(null));

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(recordDeliverabilityEvent).not.toHaveBeenCalled();
        expect(provider.markAsRead).not.toHaveBeenCalled();
        expect(summary.bounced).toBe(0);
      });

      it('propagates the correlated email_template_version_id through to recordDeliverabilityEvent', async () => {
        const message = inboundMessage({ from: 'mailer-daemon@aeonsign.com' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('bounce');
        (extractReferencedRecipient as jest.Mock).mockReturnValue('jane.doe@example.com');
        (Contact.findOne as jest.Mock).mockReturnValue(lean({ _id: 'contact-1' }));
        (Lead.find as jest.Mock).mockReturnValue(lean([{ _id: 'lead-1', org_id: { toString: () => 'org-1' } }]));
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({
            lead_id: { toString: () => 'lead-1' },
            enrollment_id: { toString: () => 'enr-1' },
            email_template_version_id: { toString: () => 'ver-1' },
            occurred_at: new Date('2026-01-02'),
          }),
        );

        await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(recordDeliverabilityEvent).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', 'bounced', {
          leadId: 'lead-1',
          enrollmentId: 'enr-1',
          emailTemplateVersionId: 'ver-1',
        });
      });

      it('skips a bounce/complaint-shaped message that is already marked read (already processed)', async () => {
        const message = inboundMessage({ from: 'mailer-daemon@aeonsign.com', isRead: true });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue('bounce');

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(extractReferencedRecipient).not.toHaveBeenCalled();
        expect(recordDeliverabilityEvent).not.toHaveBeenCalled();
        expect(summary.bounced).toBe(0);
      });
    });

    describe('reply handling', () => {
      it('correlates by thread id, logs an inbound LeadActivity, and records a replied event', async () => {
        const message = inboundMessage({
          from: 'jane.doe@example.com',
          providerThreadId: 'thread-1',
          subject: 'Re: hi',
          bodyText: 'Sounds good',
        });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue(null);
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({ lead_id: { toString: () => 'lead-1' }, enrollment_id: { toString: () => 'enr-1' } }),
        );
        (Lead.findById as jest.Mock).mockReturnValue(lean({ org_id: { toString: () => 'org-1' } }));

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(LeadActivity.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ provider_thread_id: 'thread-1', kind: 'email', direction: 'outbound' }),
        );
        expect(LeadActivity.create).toHaveBeenCalledWith(
          expect.objectContaining({
            lead_id: 'lead-1',
            kind: 'email',
            direction: 'inbound',
            enrollment_id: 'enr-1',
            subject: 'Re: hi',
            body_text: 'Sounds good',
            provider_message_id: 'msg-1',
            provider_thread_id: 'thread-1',
          }),
        );
        expect(recordDeliverabilityEvent).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', 'replied', {
          leadId: 'lead-1',
          enrollmentId: 'enr-1',
        });
        expect(provider.markAsRead).not.toHaveBeenCalled();
        expect(summary.replied).toBe(1);
      });

      it('propagates the correlated email_template_version_id into the logged LeadActivity and recordDeliverabilityEvent', async () => {
        const message = inboundMessage({ from: 'jane.doe@example.com', providerThreadId: 'thread-1' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue(null);
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({
            lead_id: { toString: () => 'lead-1' },
            enrollment_id: { toString: () => 'enr-1' },
            email_template_version_id: { toString: () => 'ver-1' },
          }),
        );
        (Lead.findById as jest.Mock).mockReturnValue(lean({ org_id: { toString: () => 'org-1' } }));

        await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(LeadActivity.create).toHaveBeenCalledWith(
          expect.objectContaining({ email_template_version_id: 'ver-1' }),
        );
        expect(recordDeliverabilityEvent).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', 'replied', {
          leadId: 'lead-1',
          enrollmentId: 'enr-1',
          emailTemplateVersionId: 'ver-1',
        });
      });

      it('falls back to correlating by the sender address when there is no thread match', async () => {
        const message = inboundMessage({ from: 'jane.doe@example.com', providerThreadId: undefined });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue(null);
        (Contact.findOne as jest.Mock).mockReturnValue(lean({ _id: 'contact-1' }));
        (Lead.find as jest.Mock).mockReturnValue(lean([{ _id: 'lead-1', org_id: { toString: () => 'org-1' } }]));
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({ lead_id: { toString: () => 'lead-1' }, enrollment_id: undefined, occurred_at: new Date('2026-01-02') }),
        );

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(Contact.findOne).toHaveBeenCalledWith({ email: 'jane.doe@example.com' });
        expect(LeadActivity.create).toHaveBeenCalled();
        expect(summary.replied).toBe(1);
      });

      it('does not log or count a reply it cannot correlate to any known lead', async () => {
        const message = inboundMessage({ from: 'stranger@example.com', providerThreadId: undefined });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue(null);
        (Contact.findOne as jest.Mock).mockReturnValue(lean(null));

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(LeadActivity.create).not.toHaveBeenCalled();
        expect(recordDeliverabilityEvent).not.toHaveBeenCalled();
        expect(provider.markAsRead).not.toHaveBeenCalled();
        expect(summary.unattributed).toBe(1);
      });

      it('does not log a reply that was already recorded (idempotency)', async () => {
        const message = inboundMessage({ from: 'jane.doe@example.com', providerThreadId: 'thread-1' });
        const provider = mockProvider([message]);
        (classifySystemMessage as jest.Mock).mockReturnValue(null);
        (LeadActivity.findOne as jest.Mock).mockReturnValue(
          sortLean({ lead_id: { toString: () => 'lead-1' }, enrollment_id: undefined }),
        );
        (Lead.findById as jest.Mock).mockReturnValue(lean({ org_id: { toString: () => 'org-1' } }));
        (LeadActivity.exists as jest.Mock).mockResolvedValue({ _id: 'existing' });

        const summary = await pollMailbox('aeonsign.com', 'sales@aeonsign.com', provider);

        expect(LeadActivity.create).not.toHaveBeenCalled();
        expect(recordDeliverabilityEvent).not.toHaveBeenCalled();
        expect(summary.replied).toBe(0);
      });
    });
  });

  describe('pollAllMailboxes', () => {
    it('polls every configured domain/mailbox and continues past a per-domain failure', async () => {
      (getDomainProviderMap as jest.Mock).mockReturnValue({
        'aeonsign.com': { provider: 'zoho_mail', mailbox: 'sales@aeonsign.com' },
        'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
      });
      const workingProvider = mockProvider([]);
      const brokenProvider = { ...mockProvider([]), fetchNewMessages: jest.fn().mockRejectedValue(new Error('down')) };
      (getEmailProvider as jest.Mock)
        .mockReturnValueOnce(brokenProvider)
        .mockReturnValueOnce(workingProvider);

      const summaries = await pollAllMailboxes();

      expect(getEmailProvider).toHaveBeenCalledWith('zoho_mail');
      expect(getEmailProvider).toHaveBeenCalledWith('google_workspace');
      expect(summaries).toHaveLength(1);
      expect(summaries[0].mailbox).toBe('sales@aeonmiles.com');
    });

    it('falls back to the deployment-map default mailbox when no org has configured any mailboxes for the domain', async () => {
      (getDomainProviderMap as jest.Mock).mockReturnValue({
        'aeonsign.com': { provider: 'zoho_mail', mailbox: 'sales@aeonsign.com' },
      });
      (Organization.find as jest.Mock).mockReturnValue(lean([]));
      const provider = mockProvider([]);
      (getEmailProvider as jest.Mock).mockReturnValue(provider);

      const summaries = await pollAllMailboxes();

      expect(Organization.find).toHaveBeenCalledWith({ 'sending_domains.domain': 'aeonsign.com' });
      expect(summaries).toEqual([expect.objectContaining({ domain: 'aeonsign.com', mailbox: 'sales@aeonsign.com' })]);
    });

    it('polls every mailbox any org has configured for a domain, not just the deployment-map default', async () => {
      (getDomainProviderMap as jest.Mock).mockReturnValue({
        'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'fallback@aeonsynergies.com' },
      });
      (Organization.find as jest.Mock).mockReturnValue(
        lean([
          {
            sending_domains: [
              {
                domain: 'aeonsynergies.com',
                purpose: 'marketing',
                mailboxes: [
                  { address: 'alex@aeonsynergies.com', status: 'active' },
                  { address: 'jordan@aeonsynergies.com', status: 'active' },
                ],
              },
            ],
          },
        ]),
      );
      const provider = mockProvider([]);
      (getEmailProvider as jest.Mock).mockReturnValue(provider);

      const summaries = await pollAllMailboxes();

      const polledMailboxes = summaries.map((summary) => summary.mailbox);
      expect(polledMailboxes).toEqual(
        expect.arrayContaining(['alex@aeonsynergies.com', 'jordan@aeonsynergies.com']),
      );
      expect(polledMailboxes).not.toContain('fallback@aeonsynergies.com');
      expect(summaries).toHaveLength(2);
    });

    it('unions configured mailboxes across every org that shares the same domain, deduping repeats', async () => {
      (getDomainProviderMap as jest.Mock).mockReturnValue({
        'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'fallback@aeonsynergies.com' },
      });
      (Organization.find as jest.Mock).mockReturnValue(
        lean([
          {
            sending_domains: [
              {
                domain: 'aeonsynergies.com',
                purpose: 'marketing',
                mailboxes: [{ address: 'shared@aeonsynergies.com', status: 'active' }],
              },
            ],
          },
          {
            sending_domains: [
              {
                domain: 'aeonsynergies.com',
                purpose: 'transactional',
                mailboxes: [
                  { address: 'shared@aeonsynergies.com', status: 'active' },
                  { address: 'aeonmiles-desk@aeonsynergies.com', status: 'active' },
                ],
              },
              // A different domain on the same org — must not leak into this domain's mailboxes.
              { domain: 'other.com', purpose: 'marketing', mailboxes: [{ address: 'nope@other.com', status: 'active' }] },
            ],
          },
        ]),
      );
      const provider = mockProvider([]);
      (getEmailProvider as jest.Mock).mockReturnValue(provider);

      const summaries = await pollAllMailboxes();

      const polledMailboxes = summaries.map((summary) => summary.mailbox).sort();
      expect(polledMailboxes).toEqual(['aeonmiles-desk@aeonsynergies.com', 'shared@aeonsynergies.com']);
    });

    it('continues polling a domain\'s other mailboxes when one of them fails', async () => {
      (getDomainProviderMap as jest.Mock).mockReturnValue({
        'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'fallback@aeonsynergies.com' },
      });
      (Organization.find as jest.Mock).mockReturnValue(
        lean([
          {
            sending_domains: [
              {
                domain: 'aeonsynergies.com',
                purpose: 'marketing',
                mailboxes: [
                  { address: 'alex@aeonsynergies.com', status: 'active' },
                  { address: 'jordan@aeonsynergies.com', status: 'active' },
                ],
              },
            ],
          },
        ]),
      );
      const provider = mockProvider([]);
      provider.fetchNewMessages = jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('down')))
        .mockResolvedValueOnce([]);
      (getEmailProvider as jest.Mock).mockReturnValue(provider);

      const summaries = await pollAllMailboxes();

      expect(summaries).toHaveLength(1);
      expect(summaries[0].mailbox).toBe('jordan@aeonsynergies.com');
    });
  });
});
