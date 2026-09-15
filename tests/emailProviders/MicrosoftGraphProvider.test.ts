jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@microsoft/microsoft-graph-client', () => ({
  Client: { initWithMiddleware: jest.fn() },
}));

jest.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
  TokenCredentialAuthenticationProvider: jest.fn().mockImplementation(() => ({})),
}));

import { Client } from '@microsoft/microsoft-graph-client';
import { MicrosoftGraphProvider } from '../../src/emailProviders/MicrosoftGraphProvider';

function createFakeGraphRequest() {
  const request: Record<string, jest.Mock> = {};
  request.filter = jest.fn(() => request);
  request.orderby = jest.fn(() => request);
  request.top = jest.fn(() => request);
  request.get = jest.fn();
  request.post = jest.fn();
  request.patch = jest.fn();
  return request;
}

describe('MicrosoftGraphProvider', () => {
  const env = { MS_TENANT_ID: 't1', MS_CLIENT_ID: 'c1', MS_CLIENT_SECRET: 's1' };
  let api: jest.Mock;
  let request: ReturnType<typeof createFakeGraphRequest>;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, env);
    request = createFakeGraphRequest();
    api = jest.fn(() => request);
    (Client.initWithMiddleware as jest.Mock).mockReturnValue({ api });
  });

  function loadProvider() {
    return new MicrosoftGraphProvider();
  }

  it('throws when required env vars are missing', () => {
    delete process.env.MS_CLIENT_SECRET;
    expect(() => loadProvider()).toThrow('MS_CLIENT_SECRET');
  });

  it('creates a draft then sends it, returning the message and conversation id', async () => {
    request.post.mockResolvedValueOnce({ id: 'draft-1', conversationId: 'conv-1' });
    request.post.mockResolvedValueOnce({});

    const provider = loadProvider();
    const result = await provider.send('sales@aeonsynergies.com', {
      to: ['lead@example.com'],
      subject: 'Hi',
      html: '<p>hi</p>',
      replyContext: { inReplyToMessageId: 'msg-0', references: ['msg-0'] },
    });

    expect(api).toHaveBeenNthCalledWith(1, '/users/sales@aeonsynergies.com/messages');
    const [firstBody] = request.post.mock.calls[0];
    expect(firstBody.subject).toBe('Hi');
    expect(firstBody.toRecipients).toEqual([{ emailAddress: { address: 'lead@example.com' } }]);
    expect(firstBody.internetMessageHeaders).toEqual([
      { name: 'In-Reply-To', value: 'msg-0' },
      { name: 'References', value: 'msg-0' },
    ]);

    expect(api).toHaveBeenNthCalledWith(2, '/users/sales@aeonsynergies.com/messages/draft-1/send');
    expect(result.providerMessageId).toBe('draft-1');
    expect(result.providerThreadId).toBe('conv-1');
  });

  it('wraps a send failure in an EmailProviderError', async () => {
    request.post.mockRejectedValueOnce(new Error('graph down'));
    const provider = loadProvider();

    await expect(
      provider.send('sales@aeonsynergies.com', { to: ['a@b.com'], subject: 'x', html: '<p/>' }),
    ).rejects.toThrow('[microsoft_graph] send failed for mailbox sales@aeonsynergies.com');
  });

  it('fetches new messages with a since filter and maps them', async () => {
    request.get.mockResolvedValueOnce({
      value: [
        {
          id: 'm1',
          conversationId: 'c1',
          subject: 'Re: hi',
          from: { emailAddress: { address: 'lead@example.com' } },
          toRecipients: [{ emailAddress: { address: 'sales@aeonsynergies.com' } }],
          body: { contentType: 'html', content: '<p>reply</p>' },
          receivedDateTime: '2026-01-01T00:00:00.000Z',
          isRead: false,
        },
      ],
    });

    const provider = loadProvider();
    const since = new Date('2025-12-01T00:00:00.000Z');
    const messages = await provider.fetchNewMessages('sales@aeonsynergies.com', { since, maxResults: 10 });

    expect(api).toHaveBeenCalledWith('/users/sales@aeonsynergies.com/mailFolders/inbox/messages');
    expect(request.top).toHaveBeenCalledWith(10);
    expect(request.filter).toHaveBeenCalledWith(`receivedDateTime ge ${since.toISOString()}`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      providerMessageId: 'm1',
      providerThreadId: 'c1',
      from: 'lead@example.com',
      bodyHtml: '<p>reply</p>',
      isRead: false,
    });
  });

  it('marks a message as read', async () => {
    request.patch.mockResolvedValueOnce({});
    const provider = loadProvider();

    await provider.markAsRead('sales@aeonsynergies.com', 'm1');

    expect(api).toHaveBeenCalledWith('/users/sales@aeonsynergies.com/messages/m1');
    expect(request.patch).toHaveBeenCalledWith({ isRead: true });
  });

  it('fetches a thread by conversation id', async () => {
    request.get.mockResolvedValueOnce({ value: [] });
    const provider = loadProvider();

    const thread = await provider.getThread('sales@aeonsynergies.com', 'conv-1');

    expect(request.filter).toHaveBeenCalledWith("conversationId eq 'conv-1'");
    expect(thread).toEqual({ providerThreadId: 'conv-1', messages: [] });
  });
});
