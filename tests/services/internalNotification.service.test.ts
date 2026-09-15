jest.mock('../../src/config/internalNotifications', () => ({ getInternalNotificationsConfig: jest.fn() }));
jest.mock('../../src/emailProviders/providerRegistry', () => ({ getEmailProvider: jest.fn() }));

import { getInternalNotificationsConfig } from '../../src/config/internalNotifications';
import { getEmailProvider } from '../../src/emailProviders/providerRegistry';
import { sendInternalNotification } from '../../src/services/internalNotification.service';

describe('internalNotification.service', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(() => jest.clearAllMocks());
  afterAll(() => consoleErrorSpy.mockRestore());

  it('sends through the microsoft_graph provider, using the configured mailbox and recipients', async () => {
    (getInternalNotificationsConfig as jest.Mock).mockReturnValue({
      mailbox: 'notifications@aeonsynergies.com',
      recipients: ['notifications@aeonsynergies.com'],
    });
    const send = jest.fn().mockResolvedValue(undefined);
    (getEmailProvider as jest.Mock).mockReturnValue({ send });

    await sendInternalNotification({ subject: 'A subject', html: '<p>Body</p>' });

    expect(getEmailProvider).toHaveBeenCalledWith('microsoft_graph');
    expect(send).toHaveBeenCalledWith('notifications@aeonsynergies.com', {
      to: ['notifications@aeonsynergies.com'],
      subject: 'A subject',
      html: '<p>Body</p>',
    });
  });

  it('swallows a missing-config error rather than throwing', async () => {
    (getInternalNotificationsConfig as jest.Mock).mockImplementation(() => {
      throw new Error('Missing required environment variable: INTERNAL_NOTIFICATIONS_MAILBOX');
    });

    await expect(sendInternalNotification({ subject: 'x', html: '<p>x</p>' })).resolves.toBeUndefined();
    expect(getEmailProvider).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('swallows a provider send failure rather than throwing', async () => {
    (getInternalNotificationsConfig as jest.Mock).mockReturnValue({
      mailbox: 'notifications@aeonsynergies.com',
      recipients: ['notifications@aeonsynergies.com'],
    });
    const send = jest.fn().mockRejectedValue(new Error('Graph API down'));
    (getEmailProvider as jest.Mock).mockReturnValue({ send });

    await expect(sendInternalNotification({ subject: 'x', html: '<p>x</p>' })).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
