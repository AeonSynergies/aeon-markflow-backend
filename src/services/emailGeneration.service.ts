import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
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

export type GenerationRequest = NewTemplateGenerationRequest | ReplyDraftGenerationRequest;

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

function buildSystemPrompt(params: { brandVoiceText: string; referenceBlock: string; threadBlock?: string }): string {
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

  const systemPrompt = buildSystemPrompt({
    brandVoiceText: brandVoice.text,
    referenceBlock: formatReferenceTemplates(referenceExamples),
    threadBlock,
  });

  try {
    const response = await getClient().messages.parse({
      model: GENERATION_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(EmailDraftSchema) },
      system: systemPrompt,
      messages: [{ role: 'user', content: input.request.instructions }],
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
