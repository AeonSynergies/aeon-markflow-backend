jest.mock('../../src/services/providerCategory.service', () => ({ classifyDomain: jest.fn() }));

import { classifyDomain } from '../../src/services/providerCategory.service';
import { renderOrStripImageBlocks, resolveImageRenderDecision } from '../../src/services/imagePolicy.service';

describe('imagePolicy.service resolveImageRenderDecision', () => {
  afterEach(() => jest.clearAllMocks());

  it('always renders under the "always" policy, without checking step index or provider', async () => {
    const result = await resolveImageRenderDecision({ policy: 'always', workflowStepIndex: 5, recipientDomain: 'x.com' });
    expect(result).toBe(true);
    expect(classifyDomain).not.toHaveBeenCalled();
  });

  it('never renders under the "never" policy', async () => {
    const result = await resolveImageRenderDecision({ policy: 'never', workflowStepIndex: 5, recipientDomain: 'x.com' });
    expect(result).toBe(false);
    expect(classifyDomain).not.toHaveBeenCalled();
  });

  it('strips on the first-touch step (index 0) under "auto", regardless of provider', async () => {
    const result = await resolveImageRenderDecision({ policy: 'auto', workflowStepIndex: 0, recipientDomain: 'x.com' });
    expect(result).toBe(false);
    expect(classifyDomain).not.toHaveBeenCalled();
  });

  it('renders on a later touch under "auto" for a corporate recipient', async () => {
    (classifyDomain as jest.Mock).mockResolvedValue('corporate');
    const result = await resolveImageRenderDecision({ policy: 'auto', workflowStepIndex: 1, recipientDomain: 'acme.com' });
    expect(result).toBe(true);
    expect(classifyDomain).toHaveBeenCalledWith('acme.com');
  });

  it('strips on a later touch under "auto" for a consumer webmail recipient', async () => {
    (classifyDomain as jest.Mock).mockResolvedValue('consumer');
    const result = await resolveImageRenderDecision({ policy: 'auto', workflowStepIndex: 2, recipientDomain: 'gmail.com' });
    expect(result).toBe(false);
  });
});

describe('imagePolicy.service renderOrStripImageBlocks', () => {
  it('returns the html unchanged when there are no image blocks', () => {
    const html = '<p>hi</p>';
    expect(renderOrStripImageBlocks(html, [], true)).toBe(html);
    expect(renderOrStripImageBlocks(html, [], false)).toBe(html);
  });

  it('removes a matching <img data-block-id> entirely when stripping', () => {
    const html = '<p>hi <img data-block-id="hero" src="https://real.com/hero.png" /> there</p>';
    const result = renderOrStripImageBlocks(html, [{ block_id: 'hero' }], false);
    expect(result).not.toContain('<img');
    expect(result).toContain('hi');
    expect(result).toContain('there');
  });

  it('leaves an unrelated <img> (no matching block) untouched either way', () => {
    const html = '<p><img src="pixel.gif" /></p>';
    const stripped = renderOrStripImageBlocks(html, [{ block_id: 'hero' }], false);
    const rendered = renderOrStripImageBlocks(html, [{ block_id: 'hero' }], true);
    expect(stripped).toContain('pixel.gif');
    expect(rendered).toContain('pixel.gif');
  });

  it('fills in a missing src from placeholder_src and alt from alt_text when rendering', () => {
    const html = '<p><img data-block-id="hero" /></p>';
    const result = renderOrStripImageBlocks(
      html,
      [{ block_id: 'hero', alt_text: 'A hero image', placeholder_src: 'https://cdn.example.com/hero.png' }],
      true,
    );
    expect(result).toContain('src="https://cdn.example.com/hero.png"');
    expect(result).toContain('alt="A hero image"');
  });

  it('does not overwrite an already-present src or alt when rendering', () => {
    const html = '<p><img data-block-id="hero" src="https://real.com/x.png" alt="Real alt" /></p>';
    const result = renderOrStripImageBlocks(
      html,
      [{ block_id: 'hero', alt_text: 'Fallback alt', placeholder_src: 'https://cdn.example.com/fallback.png' }],
      true,
    );
    expect(result).toContain('src="https://real.com/x.png"');
    expect(result).toContain('alt="Real alt"');
  });
});
