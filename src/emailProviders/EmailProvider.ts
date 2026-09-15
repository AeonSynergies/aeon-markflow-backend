import type {
  EmailProviderName,
  EmailThread,
  FetchNewMessagesOptions,
  InboundMessage,
  OutboundEmail,
  SendResult,
} from './types';

/**
 * A mailbox-agnostic adapter over a specific email vendor (Microsoft 365, Google Workspace,
 * Zoho Mail). `mailbox` is always the address being sent-as/read-as — app-only Graph and
 * domain-wide-delegated Gmail can act as any mailbox on their tenant/domain, and Zoho resolves
 * it to an account id internally.
 */
export interface EmailProvider {
  readonly name: EmailProviderName;

  send(mailbox: string, email: OutboundEmail): Promise<SendResult>;

  fetchNewMessages(mailbox: string, options?: FetchNewMessagesOptions): Promise<InboundMessage[]>;

  markAsRead(mailbox: string, providerMessageId: string): Promise<void>;

  getThread(mailbox: string, providerThreadId: string): Promise<EmailThread>;
}

export class EmailProviderError extends Error {
  constructor(
    public readonly provider: EmailProviderName,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'EmailProviderError';
  }
}
