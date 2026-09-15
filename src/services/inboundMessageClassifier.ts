import type { InboundMessage } from '../emailProviders/types';

/**
 * Heuristic classification of a polled inbound message as a system-generated delivery
 * notification, not a full RFC 3464 (bounce) / RFC 5965 (ARF complaint) parser. InboundMessage
 * only exposes decoded top-level body text/html (see each EmailProvider's toInboundMessage) —
 * not raw MIME parts or attachments — so the machine-readable `message/delivery-status` /
 * `message/feedback-report` parts these formats formally define usually aren't reachable here.
 * What IS reliably reachable: the human-readable explanation part (almost always text/plain,
 * and almost always present) and the message's own subject/from — enough to classify shape and
 * usually enough to extract the affected recipient. Treat this as "good enough to gate sending
 * behavior," not "compliant DSN/ARF parsing" — if the provider abstraction ever exposes raw MIME
 * parts, replace the machine-field regexes below with real parsing of those parts.
 */
export type SystemMessageClassification = 'bounce' | 'complaint';

const BOUNCE_FROM_PATTERN = /\b(mailer-daemon|postmaster|mail delivery subsystem)\b/i;
const BOUNCE_SUBJECT_PATTERN =
  /\b(undeliver(able|ed)?|delivery (has )?fail(ed|ure)|delivery status notification|non-?delivery report|\bndr\b|returned mail|mail delivery failed|could not be delivered|message (could not be )?deliver|failure notice)\b/i;

// Feedback-loop complaint reports (Yahoo/AOL, Microsoft JMRP, etc.) are conventionally sent from
// an address with "feedback"/"fbl"/"abuse" in the localpart, with the machine-readable
// Feedback-Type field from RFC 5965 sometimes visible even in a decoded text/plain fallback.
const COMPLAINT_FROM_PATTERN = /\b(feedback|fbl|abuse)\b/i;
const COMPLAINT_SUBJECT_PATTERN = /\b(spam complaint|feedback report|abuse report|unsolicited (bulk )?email report)\b/i;
const COMPLAINT_BODY_MARKER = /feedback-type\s*:\s*abuse/i;

/** Classifies a polled inbound message as a bounce or spam-complaint notification, or neither. */
export function classifySystemMessage(message: InboundMessage): SystemMessageClassification | null {
  const from = message.from ?? '';
  const subject = message.subject ?? '';
  const body = message.bodyText ?? message.bodyHtml ?? '';

  if (COMPLAINT_FROM_PATTERN.test(from) || COMPLAINT_SUBJECT_PATTERN.test(subject) || COMPLAINT_BODY_MARKER.test(body)) {
    return 'complaint';
  }

  if (BOUNCE_FROM_PATTERN.test(from) || BOUNCE_SUBJECT_PATTERN.test(subject)) {
    return 'bounce';
  }

  return null;
}

const MACHINE_FIELD_PATTERN =
  /(?:final-recipient|original-recipient|original-rcpt-to)\s*:\s*(?:rfc822\s*;\s*)?([^\s,;<>"]+@[^\s,;<>"]+)/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

/**
 * Extracts the affected recipient address from a bounce or complaint's body — the DSN/ARF
 * "Final-Recipient" / "Original-Rcpt-To" machine field when present in the decoded text,
 * otherwise the first email address mentioned that isn't the reporting system's own sender
 * address (a DSN/FBL body almost always names the affected recipient prominently, and the
 * reporting mailbox's own address is typically the only other address reliably present).
 */
export function extractReferencedRecipient(message: InboundMessage): string | undefined {
  const text = message.bodyText ?? (message.bodyHtml ? stripHtmlTags(message.bodyHtml) : '');
  if (!text) return undefined;

  const machineMatch = text.match(MACHINE_FIELD_PATTERN);
  if (machineMatch) return machineMatch[1].toLowerCase();

  const fromLower = (message.from ?? '').toLowerCase();
  const candidates = text.match(EMAIL_PATTERN) ?? [];
  const fallback = candidates.find((email) => email.toLowerCase() !== fromLower);
  return fallback?.toLowerCase();
}
