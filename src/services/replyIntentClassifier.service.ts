import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { LOW_CONFIDENCE_THRESHOLD, REPLY_INTENTS, type ReplyIntent } from '../constants/replyIntent';

const CLASSIFICATION_MODEL = 'claude-opus-5';

const ReplyIntentSchema = z.object({
  intent: z.enum(REPLY_INTENTS).describe('The single best-fitting category for this reply'),
  confidence: z.number().min(0).max(1).describe('How confident you are in this classification, from 0 to 1'),
  reasoning: z.string().describe('One sentence explaining the classification, for a human reviewer'),
});

export interface ReplyIntentClassification {
  intent: ReplyIntent;
  confidence: number;
  reasoning: string;
  model: string;
}

export class ReplyIntentClassificationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ReplyIntentClassificationError';
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** Test-only: clears the cached client so a changed env var takes effect. */
export function resetReplyIntentClassifierClientCache(): void {
  client = undefined;
}

const SYSTEM_PROMPT = [
  "You are classifying an inbound reply to one of Aeon MarkFlow's cold-outreach emails, for a ",
  'human triaging their inbox — you are not drafting or sending anything.',
  '',
  'Classify the reply into exactly one of:',
  '- interested: wants to move forward, book a call, or learn more',
  '- not_now: polite decline or "not right now", but the door is not fully closed',
  '- objection: a specific concern or pushback (price, timing, already has a solution, etc.)',
  "- wrong_person: this isn't the right contact — wrong role, wrong company, ask to redirect",
  '- unsubscribe_request: asks to stop receiving emails, opts out, or reports this as unwanted',
  '- unclear: none of the above clearly fits, the reply is ambiguous, or you are not confident',
  '',
  'Give an honest confidence score. If you are not sure, say so with a low score and prefer ' +
    '"unclear" over a confident-sounding guess — a wrong label is worse than an honest "unclear".',
].join('\n');

export interface ReplyMessageContent {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
}

function buildUserMessage(message: ReplyMessageContent): string | null {
  const body = message.bodyText ?? message.bodyHtml;
  if (!message.subject && !body) return null;

  return [`Subject: ${message.subject ?? '(no subject)'}`, '', body ?? '(no body)'].join('\n');
}

/**
 * Classifies one inbound reply's intent via Claude — a triage aid only. The caller decides what,
 * if anything, to do with the result; this function never mutates anything itself. Returns
 * 'unclear' both when Claude says so and when its own confidence falls below
 * LOW_CONFIDENCE_THRESHOLD, so a human is never misled by a shaky label dressed up as a real
 * signal — see mailboxPoller.service.ts for how the two consequential intents (interested,
 * unsubscribe_request) are gated on this.
 */
export async function classifyReplyIntent(message: ReplyMessageContent): Promise<ReplyIntentClassification> {
  const userMessage = buildUserMessage(message);
  if (!userMessage) {
    return {
      intent: 'unclear',
      confidence: 0,
      reasoning: 'The message had no subject or body to classify.',
      model: CLASSIFICATION_MODEL,
    };
  }

  try {
    const response = await getClient().messages.parse({
      model: CLASSIFICATION_MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(ReplyIntentSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    if (!response.parsed_output) {
      throw new ReplyIntentClassificationError('Claude did not return a parsable reply classification');
    }

    const { intent, confidence, reasoning } = response.parsed_output;
    if (confidence < LOW_CONFIDENCE_THRESHOLD && intent !== 'unclear') {
      return {
        intent: 'unclear',
        confidence,
        reasoning:
          `${reasoning} (confidence ${confidence.toFixed(2)} is below the ${LOW_CONFIDENCE_THRESHOLD} ` +
          `threshold for trusting "${intent}" — downgraded to unclear.)`,
        model: CLASSIFICATION_MODEL,
      };
    }

    return { intent, confidence, reasoning, model: CLASSIFICATION_MODEL };
  } catch (error) {
    if (error instanceof ReplyIntentClassificationError) throw error;
    throw new ReplyIntentClassificationError('Reply intent classification failed', error);
  }
}
