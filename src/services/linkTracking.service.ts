import * as cheerio from 'cheerio';
import { LinkClick } from '../models/LinkClick.model';
import { TrackedLink, type TrackedLinkDocument } from '../models/TrackedLink.model';
import { recordClickForEngagement } from './emailEngagement.service';

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
 * Rewrites every http(s) `<a href>` in the given HTML into a click-tracking redirect URL. Click
 * tracking is a reliable, deliberate-action signal — unlike the open-tracking pixel below, whose
 * "opens" are never trustworthy on their own (see insertOpenTrackingPixel's own doc comment).
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

/**
 * Appends a 1x1 open-tracking pixel pointing at `GET /o/:token` (token = the EmailEngagement
 * record's own id — see emailEngagement.service.ts). Open tracking is explicitly a weak signal
 * (Apple Mail Privacy Protection and Gmail's image-proxy prefetching both cause false-positive
 * "opens" that never happened) — per CLAUDE.md's "must never violate" rule 1, never treated as
 * response rate anywhere; only ever used, cautiously, as one input to the diagnosis-by-symptom
 * analysis (src/services/emailPerformanceAnalysis.service.ts).
 */
export function insertOpenTrackingPixel(html: string, pixelUrl: string): string {
  const $ = cheerio.load(html, null, false);
  $.root().append(`<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" border="0" />`);
  return $.html();
}

export interface TrackedLinkClickTarget {
  _id: { toString(): string };
  lead_id?: { toString(): string } | null;
  email_template_version_id?: { toString(): string } | null;
}

export async function recordClick(
  link: TrackedLinkClickTarget,
  meta: { ip?: string; userAgent?: string },
): Promise<void> {
  await LinkClick.create({
    tracked_link_id: link._id.toString(),
    ip: meta.ip,
    user_agent: meta.userAgent,
  });

  if (link.lead_id && link.email_template_version_id) {
    await recordClickForEngagement(link.lead_id.toString(), link.email_template_version_id.toString());
  }
}
