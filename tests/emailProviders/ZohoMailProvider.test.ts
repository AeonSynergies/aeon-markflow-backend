const httpInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
};

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    create: jest.fn(() => httpInstance),
  },
}));

import axios from 'axios';
import { ZohoMailProvider } from '../../src/emailProviders/ZohoMailProvider';

const MAILBOX = 'contracts@aeonsign.com';
const ACCOUNTS_RESPONSE = {
  data: { data: [{ accountId: 'acct-1', primaryEmailAddress: MAILBOX }] },
};

function mockTokenRefresh() {
  (axios.post as jest.Mock).mockResolvedValueOnce({ data: { access_token: 'tok-1', expires_in: 3600 } });
}

describe('ZohoMailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ZOHO_CLIENT_ID = 'zc1';
    process.env.ZOHO_CLIENT_SECRET = 'zs1';
    process.env.ZOHO_REFRESH_TOKEN = 'zr1';
  });

  it('throws when required env vars are missing', () => {
    delete process.env.ZOHO_REFRESH_TOKEN;
    expect(() => new ZohoMailProvider()).toThrow('ZOHO_REFRESH_TOKEN');
  });

  it('refreshes an access token via the OAuth refresh-token flow and resolves the account id', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.post.mockResolvedValueOnce({ data: { data: { messageId: 'msg-1' } } });

    const provider = new ZohoMailProvider();
    await provider.send(MAILBOX, { to: ['lead@example.com'], subject: 'Hi', html: '<p>hi</p>' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://accounts.zoho.com/oauth/v2/token',
      expect.any(URLSearchParams),
    );
    expect(httpInstance.get).toHaveBeenCalledWith('/api/accounts', {
      headers: { Authorization: 'Zoho-oauthtoken tok-1' },
    });
    expect(httpInstance.post).toHaveBeenCalledWith(
      '/api/accounts/acct-1/messages',
      expect.objectContaining({ fromAddress: MAILBOX, toAddress: 'lead@example.com', subject: 'Hi' }),
      { headers: { Authorization: 'Zoho-oauthtoken tok-1' } },
    );
  });

  it('caches the resolved account id across calls', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.put.mockResolvedValue({ data: {} });

    const provider = new ZohoMailProvider();
    await provider.markAsRead(MAILBOX, 'm1');
    await provider.markAsRead(MAILBOX, 'm2');

    expect(httpInstance.get).toHaveBeenCalledTimes(1);
    expect(httpInstance.put).toHaveBeenCalledTimes(2);
  });

  it('throws when no Zoho account matches the mailbox', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce({ data: { data: [] } });
    const provider = new ZohoMailProvider();

    await expect(provider.markAsRead(MAILBOX, 'm1')).rejects.toThrow(
      `[zoho_mail] markAsRead failed for message m1`,
    );
  });

  it('marks a message as read via the updatemessage action', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.put.mockResolvedValueOnce({ data: {} });

    const provider = new ZohoMailProvider();
    await provider.markAsRead(MAILBOX, 'm1');

    expect(httpInstance.put).toHaveBeenCalledWith(
      '/api/accounts/acct-1/updatemessage',
      { mode: 'markAsRead', messageId: ['m1'] },
      { headers: { Authorization: 'Zoho-oauthtoken tok-1' } },
    );
  });

  it('fetches new messages and filters client-side by since', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.get.mockResolvedValueOnce({
      data: {
        data: [
          { messageId: 'm1', fromAddress: 'a@b.com', toAddress: MAILBOX, subject: 'new', receivedTime: 2_000, status: '0' },
          { messageId: 'm2', fromAddress: 'a@b.com', toAddress: MAILBOX, subject: 'old', receivedTime: 500, status: '1' },
        ],
      },
    });

    const provider = new ZohoMailProvider();
    const messages = await provider.fetchNewMessages(MAILBOX, { since: new Date(1_000) });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ providerMessageId: 'm1', isRead: false });
  });

  it('fetches a thread by filtering messages on threadId', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.get.mockResolvedValueOnce({
      data: {
        data: [
          { messageId: 'm1', threadId: 'th-1', fromAddress: 'a@b.com', toAddress: MAILBOX, subject: 'a' },
          { messageId: 'm2', threadId: 'th-2', fromAddress: 'a@b.com', toAddress: MAILBOX, subject: 'b' },
        ],
      },
    });

    const provider = new ZohoMailProvider();
    const thread = await provider.getThread(MAILBOX, 'th-1');

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].providerMessageId).toBe('m1');
  });

  it('wraps a send failure in an EmailProviderError', async () => {
    mockTokenRefresh();
    httpInstance.get.mockResolvedValueOnce(ACCOUNTS_RESPONSE);
    httpInstance.post.mockRejectedValueOnce(new Error('zoho down'));

    const provider = new ZohoMailProvider();
    await expect(
      provider.send(MAILBOX, { to: ['a@b.com'], subject: 'x', html: '<p/>' }),
    ).rejects.toThrow(`[zoho_mail] send failed for mailbox ${MAILBOX}`);
  });
});
