import { requireEnv } from '../utils/requireEnv';

export interface InternalNotificationsConfig {
  /** The shared mailbox MarkFlow sends system-to-human alerts as. */
  mailbox: string;
  /** Who receives them. Defaults to the mailbox itself — a shared inbox a team monitors
   * together — when no separate recipient list is configured. */
  recipients: string[];
}

/**
 * Config for MarkFlow's own internal notifications (ReviewTask alerts, SendGuardrail pause
 * notices, etc.) — deliberately separate from Organization.sending_domains[] and
 * DOMAIN_PROVIDER_MAP_JSON, which are both about marketing/cold-outreach sending. See
 * internalNotification.service.ts for why these never go through DomainRouter/SendGuardrail.
 */
export function getInternalNotificationsConfig(): InternalNotificationsConfig {
  const mailbox = requireEnv('INTERNAL_NOTIFICATIONS_MAILBOX');
  const rawRecipients = process.env.INTERNAL_NOTIFICATIONS_RECIPIENTS;
  const recipients = rawRecipients
    ? rawRecipients
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean)
    : [mailbox];

  return { mailbox, recipients };
}
