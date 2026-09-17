import { localDayAndHour, nextOccurrenceInTimezone, resolveTimezone } from '../../src/utils/timezone';

describe('resolveTimezone', () => {
  it('falls back to UTC when given null/undefined/empty', () => {
    expect(resolveTimezone(null)).toBe('UTC');
    expect(resolveTimezone(undefined)).toBe('UTC');
    expect(resolveTimezone('')).toBe('UTC');
  });

  it('falls back to UTC for an invalid IANA zone', () => {
    expect(resolveTimezone('Not/A_Zone')).toBe('UTC');
  });

  it('returns a valid IANA zone unchanged', () => {
    expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    expect(resolveTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });
});

describe('localDayAndHour', () => {
  it('computes UTC day-of-week and hour directly for the UTC zone', () => {
    // 2026-01-07 is a Wednesday.
    const result = localDayAndHour(new Date('2026-01-07T15:00:00Z'), 'UTC');
    expect(result).toEqual({ dayOfWeek: 3, hour: 15 });
  });

  it('shifts across a day boundary for a timezone behind UTC', () => {
    // 2026-01-07T02:00:00Z is 2026-01-06 21:00 in America/New_York (UTC-5 in January) — Tuesday 21:00.
    const result = localDayAndHour(new Date('2026-01-07T02:00:00Z'), 'America/New_York');
    expect(result).toEqual({ dayOfWeek: 2, hour: 21 });
  });
});

describe('nextOccurrenceInTimezone', () => {
  it('returns the same instant when it already matches', () => {
    const now = new Date('2026-01-07T15:00:00Z'); // Wednesday, 15:00 UTC
    const next = nextOccurrenceInTimezone(now, 'UTC', 3, 15);
    expect(next.getTime()).toBe(now.getTime());
  });

  it('finds the next matching hour later the same week', () => {
    const now = new Date('2026-01-07T15:00:00Z'); // Wednesday, 15:00 UTC
    const next = nextOccurrenceInTimezone(now, 'UTC', 4, 9); // Thursday, 09:00 UTC
    const { dayOfWeek, hour } = localDayAndHour(next, 'UTC');
    expect(dayOfWeek).toBe(4);
    expect(hour).toBe(9);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('wraps to the following week when the target has already passed this week', () => {
    const now = new Date('2026-01-07T15:00:00Z'); // Wednesday, 15:00 UTC
    const next = nextOccurrenceInTimezone(now, 'UTC', 3, 9); // Wednesday, 09:00 UTC (already passed today)
    const { dayOfWeek, hour } = localDayAndHour(next, 'UTC');
    expect(dayOfWeek).toBe(3);
    expect(hour).toBe(9);
    // Should be roughly a week out (this week's window already passed), not later today.
    expect(next.getTime() - now.getTime()).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});
