import { stripVTControlCharacters } from "node:util";
import { NotificationSeverity } from "@tailor-platform/tailor-proto/notification_resource_pb";
import { describe, expect, test } from "vitest";
import { displayWidth } from "#/cli/shared/ascii-table";
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
      "  Run `tailor notification read <id>` to clear a notification.",
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
    expect(banner.lines.at(-2)).toBe("  Run `tailor notification list` for details.");
  });

  test("shows the three most severe of the page, so an older CRITICAL is named", () => {
    const banner = plain(
      formatNotificationBanner(
        [warning("w1"), warning("w2"), warning("w3"), critical("Region degraded")],
        4,
      ),
    );
    expect(banner.lines.slice(0, 4)).toEqual([
      "  ✖ CRITICAL  Region degraded",
      "  ⚠ WARNING   w1",
      "  ⚠ WARNING   w2",
      "  …and 1 more.",
    ]);
  });

  test("counts the CRITICALs not shown when the page holds every unread notification", () => {
    const page = [critical("c1"), critical("c2"), critical("c3"), critical("c4"), warning("w")];
    expect(plain(formatNotificationBanner(page, 5)).lines).toContain("  …and 2 more (1 CRITICAL).");
    expect(plain(formatNotificationBanner(page, 9)).lines).toContain("  …and 6 more.");
    const warnings = [critical("c"), warning("w1"), warning("w2"), warning("w3")];
    expect(plain(formatNotificationBanner(warnings, 4)).lines).toContain("  …and 1 more.");
  });

  test("sanitizes and truncates titles to the terminal width", () => {
    const banner = plain(
      formatNotificationBanner([warning("Bad \u001b[31mtitle\u001b[0m\r " + "x".repeat(200))], 1, {
        columns: 60,
      }),
    );
    const row = banner.lines[0]!;
    expect(row).not.toContain("\u001b");
    expect(row).not.toContain("\r");
    expect(row.startsWith("  ⚠ WARNING   Bad title x")).toBe(true);
    expect(row.length).toBeLessThanOrEqual(60);
    expect(row.endsWith("…")).toBe(true);
  });

  test("never truncates below a readable minimum even on a narrow terminal", () => {
    const banner = plain(formatNotificationBanner([warning("x".repeat(80))], 1, { columns: 10 }));
    expect(banner.lines[0]!.length).toBeGreaterThan(20);
  });

  test("truncates wide (CJK) titles by display width, not by character count", () => {
    const banner = plain(
      formatNotificationBanner([warning("メンテナンス".repeat(10))], 1, { columns: 40 }),
    );
    const row = banner.lines[0]!;
    expect(displayWidth(row)).toBeLessThanOrEqual(40);
    expect(displayWidth(row)).toBeGreaterThanOrEqual(38);
    expect(row.startsWith("  ⚠ WARNING   メンテナンス")).toBe(true);
    expect(row.endsWith("…")).toBe(true);
  });

  test("never splits an emoji grapheme when truncating", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const banner = plain(
      formatNotificationBanner([warning("a".repeat(24) + family + "b".repeat(40))], 1, {
        columns: 40,
      }),
    );
    const row = banner.lines[0]!;
    expect(row.startsWith(`  ⚠ WARNING   ${"a".repeat(24)}`)).toBe(true);
    expect(row.includes(family) || !row.includes("\u{1F468}")).toBe(true);
    expect(displayWidth(row)).toBeLessThanOrEqual(40);
  });

  test("names the profile in the hint, shell-quoted", () => {
    expect(
      plain(formatNotificationBanner([warning("x")], 1, { profile: "staging" })).lines.slice(-2),
    ).toEqual([
      "  Run `tailor notification list --profile staging` for details.",
      "  Run `tailor notification read <id> --profile staging` to clear a notification.",
    ]);
    const quoted = plain(formatNotificationBanner([warning("x")], 1, { profile: "my profile" }));
    expect(quoted.lines.at(-2)).toContain("--profile 'my profile'");
    expect(quoted.lines.at(-1)).toContain("read <id> --profile 'my profile'");
  });
});
