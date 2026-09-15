import { Types } from 'mongoose';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';

function baseDoc(overrides: Record<string, unknown> = {}) {
  return new EmailTemplateVersion({
    email_template_id: new Types.ObjectId(),
    version_number: 1,
    subject_line: 'A simpler way to manage hiring documents',
    body_html: '<p>Hi {{FirstName}}</p>',
    generation_source: 'human',
    ...overrides,
  });
}

describe('EmailTemplateVersion model', () => {
  it('requires email_template_id, subject_line, body_html, and generation_source', () => {
    const doc = new EmailTemplateVersion({});
    const err = doc.validateSync();
    expect(err?.errors.email_template_id).toBeDefined();
    expect(err?.errors.subject_line).toBeDefined();
    expect(err?.errors.body_html).toBeDefined();
    expect(err?.errors.generation_source).toBeDefined();
  });

  it('defaults status to DRAFT and image_policy to auto', () => {
    const doc = baseDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('DRAFT');
    expect(doc.image_policy).toBe('auto');
    expect(doc.image_blocks).toEqual([]);
  });

  it('rejects an unknown status or generation_source', () => {
    const badStatus = baseDoc({ status: 'SENT' });
    expect(badStatus.validateSync()?.errors.status).toBeDefined();

    const badSource = baseDoc({ generation_source: 'robot' });
    expect(badSource.validateSync()?.errors.generation_source).toBeDefined();
  });

  it('requires ai_generation_metadata when generation_source is ai', () => {
    const doc = baseDoc({ generation_source: 'ai' });
    const err = doc.validateSync();
    expect(err?.errors.ai_generation_metadata).toBeDefined();
  });

  it('requires ai_generation_metadata when generation_source is ai_edited_by_human', () => {
    const doc = baseDoc({ generation_source: 'ai_edited_by_human' });
    const err = doc.validateSync();
    expect(err?.errors.ai_generation_metadata).toBeDefined();
  });

  it('accepts a fully-populated ai draft with reference templates and a guideline version', () => {
    const referenceId = new Types.ObjectId();
    const doc = baseDoc({
      generation_source: 'ai',
      ai_draft_snapshot: { subject_line: 'Original subject', body_html: '<p>Original</p>' },
      ai_generation_metadata: {
        reference_templates: [referenceId],
        reason: 'Cold open for FedEx ISP persona, day 0',
        brand_voice_guidelines_version: 'abc123def456',
        model: 'claude-opus-5',
        generated_at: new Date(),
      },
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ai_generation_metadata?.reference_templates).toHaveLength(1);
  });

  it('does not require ai_generation_metadata for a human-authored version', () => {
    const doc = baseDoc({ generation_source: 'human' });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('enforces one version per (email_template_id, version_number) via a compound unique index', () => {
    const indexes = EmailTemplateVersion.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.email_template_id === 1 && fields.version_number === 1,
    );
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
  });
});
