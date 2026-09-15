import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { requireEnv } from '../utils/requireEnv';
import { EmailProviderError, type EmailProvider } from './EmailProvider';
import type {
  EmailThread,
  FetchNewMessagesOptions,
  InboundMessage,
  OutboundEmail,
  SendResult,
} from './types';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(error as Error).message}`);
  }
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds a minimal RFC 2822 message for the Gmail API's `raw` send/insert field. */
function buildRfc822Message(mailbox: string, email: OutboundEmail): string {
  const headers = [
    `From: ${mailbox}`,
    `To: ${email.to.join(', ')}`,
    email.cc?.length ? `Cc: ${email.cc.join(', ')}` : undefined,
    email.bcc?.length ? `Bcc: ${email.bcc.join(', ')}` : undefined,
    `Subject: ${email.subject}`,
    email.replyContext ? `In-Reply-To: ${email.replyContext.inReplyToMessageId}` : undefined,
    email.replyContext?.references?.length
      ? `References: ${email.replyContext.references.join(' ')}`
      : undefined,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
  ].filter((line): line is string => Boolean(line));

  return `${headers.join('\r\n')}\r\n\r\n${email.html}`;
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined): string | undefined {
  const data = part?.body?.data;
  if (!data) return undefined;
  return Buffer.from(data, 'base64').toString('utf-8');
}

function findPartByMimeType(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType) return part;
  for (const child of part.parts ?? []) {
    const found = findPartByMimeType(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

function header(message: gmail_v1.Schema$Message, name: string): string | undefined {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function toInboundMessage(message: gmail_v1.Schema$Message): InboundMessage {
  const to = (header(message, 'To') ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  return {
    providerMessageId: message.id ?? '',
    providerThreadId: message.threadId ?? undefined,
    from: header(message, 'From') ?? '',
    to,
    subject: header(message, 'Subject') ?? '',
    bodyHtml: decodeBody(findPartByMimeType(message.payload, 'text/html')) ?? decodeBody(message.payload),
    bodyText: decodeBody(findPartByMimeType(message.payload, 'text/plain')),
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
  };
}

/**
 * Google Workspace adapter using domain-wide delegation: a single service account key
 * impersonates any mailbox in the delegated domain via the JWT `subject` claim, so `mailbox`
 * here is the address being impersonated, not a separate per-mailbox credential.
 */
export class GoogleWorkspaceProvider implements EmailProvider {
  readonly name = 'google_workspace' as const;

  private readonly serviceAccountKey: ServiceAccountKey;

  constructor() {
    this.serviceAccountKey = loadServiceAccountKey();
  }

  private gmailClientFor(mailbox: string): gmail_v1.Gmail {
    const auth = new google.auth.JWT({
      email: this.serviceAccountKey.client_email,
      key: this.serviceAccountKey.private_key,
      scopes: GMAIL_SCOPES,
      subject: mailbox,
    });
    return google.gmail({ version: 'v1', auth });
  }

  async send(mailbox: string, email: OutboundEmail): Promise<SendResult> {
    try {
      const gmail = this.gmailClientFor(mailbox);
      const raw = base64url(buildRfc822Message(mailbox, email));
      const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return {
        providerMessageId: data.id ?? '',
        providerThreadId: data.threadId ?? undefined,
        sentAt: new Date(),
      };
    } catch (error) {
      throw new EmailProviderError(this.name, `send failed for mailbox ${mailbox}`, error);
    }
  }

  async fetchNewMessages(mailbox: string, options: FetchNewMessagesOptions = {}): Promise<InboundMessage[]> {
    try {
      const gmail = this.gmailClientFor(mailbox);
      const queryParts = ['in:inbox'];
      if (options.since) {
        queryParts.push(`after:${Math.floor(options.since.getTime() / 1000)}`);
      }

      const { data: list } = await gmail.users.messages.list({
        userId: 'me',
        q: queryParts.join(' '),
        maxResults: options.maxResults ?? 50,
      });

      const messages = await Promise.all(
        (list.messages ?? []).map(async (ref) => {
          const { data } = await gmail.users.messages.get({ userId: 'me', id: ref.id ?? undefined, format: 'full' });
          return toInboundMessage(data);
        }),
      );

      return messages;
    } catch (error) {
      throw new EmailProviderError(this.name, `fetchNewMessages failed for mailbox ${mailbox}`, error);
    }
  }

  async markAsRead(mailbox: string, providerMessageId: string): Promise<void> {
    try {
      const gmail = this.gmailClientFor(mailbox);
      await gmail.users.messages.modify({
        userId: 'me',
        id: providerMessageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch (error) {
      throw new EmailProviderError(this.name, `markAsRead failed for message ${providerMessageId}`, error);
    }
  }

  async getThread(mailbox: string, providerThreadId: string): Promise<EmailThread> {
    try {
      const gmail = this.gmailClientFor(mailbox);
      const { data } = await gmail.users.threads.get({ userId: 'me', id: providerThreadId, format: 'full' });
      return {
        providerThreadId,
        messages: (data.messages ?? []).map(toInboundMessage),
      };
    } catch (error) {
      throw new EmailProviderError(this.name, `getThread failed for thread ${providerThreadId}`, error);
    }
  }
}
