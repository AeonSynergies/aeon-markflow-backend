import * as cheerio from 'cheerio';
import { LinkClick } from '../models/LinkClick.model';
import { TrackedLink, type TrackedLinkDocument } from '../models/TrackedLink.model';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export interface TrackedLinkContext {
  orgId: string;
  leadId?: string;
  emailTemplateVersionId?: string;
}

export async function createTrackedLink(
  destinationUrl: string,
  context: TrackedLinkContext,
): Promise<TrackedLinkDocument> {
  return TrackedLink.create({
    org_id: context.orgId,
    destination_url: destinationUrl,
    lead_id: context.leadId ?? null,
    email_template_version_id: context.emailTemplateVersionId ?? null,
  });
}

/**
 * Rewrites every http(s) `<a href>` in the given HTML into a click-tracking redirect URL.
 * Per CLAUDE_APPS.md's reliability note this is click tracking, not an open-tracking pixel —
 * opens are unreliable (Apple MPP, Gmail proxy caching) and are never used for response-rate
 * metrics anywhere in this app.
 */
export async function rewriteLinksForTracking(
  html: string,
  context: TrackedLinkContext,
  trackingBaseUrl: string,
): Promise<string> {
  const $ = cheerio.load(html, null, false);
  const base = trackingBaseUrl.replace(/\/+$/, '');

  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href');
    if (!href || !HTTP_URL_PATTERN.test(href)) continue;

    const link = await createTrackedLink(href, context);
    $(el).attr('href', `${base}/r/${link._id.toString()}`);
  }

  return $.html();
}

export async function recordClick(
  trackedLinkId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<void> {
  await LinkClick.create({
    tracked_link_id: trackedLinkId,
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
}
