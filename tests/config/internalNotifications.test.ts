import { getInternalNotificationsConfig } from '../../src/config/internalNotifications';

const ORIGINAL_ENV = process.env;

describe('config/internalNotifications', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when INTERNAL_NOTIFICATIONS_MAILBOX is missing', () => {
    delete process.env.INTERNAL_NOTIFICATIONS_MAILBOX;
    expect(() => getInternalNotificationsConfig()).toThrow('INTERNAL_NOTIFICATIONS_MAILBOX');
  });

  it('defaults recipients to the mailbox itself when none are configured', () => {
    process.env.INTERNAL_NOTIFICATIONS_MAILBOX = 'notifications@aeonsynergies.com';
    delete process.env.INTERNAL_NOTIFICATIONS_RECIPIENTS;

    expect(getInternalNotificationsConfig()).toEqual({
      mailbox: 'notifications@aeonsynergies.com',
      recipients: ['notifications@aeonsynergies.com'],
    });
  });

  it('parses a comma-separated recipient list when configured, trimming whitespace', () => {
    process.env.INTERNAL_NOTIFICATIONS_MAILBOX = 'notifications@aeonsynergies.com';
    process.env.INTERNAL_NOTIFICATIONS_RECIPIENTS = 'ops@aeonsynergies.com, admin@aeonsynergies.com ,';

    expect(getInternalNotificationsConfig()).toEqual({
      mailbox: 'notifications@aeonsynergies.com',
      recipients: ['ops@aeonsynergies.com', 'admin@aeonsynergies.com'],
    });
  });
});
