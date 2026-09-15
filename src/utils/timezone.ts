const FALLBACK_TIMEZONE = 'UTC';

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Falls back to UTC for a missing/invalid IANA zone (garbage data, or a Contact with no
 * timezone recorded yet) rather than throwing — a send must never fail just because timezone
 * data is incomplete; it just buckets/schedules as if the recipient were in UTC.
 */
export function resolveTimezone(timezone?: string | null): string {
  if (!timezone) return FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

export interface LocalDayAndHour {
  /** 0 (Sunday) through 6 (Saturday), matching Date.getDay()'s convention. */
  dayOfWeek: number;
  /** 0 through 23, 24-hour clock. */
  hour: number;
}

/** The recipient-local day-of-week and hour for a given instant, in the given (already-resolved) IANA zone. */
export function localDayAndHour(instant: Date, timezone: string): LocalDayAndHour {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');

  return { dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0, hour };
}

const MS_PER_HOUR = 60 * 60 * 1000;
/** Wide enough to guarantee at least one matching hour even across DST transitions. */
const SEARCH_WINDOW_HOURS = 24 * 8;

/**
 * The next instant at or after `from` whose recipient-local day-of-week/hour matches the target,
 * in the given (already-resolved) IANA zone. Searches hour-by-hour rather than doing manual
 * UTC-offset arithmetic, so DST transitions are handled correctly for free — `Intl.DateTimeFormat`
 * already knows the zone's real offset at each candidate instant.
 */
export function nextOccurrenceInTimezone(
  from: Date,
  timezone: string,
  targetDayOfWeek: number,
  targetHour: number,
): Date {
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);

  for (let i = 0; i <= SEARCH_WINDOW_HOURS; i += 1) {
    const candidate = new Date(start.getTime() + i * MS_PER_HOUR);
    if (candidate.getTime() < from.getTime()) continue;

    const { dayOfWeek, hour } = localDayAndHour(candidate, timezone);
    if (dayOfWeek === targetDayOfWeek && hour === targetHour) {
      return candidate;
    }
  }

  // Every week has a matching hour, so this is unreachable in practice — returning `from`
  // rather than throwing keeps a caller's send from hard-failing over a clock/DST edge case.
  return from;
}
