import { formatDistanceStrict } from "date-fns";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatRelativeTime } from "./relative-time";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = new Date("2026-06-15T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const fromNow = (ms: number) => new Date(now.getTime() + ms);

describe("formatRelativeTime", () => {
  test.each([
    [0, "0 seconds ago"],
    [SECOND, "1 second ago"],
    [30 * SECOND, "30 seconds ago"],
    [59_500, "60 seconds ago"],
    [MINUTE, "1 minute ago"],
    [5 * MINUTE, "5 minutes ago"],
    [59 * MINUTE + 30 * SECOND, "60 minutes ago"],
    [HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [23 * HOUR + 40 * MINUTE, "24 hours ago"],
    [DAY, "1 day ago"],
    [2 * DAY, "2 days ago"],
    [29 * DAY, "29 days ago"],
    [30 * DAY, "1 month ago"],
    [60 * DAY, "2 months ago"],
    [330 * DAY, "11 months ago"],
    [364 * DAY, "1 year ago"],
    [365 * DAY, "1 year ago"],
    [800 * DAY, "2 years ago"],
  ])("formats a past date %i ms before now as %s", (ms, expected) => {
    expect(formatRelativeTime(ago(ms), now)).toBe(expected);
  });

  test.each([
    [SECOND, "in 1 second"],
    [5 * MINUTE, "in 5 minutes"],
    [3 * HOUR, "in 3 hours"],
    [2 * DAY, "in 2 days"],
    [60 * DAY, "in 2 months"],
    [800 * DAY, "in 2 years"],
  ])("formats a future date %i ms after now as %s", (ms, expected) => {
    expect(formatRelativeTime(fromNow(ms), now)).toBe(expected);
  });

  test("treats a date equal to now as past", () => {
    expect(formatRelativeTime(now, now)).toBe("0 seconds ago");
  });

  test("throws RangeError for an invalid date", () => {
    expect(() => formatRelativeTime(new Date("nope"), now)).toThrow(RangeError);
  });

  test("defaults the reference time to the current time", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * MINUTE))).toBe("5 minutes ago");
  });

  describe.each(["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"])(
    "matches date-fns formatDistanceToNowStrict output in %s",
    (timeZone) => {
      beforeEach(() => {
        vi.stubEnv("TZ", timeZone);
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      const offsets: number[] = [];
      for (const unit of [SECOND, MINUTE, HOUR, DAY]) {
        for (const k of [0.4, 0.5, 0.99, 1, 1.49, 1.5, 2, 7, 23, 29, 30, 31, 59, 60, 61]) {
          offsets.push(Math.round(unit * k));
        }
      }
      for (const days of [
        28, 29, 30, 31, 45, 59, 60, 180, 364, 365, 366, 400, 547, 548, 730, 3650,
      ]) {
        offsets.push(days * DAY, days * DAY - 1, days * DAY + 1);
      }

      const references = [
        now,
        new Date("2026-03-08T09:30:00.000Z"),
        new Date("2026-03-29T00:30:00.000Z"),
        new Date("2026-11-01T06:30:00.000Z"),
        new Date("2026-10-25T00:30:00.000Z"),
      ];

      test.each(references.map((r) => [r.toISOString(), r] as const))(
        "reference %s (past and future offsets)",
        (_label, reference) => {
          for (const ms of offsets) {
            for (const sign of [-1, 1]) {
              const date = new Date(reference.getTime() + sign * ms);
              expect(formatRelativeTime(date, reference), `${sign * ms} ms`).toBe(
                formatDistanceStrict(date, reference, { addSuffix: true }),
              );
            }
          }
        },
      );
    },
  );
});
