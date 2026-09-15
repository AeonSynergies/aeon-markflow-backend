import { getInternalNotificationsConfig } from '../config/internalNotifications';
import { getEmailProvider } from '../emailProviders/providerRegistry';

export interface InternalNotification {
  subject: string;
  html: string;
}

/**
 * Sends a system-to-human notification (a new ReviewTask, a SendGuardrail domain pause, etc.)
 * through MarkFlow's own dedicated notifications mailbox — always the microsoft_graph provider
 * directly, never DomainRouter/resolveSendingRoute and never gated by SendGuardrail's
 * canSend/pauseDomain logic. This is deliberate, not an oversight: these are low-volume internal
 * alerts, not cold-outreach marketing sends, and must never compete with, be throttled by, or be
 * paused by logic designed for marketing-sending volume/reputation. Keep it that way — route new
 * internal alerts through this function, not through the marketing send path.
 *
 * Best-effort: a failure here (mailbox not yet provisioned, missing Graph permission, transient
 * API error) is logged and swallowed rather than thrown. The ReviewTask/DomainGuardrailState row
 * that triggered the notification is the real source of truth and is already persisted by the
 * time this runs — a human can still find it in-app even if the email alert didn't land.
 */
export async function sendInternalNotification(notification: InternalNotification): Promise<void> {
  try {
    const { mailbox, recipients } = getInternalNotificationsConfig();
    await getEmailProvider('microsoft_graph').send(mailbox, {
      to: recipients,
      subject: notification.subject,
      html: notification.html,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send internal notification:', error);
  }
}
