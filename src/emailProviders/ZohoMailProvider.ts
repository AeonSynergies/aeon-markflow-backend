import axios, { type AxiosInstance } from 'axios';
import { requireEnv } from '../utils/requireEnv';
import { EmailProviderError, type EmailProvider } from './EmailProvider';
import type {
  EmailThread,
  FetchNewMessagesOptions,
  InboundMessage,
  OutboundEmail,
  SendResult,
} from './types';

/**
 * Endpoint shapes below follow Zoho Mail's public REST API
 * (https://www.zoho.com/mail/help/api/). Send, account resolution, and mark-as-read match the
 * documented Compose/Accounts/Update-Message APIs closely; fetchNewMessages and getThread use
 * the folder "view messages" endpoint with client-side filtering, since no live Zoho sandbox
 * was available here to confirm the exact query-filter parameter names — verify against a real
 * account before depending on those two in production.
 */

const TOKEN_REFRESH_BUFFER_MS = 60_000;

interface ZohoAccount {
  accountId: string;
  primaryEmailAddress?: string;
  sendMailDetails?: Array<{ fromAddress?: string }>;
}

interface ZohoMessageSummary {
  messageId: string;
  threadId?: string;
  fromAddress?: string;
  toAddress?: string;
  subject?: string;
  summary?: string;
  content?: string;
  receivedTime?: number;
  status?: string; // '0' = unread, '1' = read, per Zoho's view-messages response
}

function toInboundMessage(message: ZohoMessageSummary): InboundMessage {
  return {
    providerMessageId: message.messageId,
    providerThreadId: message.threadId,
    from: message.fromAddress ?? '',
    to: (message.toAddress ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    subject: message.subject ?? '',
    bodyHtml: message.content,
    bodyText: message.summary,
    receivedAt: message.receivedTime ? new Date(message.receivedTime) : new Date(),
    isRead: message.status !== '0',
  };
}

/**
 * Zoho Mail adapter, authenticated via the Self Client OAuth registration's refresh token
 * (server-based registrations are not used). `mailbox` is the Zoho Mail account's primary
 * address, resolved to its internal accountId on first use and cached.
 */
export class ZohoMailProvider implements EmailProvider {
  readonly name = 'zoho_mail' as const;

  private readonly http: AxiosInstance;
  private readonly accountsUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;

  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;
  private readonly accountIdByMailbox = new Map<string, string>();

  constructor() {
    this.clientId = requireEnv('ZOHO_CLIENT_ID');
    this.clientSecret = requireEnv('ZOHO_CLIENT_SECRET');
    this.refreshToken = requireEnv('ZOHO_REFRESH_TOKEN');
    this.accountsUrl = process.env.ZOHO_ACCOUNTS_URL ?? 'https://accounts.zoho.com';

    this.http = axios.create({ baseURL: process.env.ZOHO_API_DOMAIN ?? 'https://mail.zoho.com' });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    const response = await axios.post(
      `${this.accountsUrl}/oauth/v2/token`,
      new URLSearchParams({
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    );

    this.accessToken = response.data.access_token;
    this.accessTokenExpiresAt = Date.now() + response.data.expires_in * 1000;
    return this.accessToken as string;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Zoho-oauthtoken ${token}` };
  }

  private async resolveAccountId(mailbox: string): Promise<string> {
    const cached = this.accountIdByMailbox.get(mailbox);
    if (cached) return cached;

    const headers = await this.authHeaders();
    const { data } = await this.http.get('/api/accounts', { headers });
    const accounts: ZohoAccount[] = data.data ?? [];

    const match = accounts.find(
      (account) =>
        account.primaryEmailAddress?.toLowerCase() === mailbox.toLowerCase() ||
        account.sendMailDetails?.some((detail) => detail.fromAddress?.toLowerCase() === mailbox.toLowerCase()),
    );

    if (!match) {
      throw new Error(`No Zoho Mail account found for mailbox ${mailbox}`);
    }

    this.accountIdByMailbox.set(mailbox, match.accountId);
    return match.accountId;
  }

  async send(mailbox: string, email: OutboundEmail): Promise<SendResult> {
    try {
      const accountId = await this.resolveAccountId(mailbox);
      const headers = await this.authHeaders();

      const { data } = await this.http.post(
        `/api/accounts/${accountId}/messages`,
        {
          fromAddress: mailbox,
          toAddress: email.to.join(','),
          ccAddress: email.cc?.join(','),
          bccAddress: email.bcc?.join(','),
          subject: email.subject,
          content: email.html,
          mailFormat: 'html',
          ...(email.replyContext
            ? {
                inReplyTo: email.replyContext.inReplyToMessageId,
                references: email.replyContext.references?.join(' '),
              }
            : {}),
        },
        { headers },
      );

      const messageId = data.data?.messageId ?? data.data?.[0]?.messageId ?? '';
      return { providerMessageId: messageId, sentAt: new Date() };
    } catch (error) {
      throw new EmailProviderError(this.name, `send failed for mailbox ${mailbox}`, error);
    }
  }

  async fetchNewMessages(mailbox: string, options: FetchNewMessagesOptions = {}): Promise<InboundMessage[]> {
    try {
      const accountId = await this.resolveAccountId(mailbox);
      const headers = await this.authHeaders();

      const { data } = await this.http.get(`/api/accounts/${accountId}/messages/view`, {
        headers,
        params: { sortBy: 'date', sortorder: false, limit: Math.max(options.maxResults ?? 50, 50) },
      });

      const messages: ZohoMessageSummary[] = data.data ?? [];
      const filtered = options.since
        ? messages.filter((m) => (m.receivedTime ?? 0) >= options.since!.getTime())
        : messages;

      return filtered.slice(0, options.maxResults ?? 50).map(toInboundMessage);
    } catch (error) {
      throw new EmailProviderError(this.name, `fetchNewMessages failed for mailbox ${mailbox}`, error);
    }
  }

  async markAsRead(mailbox: string, providerMessageId: string): Promise<void> {
    try {
      const accountId = await this.resolveAccountId(mailbox);
      const headers = await this.authHeaders();

      await this.http.put(
        `/api/accounts/${accountId}/updatemessage`,
        { mode: 'markAsRead', messageId: [providerMessageId] },
        { headers },
      );
    } catch (error) {
      throw new EmailProviderError(this.name, `markAsRead failed for message ${providerMessageId}`, error);
    }
  }

  async getThread(mailbox: string, providerThreadId: string): Promise<EmailThread> {
    try {
      const accountId = await this.resolveAccountId(mailbox);
      const headers = await this.authHeaders();

      const { data } = await this.http.get(`/api/accounts/${accountId}/messages/view`, {
        headers,
        params: { sortBy: 'date', sortorder: false, limit: 200 },
      });

      const messages: ZohoMessageSummary[] = (data.data ?? []).filter(
        (m: ZohoMessageSummary) => m.threadId === providerThreadId,
      );

      return { providerThreadId, messages: messages.map(toInboundMessage) };
    } catch (error) {
      throw new EmailProviderError(this.name, `getThread failed for thread ${providerThreadId}`, error);
    }
  }
}
