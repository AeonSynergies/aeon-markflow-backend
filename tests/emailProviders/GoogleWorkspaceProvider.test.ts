const gmailUsersMessages = {
  send: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  modify: jest.fn(),
};
const gmailUsersThreads = { get: jest.fn() };

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn().mockImplementation((opts: unknown) => ({ opts })) },
    gmail: jest.fn(() => ({ users: { messages: gmailUsersMessages, threads: gmailUsersThreads } })),
  },
}));

import { google } from 'googleapis';
import { GoogleWorkspaceProvider } from '../../src/emailProviders/GoogleWorkspaceProvider';

const SERVICE_ACCOUNT = JSON.stringify({ client_email: 'svc@project.iam.gserviceaccount.com', private_key: 'key' });

function b64urlDecode(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

describe('GoogleWorkspaceProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
  });

  it('throws when the service account JSON is missing', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(() => new GoogleWorkspaceProvider()).toThrow('GOOGLE_SERVICE_ACCOUNT_JSON');
  });

  it('throws when the service account JSON is malformed', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{not json';
    expect(() => new GoogleWorkspaceProvider()).toThrow('not valid JSON');
  });

  it('impersonates the mailbox via JWT subject and sends a base64url-encoded RFC 822 message', async () => {
    gmailUsersMessages.send.mockResolvedValueOnce({ data: { id: 'm1', threadId: 't1' } });

    const provider = new GoogleWorkspaceProvider();
    const result = await provider.send('sales@aeonmiles.com', {
      to: ['lead@example.com'],
      subject: 'Hi there',
      html: '<p>hi</p>',
      replyContext: { inReplyToMessageId: '<abc@mail>', references: ['<abc@mail>'] },
    });

    expect(google.auth.JWT).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'sales@aeonmiles.com', email: 'svc@project.iam.gserviceaccount.com' }),
    );

    const [[{ requestBody }]] = gmailUsersMessages.send.mock.calls;
    const raw = b64urlDecode(requestBody.raw);
    expect(raw).toContain('To: lead@example.com');
    expect(raw).toContain('Subject: Hi there');
    expect(raw).toContain('In-Reply-To: <abc@mail>');
    expect(raw).toContain('<p>hi</p>');

    expect(result).toEqual({ providerMessageId: 'm1', providerThreadId: 't1', sentAt: expect.any(Date) });
  });

  it('wraps a send failure in an EmailProviderError', async () => {
    gmailUsersMessages.send.mockRejectedValueOnce(new Error('gmail down'));
    const provider = new GoogleWorkspaceProvider();

    await expect(
      provider.send('sales@aeonmiles.com', { to: ['a@b.com'], subject: 'x', html: '<p/>' }),
    ).rejects.toThrow('[google_workspace] send failed for mailbox sales@aeonmiles.com');
  });

  it('fetches new messages since a given time and decodes the html body', async () => {
    gmailUsersMessages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'm1' }] } });
    gmailUsersMessages.get.mockResolvedValueOnce({
      data: {
        id: 'm1',
        threadId: 't1',
        internalDate: String(new Date('2026-01-01T00:00:00.000Z').getTime()),
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'lead@example.com' },
            { name: 'To', value: 'sales@aeonmiles.com' },
            { name: 'Subject', value: 'Re: hi' },
          ],
          mimeType: 'text/html',
          body: { data: Buffer.from('<p>reply</p>').toString('base64') },
        },
      },
    });

    const provider = new GoogleWorkspaceProvider();
    const since = new Date('2025-12-01T00:00:00.000Z');
    const messages = await provider.fetchNewMessages('sales@aeonmiles.com', { since, maxResults: 5 });

    expect(gmailUsersMessages.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining('after:'), maxResults: 5 }),
    );
    expect(messages).toEqual([
      expect.objectContaining({
        providerMessageId: 'm1',
        providerThreadId: 't1',
        from: 'lead@example.com',
        subject: 'Re: hi',
        bodyHtml: '<p>reply</p>',
        isRead: true,
      }),
    ]);
  });

  it('marks a message as read by removing the UNREAD label', async () => {
    gmailUsersMessages.modify.mockResolvedValueOnce({});
    const provider = new GoogleWorkspaceProvider();

    await provider.markAsRead('sales@aeonmiles.com', 'm1');

    expect(gmailUsersMessages.modify).toHaveBeenCalledWith({
      userId: 'me',
      id: 'm1',
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  });

  it('fetches a thread by id', async () => {
    gmailUsersThreads.get.mockResolvedValueOnce({ data: { messages: [] } });
    const provider = new GoogleWorkspaceProvider();

    const thread = await provider.getThread('sales@aeonmiles.com', 't1');

    expect(gmailUsersThreads.get).toHaveBeenCalledWith({ userId: 'me', id: 't1', format: 'full' });
    expect(thread).toEqual({ providerThreadId: 't1', messages: [] });
  });
});
