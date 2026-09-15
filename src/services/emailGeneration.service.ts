import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { DiagnosisSymptom } from '../constants/emailAnalytics';
import { EmailTemplate } from '../models/EmailTemplate.model';
import { getBrandVoiceGuidelines } from './brandVoice.service';
import { getLeadEmailThread, type ThreadMessage } from './leadThread.service';
import {
  getApprovedReferenceVersions,
  getSeedStructureExamples,
  type ReferenceTemplateExample,
  type SeedOrgKey,
} from './winningEmailLibrary.service';

const GENERATION_MODEL = 'claude-opus-5';

const EmailDraftSchema = z.object({
  subject_line: z.string().describe('The email subject line'),
  body_html: z.string().describe('The full HTML email body'),
  reason: z
    .string()
    .describe('One sentence on the angle/approach taken for this draft, for the audit log'),
});

export interface NewTemplateGenerationRequest {
  type: 'new_template';
  instructions: string;
  seedOrgKey?: SeedOrgKey;
}

export interface ReplyDraftGenerationRequest {
  type: 'reply_draft';
  leadId: string;
  instructions: string;
}

/**
 * A revision proposed by the diagnosis-by-symptom pipeline (see
 * emailPerformanceAnalysis.service.ts). Never used for 'high_bounce_rate' — that symptom routes
 * to SendGuardrail, not a content rewrite, so no revision request is ever built for it.
 */
export interface DiagnosisRevisionRequest {
  type: 'diagnosis_revision';
  symptom: Exclude<DiagnosisSymptom, 'high_bounce_rate'>;
  diagnosisReason: string;
  currentSubjectLine: string;
  currentBodyHtml: string;
}

export type GenerationRequest = NewTemplateGenerationRequest | ReplyDraftGenerationRequest | DiagnosisRevisionRequest;

export interface GenerateDraftInput {
  emailTemplateId: string;
  request: GenerationRequest;
}

export interface GeneratedDraft {
  subjectLine: string;
  bodyHtml: string;
  reason: string;
  referenceTemplates: ReferenceTemplateExample[];
  brandVoiceGuidelinesVersion: string;
  model: string;
}

export class EmailGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmailGenerationError';
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** Test-only: clears the cached client so a changed env var takes effect. */
export function resetEmailGenerationClientCache(): void {
  client = undefined;
}

