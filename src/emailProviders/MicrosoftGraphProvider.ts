import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { requireEnv } from '../utils/requireEnv';
import { EmailProviderError, type EmailProvider } from './EmailProvider';
import type {
  EmailThread,
  FetchNewMessagesOptions,
  InboundMessage,
  OutboundEmail,
  SendResult,
} from './types';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

interface GraphRecipient {
  emailAddress: { address: string };
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  body?: { contentType: string; content: string };
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
}

function toRecipients(addresses: string[] = []): GraphRecipient[] {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

function toInboundMessage(message: GraphMessage): InboundMessage {
  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId,
    from: message.from?.emailAddress.address ?? '',
    to: (message.toRecipients ?? []).map((r) => r.emailAddress.address),
    subject: message.subject,
    bodyHtml: message.body?.contentType === 'html' ? message.body.content : undefined,
    bodyText: message.body?.contentType === 'text' ? message.body.content : message.bodyPreview,
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    isRead: message.isRead ?? false,
  };
}

/**
 * App-only Microsoft Graph adapter (Mail.Send / Mail.Read application permissions). `mailbox`
 * is the user principal name / address to act as — requires admin consent on those
 * application permissions, which fails at request time (not at construction) if missing.
 */
export class MicrosoftGraphProvider implements EmailProvider {
  readonly name = 'microsoft_graph' as const;

  private readonly client: Client;

  constructor() {
    const tenantId = requireEnv('MS_TENANT_ID');
    const clientId = requireEnv('MS_CLIENT_ID');
    const clientSecret = requireEnv('MS_CLIENT_SECRET');

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: [GRAPH_SCOPE],
    });

    this.client = Client.initWithMiddleware({ authProvider });
  }

  async send(mailbox: string, email: OutboundEmail): Promise<SendResult> {
    try {
      const internetMessageHeaders = email.replyContext
        ? [
            { name: 'In-Reply-To', value: email.replyContext.inReplyToMessageId },
            { name: 'References', value: (email.replyContext.references ?? []).join(' ') },
          ]
        : undefined;

      const draft: GraphMessage = await this.client.api(`/users/${mailbox}/messages`).post({
        subject: email.subject,
        body: { contentType: 'HTML', content: email.html },
        toRecipients: toRecipients(email.to),
        ccRecipients: toRecipients(email.cc),
        bccRecipients: toRecipients(email.bcc),
        internetMessageHeaders,
      });

      await this.client.api(`/users/${mailbox}/messages/${draft.id}/send`).post({});

      return {
        providerMessageId: draft.id,
        providerThreadId: draft.conversationId,
        sentAt: new Date(),
      };
    } catch (error) {
      throw new EmailProviderError(this.name, `send failed for mailbox ${mailbox}`, error);
    }
  }

  async fetchNewMessages(mailbox: string, options: FetchNewMessagesOptions = {}): Promise<InboundMessage[]> {
    try {
      let request = this.client
        .api(`/users/${mailbox}/mailFolders/inbox/messages`)
        .orderby('receivedDateTime desc')
        .top(options.maxResults ?? 50);

      if (options.since) {
        request = request.filter(`receivedDateTime ge ${options.since.toISOString()}`);
      }

      const response = await request.get();
      const messages: GraphMessage[] = response.value ?? [];
      return messages.map(toInboundMessage);
    } catch (error) {
      throw new EmailProviderError(this.name, `fetchNewMessages failed for mailbox ${mailbox}`, error);
    }
  }

  async markAsRead(mailbox: string, providerMessageId: string): Promise<void> {
    try {
      await this.client.api(`/users/${mailbox}/messages/${providerMessageId}`).patch({ isRead: true });
    } catch (error) {
      throw new EmailProviderError(this.name, `markAsRead failed for message ${providerMessageId}`, error);
    }
  }

  async getThread(mailbox: string, providerThreadId: string): Promise<EmailThread> {
    try {
      const response = await this.client
        .api(`/users/${mailbox}/messages`)
        .filter(`conversationId eq '${providerThreadId}'`)
        .orderby('receivedDateTime asc')
        .get();

      const messages: GraphMessage[] = response.value ?? [];
      return { providerThreadId, messages: messages.map(toInboundMessage) };
    } catch (error) {
      throw new EmailProviderError(this.name, `getThread failed for thread ${providerThreadId}`, error);
    }
  }
}
