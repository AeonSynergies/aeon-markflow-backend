export const REPLY_INTENTS = [
  'interested',
  'not_now',
  'objection',
  'wrong_person',
  'unsubscribe_request',
  'unclear',
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * There is no labeled reply data for any Aeon MarkFlow org yet, so this threshold isn't
 * calibrated against measured classifier accuracy — it's a reasonable starting point (Claude
 * reports the low end of its own confidence range), not a fitted number. Treat it as a proposal
 * for a human to review once real replies have gone through classification.
 */

/**
 * Below this confidence, replyIntentClassifier.service.ts downgrades whatever intent Claude
 * returned to 'unclear' rather than trusting it — a human triaging replies should never be
 * misled by a low-confidence label dressed up as a real signal. The two consequential intents
 * (unsubscribe_request driving autonomous suppression, interested driving an autonomous
 * workflow exit) are exactly the ones this floor protects most: a shaky guess at either must
 * never trigger the autonomous behavior gated on it.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
