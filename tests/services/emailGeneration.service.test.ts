const parseMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { parse: parseMock } })),
}));

jest.mock('../../src/models/EmailTemplate.model', () => ({ EmailTemplate: { findById: jest.fn() } }));
jest.mock('../../src/services/brandVoice.service');
jest.mock('../../src/services/winningEmailLibrary.service');
jest.mock('../../src/services/leadThread.service');

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { getBrandVoiceGuidelines } from '../../src/services/brandVoice.service';
import {
  EmailGenerationError,
  generateEmailDraft,
  resetEmailGenerationClientCache,
} from '../../src/services/emailGeneration.service';
import { getLeadEmailThread } from '../../src/services/leadThread.service';
import { getApprovedReferenceVersions, getSeedStructureExamples } from '../../src/services/winningEmailLibrary.service';

function mockTemplate(overrides: Record<string, unknown> = {}) {
  (EmailTemplate.findById as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: 'tpl-1',
      org_id: { toString: () => 'org-1' },
      persona: 'fedex_isp',
      ...overrides,
    }),
  });
}

describe('emailGeneration.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetEmailGenerationClientCache();
    (getBrandVoiceGuidelines as jest.Mock).mockReturnValue({ text: 'Be consultative.', version: 'abc123def456' });
    (getSeedStructureExamples as jest.Mock).mockReturnValue([]);
    (getApprovedReferenceVersions as jest.Mock).mockResolvedValue([]);
    (getLeadEmailThread as jest.Mock).mockResolvedValue([]);
  });

  it('throws when the EmailTemplate does not exist', async () => {
    (EmailTemplate.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(
      generateEmailDraft({ emailTemplateId: 'missing', request: { type: 'new_template', instructions: 'x' } }),
    ).rejects.toThrow(EmailGenerationError);
  });

  it('grounds a new-template draft in brand voice + seed structure + approved examples, and persists none of it itself', async () => {
    mockTemplate();
    (getSeedStructureExamples as jest.Mock).mockReturnValue([
      { source: 'seed_structure', persona: 'fedex_isp', position: 'cold_open', subjectLine: 'Simplify onboarding' },
    ]);
    (getApprovedReferenceVersions as jest.Mock).mockResolvedValue([
      { source: 'approved_version', emailTemplateVersionId: 'ver-9', subjectLine: 'Managing documents', bodyExcerpt: '<p>...</p>' },
    ]);
    parseMock.mockResolvedValueOnce({
      parsed_output: { subject_line: 'A simpler way', body_html: '<p>Hi</p>', reason: 'Cold open angle' },
    });

    const draft = await generateEmailDraft({
      emailTemplateId: 'tpl-1',
      request: { type: 'new_template', instructions: 'Draft a cold open', seedOrgKey: 'aeon_sign' },
    });

    expect(getSeedStructureExamples).toHaveBeenCalledWith('aeon_sign', 'fedex_isp');
    expect(getApprovedReferenceVersions).toHaveBeenCalledWith('org-1', 'fedex_isp');
    expect(getLeadEmailThread).not.toHaveBeenCalled();

    const [[callArgs]] = parseMock.mock.calls;
    expect(callArgs.model).toBe('claude-opus-5');
    expect(callArgs.system).toContain('Be consultative.');
    expect(callArgs.system).toContain('Simplify onboarding');
    expect(callArgs.system).toContain('Managing documents');
    expect(callArgs.system).not.toContain('email thread');

    expect(draft).toEqual({
      subjectLine: 'A simpler way',
      bodyHtml: '<p>Hi</p>',
      reason: 'Cold open angle',
      referenceTemplates: [
        expect.objectContaining({ subjectLine: 'Simplify onboarding' }),
        expect.objectContaining({ subjectLine: 'Managing documents' }),
      ],
      brandVoiceGuidelinesVersion: 'abc123def456',
      model: 'claude-opus-5',
    });
  });

  it('grounds a reply draft in the lead thread instead of seed structure examples', async () => {
    mockTemplate();
    (getLeadEmailThread as jest.Mock).mockResolvedValue([
      { direction: 'inbound', subject: 'Re: hi', bodyText: 'Tell me more', occurredAt: new Date('2026-01-01') },
    ]);
    parseMock.mockResolvedValueOnce({
      parsed_output: { subject_line: 'Re: hi', body_html: '<p>Sure —</p>', reason: 'Answering their question' },
    });

    await generateEmailDraft({
      emailTemplateId: 'tpl-1',
      request: { type: 'reply_draft', leadId: 'lead-1', instructions: 'Reply to their question' },
    });

    expect(getSeedStructureExamples).not.toHaveBeenCalled();
    expect(getLeadEmailThread).toHaveBeenCalledWith('lead-1');

    const [[callArgs]] = parseMock.mock.calls;
    expect(callArgs.system).toContain('Tell me more');
    expect(callArgs.system).toContain('drafting a REPLY');
  });

  it('grounds a diagnosis_revision draft in the diagnosis and current content, using a fixed user message', async () => {
    mockTemplate();
    parseMock.mockResolvedValueOnce({
      parsed_output: { subject_line: 'A clearer ask', body_html: '<p>New</p>', reason: 'Softened the CTA' },
    });

    await generateEmailDraft({
      emailTemplateId: 'tpl-1',
      request: {
        type: 'diagnosis_revision',
        symptom: 'no_reply_after_click',
        diagnosisReason: 'Clicked 20% of opens but replied 0% of clicks over 40 sends.',
        currentSubjectLine: 'Quick chat?',
        currentBodyHtml: '<p>Book 30 minutes with me.</p>',
      },
    });

    expect(getSeedStructureExamples).not.toHaveBeenCalled();
    expect(getLeadEmailThread).not.toHaveBeenCalled();

    const [[callArgs]] = parseMock.mock.calls;
    expect(callArgs.messages[0].content).toBe('Apply the diagnosis above and produce the revised email.');
    expect(callArgs.system).toContain('revising an existing, already-approved email');
    expect(callArgs.system).toContain('Clicked 20% of opens but replied 0% of clicks over 40 sends.');
    expect(callArgs.system).toContain('Soften the call-to-action');
    expect(callArgs.system).toContain('Quick chat?');
    expect(callArgs.system).toContain('Book 30 minutes with me.');
    expect(callArgs.system).toContain('enters as a new A/B variant');
  });

  it('wraps a missing parsed_output in an EmailGenerationError', async () => {
    mockTemplate();
    parseMock.mockResolvedValueOnce({ parsed_output: null });

    await expect(
      generateEmailDraft({ emailTemplateId: 'tpl-1', request: { type: 'new_template', instructions: 'x' } }),
    ).rejects.toThrow('did not return a parsable email draft');
  });

  it('wraps an SDK failure in an EmailGenerationError', async () => {
    mockTemplate();
    parseMock.mockRejectedValueOnce(new Error('rate limited'));

    await expect(
      generateEmailDraft({ emailTemplateId: 'tpl-1', request: { type: 'new_template', instructions: 'x' } }),
    ).rejects.toThrow(EmailGenerationError);
  });
});
