const parseMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { parse: parseMock } })),
}));

import {
  classifyReplyIntent,
  ReplyIntentClassificationError,
  resetReplyIntentClassifierClientCache,
} from '../../src/services/replyIntentClassifier.service';

describe('replyIntentClassifier.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetReplyIntentClassifierClientCache();
  });

  it('returns an unclear classification without calling Claude when there is no subject or body', async () => {
    const result = await classifyReplyIntent({});

    expect(parseMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0,
      reasoning: expect.stringContaining('no subject or body'),
      model: 'claude-opus-5',
    });
  });

  it('returns the classification as-is when confidence clears the threshold', async () => {
    parseMock.mockResolvedValueOnce({
      parsed_output: { intent: 'interested', confidence: 0.9, reasoning: 'Explicitly asked to book a call' },
    });

    const result = await classifyReplyIntent({ subject: 'Re: intro', bodyText: 'Yes, let\'s talk — book a call?' });

    expect(result).toEqual({
      intent: 'interested',
      confidence: 0.9,
      reasoning: 'Explicitly asked to book a call',
      model: 'claude-opus-5',
    });

    const [[callArgs]] = parseMock.mock.calls;
    expect(callArgs.model).toBe('claude-opus-5');
    expect(callArgs.output_config.effort).toBe('low');
    expect(callArgs.messages[0].content).toContain('Re: intro');
    expect(callArgs.messages[0].content).toContain("book a call");
  });

  it('downgrades a low-confidence intent to unclear rather than trusting it', async () => {
    parseMock.mockResolvedValueOnce({
      parsed_output: { intent: 'objection', confidence: 0.3, reasoning: 'Mentions price but ambiguous' },
    });

    const result = await classifyReplyIntent({ subject: 'Re: intro', bodyText: 'hmm not sure' });

    expect(result.intent).toBe('unclear');
    expect(result.confidence).toBe(0.3);
    expect(result.reasoning).toContain('Mentions price but ambiguous');
    expect(result.reasoning).toContain('downgraded to unclear');
  });

  it('does not rewrite the reasoning when Claude itself already says unclear at low confidence', async () => {
    parseMock.mockResolvedValueOnce({
      parsed_output: { intent: 'unclear', confidence: 0.2, reasoning: 'Genuinely ambiguous reply' },
    });

    const result = await classifyReplyIntent({ subject: 'Re: intro', bodyText: '??' });

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0.2,
      reasoning: 'Genuinely ambiguous reply',
      model: 'claude-opus-5',
    });
  });

  it('trusts a high-confidence unsubscribe_request classification unchanged', async () => {
    parseMock.mockResolvedValueOnce({
      parsed_output: { intent: 'unsubscribe_request', confidence: 0.95, reasoning: 'Explicitly asked to stop emailing' },
    });

    const result = await classifyReplyIntent({ subject: 'Re: intro', bodyText: 'Please stop emailing me' });

    expect(result.intent).toBe('unsubscribe_request');
  });

  it('throws ReplyIntentClassificationError when Claude returns no parsable output', async () => {
    parseMock.mockResolvedValueOnce({ parsed_output: null });

    await expect(classifyReplyIntent({ subject: 'Re: intro', bodyText: 'hi' })).rejects.toThrow(
      ReplyIntentClassificationError,
    );
  });

  it('wraps an underlying API failure in ReplyIntentClassificationError', async () => {
    parseMock.mockRejectedValueOnce(new Error('rate limited'));

    await expect(classifyReplyIntent({ subject: 'Re: intro', bodyText: 'hi' })).rejects.toThrow(
      ReplyIntentClassificationError,
    );
  });
});