function formatReferenceTemplates(examples: ReferenceTemplateExample[]): string {
  if (examples.length === 0) {
    return 'No reference examples are available yet for this org/persona.';
  }

  return examples
    .map((example, index) => {
      const label = [example.source, example.persona, example.position].filter(Boolean).join(', ');
      const lines = [`Example ${index + 1} (${label}):`, `Subject: ${example.subjectLine}`];
      if (example.bodyExcerpt) lines.push(`Body (excerpt): ${example.bodyExcerpt}`);
      if (example.notes) lines.push(`Notes: ${example.notes}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function formatLeadThread(thread: ThreadMessage[]): string {
  if (thread.length === 0) return 'No prior email activity on this lead.';

  return thread
    .map(
      (message) =>
        `[${message.occurredAt.toISOString()}] ${message.direction ?? 'unknown'} — ${
          message.subject ?? '(no subject)'
        }\n${message.bodyText ?? ''}`,
    )
    .join('\n\n');
}

const DIAGNOSIS_INSTRUCTIONS: Record<Exclude<DiagnosisSymptom, 'high_bounce_rate'>, string> = {
  low_open_rate:
    'The diagnosis is a LOW OPEN RATE relative to this org\'s baseline. Rewrite ONLY the subject ' +
    'line to be more compelling — keep the body content, structure, and CTA exactly as given ' +
    'below, unchanged. (Open rate is a weak signal on its own — this is worth testing, not a ' +
    'confirmed fix.)',
  no_click_through:
    'The diagnosis is OPENED BUT NOT CLICKED. Rewrite the body to be clearer and more ' +
    'compelling, with one strong, unambiguous call-to-action. Keep the subject line as given ' +
    'below unless a small adjustment clearly helps the new body land — the body is the primary ' +
    'problem here.',
  no_reply_after_click:
    'The diagnosis is CLICKS BUT NO REPLY. Soften the call-to-action — make it a lower-commitment ' +
    'ask than what\'s given below — and/or note in your reason whether the next workflow step\'s ' +
    'timing or channel should change instead. Keep the subject line and overall structure close ' +
    'to the original unless softening the CTA requires a wording change.',
};

function buildDiagnosisBlock(request: DiagnosisRevisionRequest): string {
  return [
    `Diagnosis: ${request.diagnosisReason}`,
    '',
    DIAGNOSIS_INSTRUCTIONS[request.symptom],
    '',
    'Current subject line:',
    request.currentSubjectLine,
    '',
    'Current body:',
    request.currentBodyHtml,
  ].join('\n');
}

function buildSystemPrompt(params: {
  brandVoiceText: string;
  referenceBlock: string;
  threadBlock?: string;
  diagnosisBlock?: string;
}): string {
  return [
    "You are Aeon MarkFlow's email drafting assistant. Draft ONE email for a human reviewer " +
      'to approve — your output is never sent automatically, so draft your best attempt rather ' +
      'than hedging.',
    '',
    '# Brand voice guidelines',
    params.brandVoiceText,
    '',
    '# Reference examples (Winning Email Library)',
    'Match the TONE and STRUCTURE of these examples. Do not copy their wording verbatim — ' +
      'write original copy in the same voice.',
    params.referenceBlock,
    ...(params.threadBlock
      ? [
          '',
          "# This lead's email thread so far",
          'You are drafting a REPLY. Read the thread and respond in context — do not repeat ' +
            'what was already said.',
          params.threadBlock,
        ]
      : []),
    ...(params.diagnosisBlock
      ? [
          '',
          '# You are revising an existing, already-approved email based on a performance diagnosis',
          'This revision enters as a new A/B variant to test against the current version — it ' +
            'does not replace it. Change only what the diagnosis calls for; preserve everything ' +
            'else from the current version given below.',
          params.diagnosisBlock,
        ]
      : []),
    '',
    'Respond with the drafted subject line and full HTML body only, per the required output schema.',
  ].join('\n');
}

/**
 * Drafts one email via Claude, grounded in the brand voice guidelines, the Winning Email
 * Library (seed structural examples plus any real approved templates for this org/persona),
 * and — for a reply — the lead's own email thread. Returns a plain draft; it is the caller's
 * job to persist it as a DRAFT EmailTemplateVersion (see emailTemplateVersion.service).
 */
export async function generateEmailDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  const template = await EmailTemplate.findById(input.emailTemplateId).lean();
  if (!template) {
    throw new EmailGenerationError(`EmailTemplate ${input.emailTemplateId} not found`);
  }

  const persona = template.persona ?? undefined;
  const orgId = template.org_id.toString();
  const brandVoice = getBrandVoiceGuidelines();

  const referenceExamples: ReferenceTemplateExample[] = [];
  if (input.request.type === 'new_template' && input.request.seedOrgKey) {
    referenceExamples.push(...getSeedStructureExamples(input.request.seedOrgKey, persona));
  }
  referenceExamples.push(...(await getApprovedReferenceVersions(orgId, persona)));

  let threadBlock: string | undefined;
  if (input.request.type === 'reply_draft') {
    const thread = await getLeadEmailThread(input.request.leadId);
    threadBlock = formatLeadThread(thread);
  }

  const diagnosisBlock =
    input.request.type === 'diagnosis_revision' ? buildDiagnosisBlock(input.request) : undefined;

  const systemPrompt = buildSystemPrompt({
    brandVoiceText: brandVoice.text,
    referenceBlock: formatReferenceTemplates(referenceExamples),
    threadBlock,
    diagnosisBlock,
  });

  const userMessage =
    input.request.type === 'diagnosis_revision'
      ? 'Apply the diagnosis above and produce the revised email.'
      : input.request.instructions;

  try {
    const response = await getClient().messages.parse({
      model: GENERATION_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(EmailDraftSchema) },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    if (!response.parsed_output) {
      throw new EmailGenerationError('Claude did not return a parsable email draft');
    }

    return {
      subjectLine: response.parsed_output.subject_line,
      bodyHtml: response.parsed_output.body_html,
      reason: response.parsed_output.reason,
      referenceTemplates: referenceExamples,
      brandVoiceGuidelinesVersion: brandVoice.version,
      model: GENERATION_MODEL,
    };
  } catch (error) {
    if (error instanceof EmailGenerationError) throw error;
    throw new EmailGenerationError('Email draft generation failed', error);
  }
}
