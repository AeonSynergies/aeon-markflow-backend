export const EMAIL_PROVIDER_NAMES = ['microsoft_graph', 'google_workspace', 'zoho_mail'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDER_NAMES)[number];

/**
 * Headers needed to thread a reply into an existing RFC 5322 conversation. Every provider
 * understands these even though each also has its own native thread/conversation id — this is
 * the one threading mechanism the EmailProvider interface exposes uniformly.
 */
export interface ReplyContext {
  inReplyToMessageId: string;
  references?: string[];
}

export interface OutboundEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  replyContext?: ReplyContext;
}

export interface SendResult {
  /** Provider-native message id (Graph message id, Gmail message id, Zoho messageId). */
  providerMessageId: string;
  /** Provider-native thread/conversation id, when the provider exposes one on send. */
  providerThreadId?: string;
  sentAt: Date;
}

export interface InboundMessage {
  providerMessageId: string;
  providerThreadId?: string;
  from: string;
  to: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: Date;
  isRead: boolean;
}

export interface EmailThread {
  providerThreadId: string;
  messages: InboundMessage[];
}

export interface FetchNewMessagesOptions {
  /** Only return messages received at or after this time. */
  since?: Date;
  maxResults?: number;
}
