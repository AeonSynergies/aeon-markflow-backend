jest.mock('../../src/models/TrackedLink.model', () => ({
  TrackedLink: { create: jest.fn() },
}));
jest.mock('../../src/models/LinkClick.model', () => ({
  LinkClick: { create: jest.fn() },
}));

import { LinkClick } from '../../src/models/LinkClick.model';
import { TrackedLink } from '../../src/models/TrackedLink.model';
import { createTrackedLink, recordClick, rewriteLinksForTracking } from '../../src/services/linkTracking.service';

describe('linkTracking.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createTrackedLink', () => {
    it('persists the destination url and optional context', async () => {
      (TrackedLink.create as jest.Mock).mockResolvedValueOnce({ _id: 'link-1' });

      await createTrackedLink('https://example.com/book-a-call', {
        orgId: 'org-1',
        leadId: 'lead-1',
      });

      expect(TrackedLink.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        destination_url: 'https://example.com/book-a-call',
        lead_id: 'lead-1',
        email_template_version_id: null,
      });
    });
  });

  describe('rewriteLinksForTracking', () => {
    it('rewrites http(s) links to tracking redirects and leaves other links untouched', async () => {
      (TrackedLink.create as jest.Mock)
        .mockResolvedValueOnce({ _id: 'tok-1' })
        .mockResolvedValueOnce({ _id: 'tok-2' });

      const html =
        '<p>Book <a href="https://example.com/book?slot=1">a call</a> or ' +
        'email <a href="mailto:sales@example.com">us</a>, see <a href="https://example.com/faq">FAQ</a>.</p>';

      const result = await rewriteLinksForTracking(html, { orgId: 'org-1' }, 'https://track.markflow.dev/');

      expect(TrackedLink.create).toHaveBeenCalledTimes(2);
      expect(TrackedLink.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
        destination_url: 'https://example.com/book?slot=1',
      }));
      expect(result).toContain('href="https://track.markflow.dev/r/tok-1"');
      expect(result).toContain('href="https://track.markflow.dev/r/tok-2"');
      expect(result).toContain('href="mailto:sales@example.com"');
    });

    it('does nothing when there are no http(s) links', async () => {
      const result = await rewriteLinksForTracking('<p>no links here</p>', { orgId: 'org-1' }, 'https://track.dev');
      expect(TrackedLink.create).not.toHaveBeenCalled();
      expect(result).toContain('no links here');
    });
  });

  describe('recordClick', () => {
    it('logs a click against the tracked link', async () => {
      (LinkClick.create as jest.Mock).mockResolvedValueOnce({});

      await recordClick('link-1', { ip: '1.2.3.4', userAgent: 'jest' });

      expect(LinkClick.create).toHaveBeenCalledWith({
        tracked_link_id: 'link-1',
        ip: '1.2.3.4',
        user_agent: 'jest',
      });
    });
  });
});
