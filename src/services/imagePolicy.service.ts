import * as cheerio from 'cheerio';
import type { ImagePolicy } from '../constants/emailTemplate';
import { classifyDomain } from './providerCategory.service';

export interface ImageBlockLike {
  block_id: string;
  alt_text?: string | null;
  placeholder_src?: string | null;
}

export interface ResolveImageRenderDecisionInput {
  policy: ImagePolicy;
  workflowStepIndex: number;
  recipientDomain: string;
}

/**
 * Decides whether an "auto" email should render or strip its image_blocks, at send time.
 * `always`/`never` are unconditional. For `auto`:
 *  - The first-touch step (index 0) always strips, regardless of provider — a cold first
 *    contact is the highest-risk moment for image-heavy content to read as spam, independent
 *    of who's receiving it.
 *  - Every later touch renders for a corporate/enterprise recipient and strips for a consumer
 *    webmail one. This split is a proposed default, not a measured fit — see CLAUDE.md /
 *    src/constants/providerCategory.ts.
 */
export async function resolveImageRenderDecision(input: ResolveImageRenderDecisionInput): Promise<boolean> {
  if (input.policy === 'always') return true;
  if (input.policy === 'never') return false;

  if (input.workflowStepIndex === 0) return false;

  const category = await classifyDomain(input.recipientDomain);
  return category === 'corporate';
}

/**
 * Applies a render/strip decision to every `<img data-block-id>` in `html` that matches an
 * entry in `imageBlocks` — images not tied to a known block (e.g. the open-tracking pixel,
 * inserted later in the send pipeline) are left untouched either way. Rendering fills in `src`
 * from the block's placeholder_src when the tag doesn't already have one, and sets `alt` from
 * alt_text; stripping removes the element outright rather than leaving a broken-image icon.
 */
export function renderOrStripImageBlocks(html: string, imageBlocks: ImageBlockLike[], shouldRender: boolean): string {
  if (imageBlocks.length === 0) return html;

  const blocksById = new Map(imageBlocks.map((block) => [block.block_id, block]));
  const $ = cheerio.load(html, null, false);

  for (const el of $('img[data-block-id]').toArray()) {
    const blockId = $(el).attr('data-block-id');
    const block = blockId ? blocksById.get(blockId) : undefined;
    if (!block) continue;

    if (!shouldRender) {
      $(el).remove();
      continue;
    }

    if (!$(el).attr('src') && block.placeholder_src) {
      $(el).attr('src', block.placeholder_src);
    }
    if (!$(el).attr('alt') && block.alt_text) {
      $(el).attr('alt', block.alt_text);
    }
  }

  return $.html();
}
