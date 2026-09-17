import { getDomainProviderMap } from '../config/domainProviders';
import type { EmailProvider } from '../emailProviders/EmailProvider';
import { getEmailProvider } from '../emailProviders/providerRegistry';
import type { InboundMessage } from '../emailProviders/types';
import { Contact } from '../models/Contact.model';
import { Lead } from '../models/Lead.model';
import { LeadActivity, type LeadActivityDocument } from '../models/LeadActivity.model';
import { MailboxPollCursor } from '../models/MailboxPollCursor.model';
import { Organization } from '../models/Organization.model';
import { ReviewTask } from '../models/ReviewTask.model';
import { exitAllActiveEnrollmentsForLead, exitEnrollment } from './enrollment.service';
import { classifySystemMessage, extractReferencedRecipient } from './inboundMessageClassifier';
import { sendInternalNotification } from './internalNotification.service';
import {
  classifyReplyIntent,
  ReplyIntentClassificationError,
  type ReplyIntentClassification,
} from './replyIntentClassifier.service';
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

/**
 * Every mailbox that actually sends mail for a domain, across every org configured to send from
 * it — not just the deployment-level registry's single default. A domain can be shared by more
 * than one org (e.g. Aeon Miles sending via the Aeon Synergies domain), and each org's own
 * `sending_domains[]` entry for that domain can in turn list several mailboxes (round-robinned
 * by mailboxAssignment.service.ts at send time — see domainRouter.service.ts). Every one of them
 * is a real address bounces/complaints/replies can land in, so every one needs polling, not just
 * one per domain. Falls back to the deployment-level default mailbox only when no org has
 * configured any mailboxes[] of its own for this domain yet — same fallback DomainRouter's own
 * resolveSendingRoute/assignMailboxesForDomains already use, so an unmigrated org's mail still
 * gets polled exactly as before this existed.
 */
async function resolveMailboxesForDomain(domain: string, fallbackMailbox: string): Promise<string[]> {
  const orgs = await Organization.find({ 'sending_domains.domain': domain }).lean();

  const mailboxes = new Set<string>();
  for (const org of orgs) {
    for (const entry of org.sending_domains) {
      if (entry.domain !== domain) continue;
      for (const mailbox of entry.mailboxes) {
        mailboxes.add(mailbox.address);
      }
    }
  }

  return mailboxes.size > 0 ? [...mailboxes] : [fallbackMailbox];
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

/**
 * Never lets a classification failure (a transient Anthropic outage, a malformed response) take
 * down the rest of this mailbox's poll — the bounce/reply pipeline's own robustness matters more
 * than any one reply's classification. Falls back to an honest 'unclear' rather than skipping
 * the reply or the poll entirely: the reply itself still gets logged and counted either way.
 */
async function classifyReplySafely(message: InboundMessage): Promise<ReplyIntentClassification> {
  try {
    return await classifyReplyIntent({ subject: message.subject, bodyText: message.bodyText, bodyHtml: message.bodyHtml });
  } catch (error) {
    if (error instanceof ReplyIntentClassificationError) {
      // eslint-disable-next-line no-console
      console.error('Reply intent classification failed:', error);
      return {
        intent: 'unclear',
        confidence: 0,
        reasoning: 'Classification failed — see server logs.',
        model: 'none',
      };
    }
    throw error;
  }
}

/**
 * The one autonomous, contact-facing action this pipeline takes — same category as
 * SendGuardrail's autonomous domain pause (a compliance/safety action, not a content/strategy
 * judgment call), so it takes effect immediately, before any human approves it. Mirrors
 * pauseDomain's own three-part shape: mutate state, open a ReviewTask so a human sees it
 * happened, send an internal notification. Idempotent — a contact already suppressed doesn't
 * get a duplicate ReviewTask/notification for a repeat unsubscribe signal (its active
 * enrollments, if any survived a first pass, still get exited every time).
 */
async function suppressContactForUnsubscribe(
  leadId: string,
  leadActivityId: string,
  orgId: string,
  reasoning: string,
): Promise<void> {
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return;

  const contact = await Contact.findById(lead.contact_id);
  const alreadySuppressed = contact?.global_do_not_contact ?? false;

  if (contact && !alreadySuppressed) {
    contact.global_do_not_contact = true;
    await contact.save();
  }

  await exitAllActiveEnrollmentsForLead(leadId, 'unsubscribe_request');

  if (alreadySuppressed) return;

  const reviewTask = await ReviewTask.create({
    org_id: orgId,
    kind: 'lead_unsubscribe_request',
    lead_id: leadId,
    lead_activity_id: leadActivityId,
    status: 'OPEN',
    rejection_reason: reasoning,
  });

  await sendInternalNotification({
    subject: '[MarkFlow] Unsubscribe request detected — lead suppressed',
    html:
      '<p>A reply was AI-classified as an unsubscribe request. The contact has been suppressed ' +
      '(global_do_not_contact) and every active workflow enrollment for this lead has been exited.</p>' +
      `<p>Reasoning: ${reasoning}</p>` +
      `<p>A ReviewTask (id ${reviewTask._id}) is open for review.</p>`,
  });
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

  // A triage aid only — classifyReplySafely never drafts or sends anything, and its result
  // never blocks logging the reply itself. Only two intents drive further autonomous action,
  // handled below; every other classification is purely stored for a human to read.
  const classification = await classifyReplySafely(message);

  const leadActivity = await LeadActivity.create({
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
    ai_reply_classification: {
      intent: classification.intent,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      model: classification.model,
      classified_at: new Date(),
    },
  });

  await recordDeliverabilityEvent(domain, mailbox, correlated.orgId, 'replied', {
    leadId: correlated.leadId,
    enrollmentId: correlated.enrollmentId,
    emailTemplateVersionId: correlated.emailTemplateVersionId,
  });
  summary.replied += 1;

  if (classification.intent === 'unsubscribe_request') {
    await suppressContactForUnsubscribe(
      correlated.leadId,
      leadActivity._id.toString(),
      correlated.orgId,
      classification.reasoning,
    );
  } else if (classification.intent === 'interested' && correlated.enrollmentId) {
    // Consistent with the Aeon Miles playbook's own instruction to move an interested lead out
    // of automation immediately — a workflow-state transition, not content generation, so it
    // isn't gated behind human approval the way a drafted reply would be.
    await exitEnrollment(correlated.enrollmentId, 'reply_interested');
  }
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

/**
 * Polls every actual sending mailbox once — every mailbox any org has configured for a
 * deployment-registered domain (resolveMailboxesForDomain), not just one default per domain. See
 * scheduling in mailboxPollQueue.ts.
 */
export async function pollAllMailboxes(): Promise<MailboxPollSummary[]> {
  const domainMap = getDomainProviderMap();
  const summaries: MailboxPollSummary[] = [];

  for (const [domain, config] of Object.entries(domainMap)) {
    let provider: EmailProvider;
    try {
      provider = getEmailProvider(config.provider);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Mailbox poll failed for ${domain} (provider ${config.provider}):`, error);
      continue;
    }

    const mailboxes = await resolveMailboxesForDomain(domain, config.mailbox);
    for (const mailbox of mailboxes) {
      try {
        summaries.push(await pollMailbox(domain, mailbox, provider));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Mailbox poll failed for ${domain} (${mailbox}):`, error);
      }
    }
  }

  return summaries;
}
