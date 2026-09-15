import { getDomainProviderMap } from '../config/domainProviders';
import type { EmailProvider } from '../emailProviders/EmailProvider';
import { getEmailProvider } from '../emailProviders/providerRegistry';
import type { InboundMessage } from '../emailProviders/types';
import { Contact } from '../models/Contact.model';
import { Lead } from '../models/Lead.model';
import { LeadActivity, type LeadActivityDocument } from '../models/LeadActivity.model';
import { MailboxPollCursor } from '../models/MailboxPollCursor.model';
import { Organization } from '../models/Organization.model';
import { classifySystemMessage, extractReferencedRecipient } from './inboundMessageClassifier';
import { recordDeliverabilityEvent } from './sendGuardrail.service';

/** How many messages to pull per mailbox per poll — generous relative to the poll interval. */
const POLL_BATCH_SIZE = 100;

interface CorrelatedActivity {
  leadId: string;
  enrollmentId?: string;
  emailTemplateVersionId?: string;
  orgId: string;
}

/** Primary correlation path: this inbound message's thread matches an outbound send we logged. */
async function correlateByThread(providerThreadId: string | undefined): Promise<CorrelatedActivity | null> {
  if (!providerThreadId) return null;

  const activity = await LeadActivity.findOne({
    provider_thread_id: providerThreadId,
    kind: 'email',
    direction: 'outbound',
  })
    .sort({ occurred_at: -1 })
    .lean();
  if (!activity) return null;

  const lead = await Lead.findById(activity.lead_id).lean();
  if (!lead) return null;

  return {
    leadId: activity.lead_id.toString(),
    enrollmentId: activity.enrollment_id?.toString(),
    emailTemplateVersionId: activity.email_template_version_id?.toString(),
    orgId: lead.org_id.toString(),
  };
}

/**
 * Fallback correlation path — mainly for bounces/complaints, which rarely thread: match the
 * affected address to a Contact, then to whichever of that Contact's Leads (a Contact can be a
 * Lead for more than one org) most recently had an outbound email logged, since that's the
 * campaign most likely to have produced this message.
 */
async function correlateByEmailAddress(email: string | undefined): Promise<CorrelatedActivity | null> {
  if (!email) return null;

  const contact = await Contact.findOne({ email: email.toLowerCase().trim() }).lean();
  if (!contact) return null;

  const leads = await Lead.find({ contact_id: contact._id }).lean();
  if (leads.length === 0) return null;

  let best: { activity: LeadActivityDocument; orgId: string } | null = null;
  for (const lead of leads) {
    const activity = await LeadActivity.findOne({ lead_id: lead._id, kind: 'email', direction: 'outbound' })
      .sort({ occurred_at: -1 })
      .lean();
    if (activity && (!best || activity.occurred_at > best.activity.occurred_at)) {
      best = { activity, orgId: lead.org_id.toString() };
    }
  }
  if (!best) return null;

  return {
    leadId: best.activity.lead_id.toString(),
    enrollmentId: best.activity.enrollment_id?.toString(),
    emailTemplateVersionId: best.activity.email_template_version_id?.toString(),
    orgId: best.orgId,
  };
}

/** A bounce/complaint we can't tie to a specific lead still needs *an* org to record it against
 * (DomainSendEvent.org_id is required) — fall back to whichever org currently claims this
 * sending domain. It's still a real deliverability event for the domain either way. */
async function resolveFallbackOrgId(domain: string): Promise<string | undefined> {
  const org = await Organization.findOne({ 'sending_domains.domain': domain }).lean();
  return org?._id.toString();
}

export interface MailboxPollSummary {
  domain: string;
  mailbox: string;
  fetched: number;
  bounced: number;
  complained: number;
  replied: number;
  unattributed: number;
}

async function processDeliverabilityMessage(
  domain: string,
  mailbox: string,
  provider: EmailProvider,
  message: InboundMessage,
  kind: 'bounced' | 'complained',
  summary: MailboxPollSummary,
): Promise<void> {
  // isRead is this poller's own "already processed" marker for system-generated notifications
  // (see markAsRead below) — never applied to replies/unrelated mail, which a human may still
  // need to see in their own inbox.
  if (message.isRead) return;

  const recipient = extractReferencedRecipient(message);
  const correlated = await correlateByEmailAddress(recipient);
  const orgId = correlated?.orgId ?? (await resolveFallbackOrgId(domain));
  if (!orgId) {
    // No org currently claims this domain at all — shouldn't happen since we only poll
    // configured domains, but there's nothing safe to record without an org_id.
    return;
  }

  await recordDeliverabilityEvent(domain, mailbox, orgId, kind, {
    leadId: correlated?.leadId,
    enrollmentId: correlated?.enrollmentId,
    emailTemplateVersionId: correlated?.emailTemplateVersionId,
  });
  summary[kind] += 1;

  try {
    await provider.markAsRead(mailbox, message.providerMessageId);
  } catch {
    // Best-effort: worst case this message gets reprocessed next poll. Recording the event is
    // the part that matters; markAsRead is just noise reduction for the shared inbox.
  }
}

