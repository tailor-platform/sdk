const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_MONTH = 43_200;
const MINUTES_PER_YEAR = 525_600;

function localTimezoneOffsetMs(date: Date): number {
  const utc = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  );
  utc.setUTCFullYear(date.getFullYear());
  return date.getTime() - utc.getTime();
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Format the distance between a date and now (e.g. "5 minutes ago", "in 2 days").
 * Output is identical to date-fns `formatDistanceToNowStrict(date, { addSuffix: true })`.
 * @param date - Date to describe
 * @param now - Reference time (defaults to the current time)
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  if (Number.isNaN(diff)) {
    throw new RangeError("Invalid time value");
  }
  const isFuture = diff > 0;
  const [earlier, later] = isFuture ? [now, date] : [date, now];

  const milliseconds = later.getTime() - earlier.getTime();
  const minutes = milliseconds / MS_PER_MINUTE;
  const dstNormalizedMinutes =
    (milliseconds - (localTimezoneOffsetMs(later) - localTimezoneOffsetMs(earlier))) /
    MS_PER_MINUTE;

  let text: string;
  if (minutes < 1) {
    text = plural(Math.round(milliseconds / 1000), "second");
  } else if (minutes < 60) {
    text = plural(Math.round(minutes), "minute");
  } else if (minutes < MINUTES_PER_DAY) {
    text = plural(Math.round(minutes / 60), "hour");
  } else if (dstNormalizedMinutes < MINUTES_PER_MONTH) {
    text = plural(Math.round(dstNormalizedMinutes / MINUTES_PER_DAY), "day");
  } else if (dstNormalizedMinutes < MINUTES_PER_YEAR) {
    const months = Math.round(dstNormalizedMinutes / MINUTES_PER_MONTH);
    text = months === 12 ? plural(1, "year") : plural(months, "month");
  } else {
    text = plural(Math.round(dstNormalizedMinutes / MINUTES_PER_YEAR), "year");
  }
  return isFuture ? `in ${text}` : `${text} ago`;
}
