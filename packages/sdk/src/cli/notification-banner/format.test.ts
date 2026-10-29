import { stripVTControlCharacters } from "node:util";
import { NotificationSeverity } from "@tailor-platform/tailor-proto/notification_resource_pb";
import { describe, expect, test } from "vitest";
import { formatNotificationBanner } from "./format";

function plain(banner: { header: string; lines: string[] }) {
  return {
    header: stripVTControlCharacters(banner.header),
    lines: banner.lines.map(stripVTControlCharacters),
  };
}

const warning = (title: string) => ({ severity: NotificationSeverity.WARNING, title });
const critical = (title: string) => ({ severity: NotificationSeverity.CRITICAL, title });

describe("formatNotificationBanner", () => {
  test("lists critical notifications first and ends with the hint", () => {
    const banner = plain(
      formatNotificationBanner(
        [warning("Executor retries exceeded"), critical("Region degraded")],
        2,
      ),
    );
    expect(banner.header).toBe("2 unread notifications need your attention");
    expect(banner.lines).toEqual([
      "  ✖ CRITICAL  Region degraded",
      "  ⚠ WARNING   Executor retries exceeded",
      "  Run `tailor notification list` for details.",
    ]);
  });

  test("uses the singular for one notification", () => {
    const banner = plain(formatNotificationBanner([warning("One thing")], 1));
    expect(banner.header).toBe("1 unread notification needs your attention");
  });

  test("counts from the total, not the page, and says how many more there are", () => {
    const banner = plain(formatNotificationBanner([critical("a"), critical("b"), warning("c")], 7));
    expect(banner.header).toBe("7 unread notifications need your attention");
    expect(banner.lines).toContain("  …and 4 more.");
    expect(banner.lines.at(-1)).toBe("  Run `tailor notification list` for details.");
  });

  test("sanitizes and truncates titles to the terminal width", () => {
    const banner = plain(
      formatNotificationBanner(
        [warning("Bad \u001b[31mtitle\u001b[0m\r " + "x".repeat(200))],
        1,
        60,
      ),
    );
    const row = banner.lines[0]!;
    expect(row).not.toContain("\u001b");
    expect(row).not.toContain("\r");
    expect(row.startsWith("  ⚠ WARNING   Bad title x")).toBe(true);
    expect(row.length).toBeLessThanOrEqual(60);
    expect(row.endsWith("…")).toBe(true);
  });

  test("never truncates below a readable minimum even on a narrow terminal", () => {
    const banner = plain(formatNotificationBanner([warning("x".repeat(80))], 1, 10));
    expect(banner.lines[0]!.length).toBeGreaterThan(20);
  });
});