async function processCandidateReply(message: InboundMessage, domain: string, mailbox: string, summary: MailboxPollSummary): Promise<void> {
  const correlated =
    (await correlateByThread(message.providerThreadId)) ?? (await correlateByEmailAddress(message.from));

  // Not tied to any lead we know about — not ours to log (some other business email landing in
  // a shared mailbox, a newsletter, etc.) and never marked as read.
  if (!correlated) {
    summary.unattributed += 1;
    return;
  }

  const alreadyLogged = await LeadActivity.exists({
    provider_message_id: message.providerMessageId,
    direction: 'inbound',
  });
  if (alreadyLogged) return;

  await LeadActivity.create({
    lead_id: correlated.leadId,
    kind: 'email',
    direction: 'inbound',
    enrollment_id: correlated.enrollmentId ?? null,
    email_template_version_id: correlated.emailTemplateVersionId ?? null,
    subject: message.subject,
    body_text: message.bodyText,
    body_html: message.bodyHtml,
    provider_message_id: message.providerMessageId,
    provider_thread_id: message.providerThreadId,
    occurred_at: message.receivedAt,
  });

  await recordDeliverabilityEvent(domain, mailbox, correlated.orgId, 'replied', {
    leadId: correlated.leadId,
    enrollmentId: correlated.enrollmentId,
    emailTemplateVersionId: correlated.emailTemplateVersionId,
  });
  summary.replied += 1;
}

/**
 * Polls one mailbox for new messages since the last poll, classifies each as a bounce, a
 * spam-complaint (feedback-loop report), or a reply candidate, and feeds SendGuardrail's
 * DomainSendEvent log accordingly. This is the live data source SendGuardrail's rate-based
 * throttle/hard-stop logic needs — see sendGuardrail.service.ts.
 */
export async function pollMailbox(domain: string, mailbox: string, provider: EmailProvider): Promise<MailboxPollSummary> {
  const pollStartedAt = new Date();
  const cursor = await MailboxPollCursor.findOne({ mailbox }).lean();

  const messages = await provider.fetchNewMessages(mailbox, {
    since: cursor?.last_polled_at,
    maxResults: POLL_BATCH_SIZE,
  });

  const summary: MailboxPollSummary = {
    domain,
    mailbox,
    fetched: messages.length,
    bounced: 0,
    complained: 0,
    replied: 0,
    unattributed: 0,
  };

  for (const message of messages) {
    const classification = classifySystemMessage(message);
    if (classification === 'bounce') {
      await processDeliverabilityMessage(domain, mailbox, provider, message, 'bounced', summary);
    } else if (classification === 'complaint') {
      await processDeliverabilityMessage(domain, mailbox, provider, message, 'complained', summary);
    } else {
      await processCandidateReply(message, domain, mailbox, summary);
    }
  }

  // Cursor is set to when this poll *started*, not finished — a message that arrives mid-poll
  // has a receivedAt before that timestamp and will still be picked up next cycle rather than
  // silently skipped by an end-of-poll cursor racing ahead of it.
  await MailboxPollCursor.findOneAndUpdate(
    { mailbox },
    { mailbox, domain, last_polled_at: pollStartedAt },
    { upsert: true },
  );

  return summary;
}

/** Polls every deployment-configured sending mailbox once. See scheduling in mailboxPollQueue.ts. */
export async function pollAllMailboxes(): Promise<MailboxPollSummary[]> {
  const domainMap = getDomainProviderMap();
  const summaries: MailboxPollSummary[] = [];

  for (const [domain, config] of Object.entries(domainMap)) {
    try {
      const provider = getEmailProvider(config.provider);
      summaries.push(await pollMailbox(domain, config.mailbox, provider));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Mailbox poll failed for ${domain} (${config.mailbox}):`, error);
    }
  }

  return summaries;
}
