import { type Mock, describe, expect, it, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { printMigrationSummary } from "./reporter";
import type { MigrationSummary } from "./types";

vi.mock("@/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    out: vi.fn(),
  },
  styles: {
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    highlight: (s: string) => s,
    path: (s: string) => s,
  },
}));

const mockedLogger = logger as unknown as Record<string, Mock>;

describe("printMigrationSummary", () => {
  function createSummary(overrides: Partial<MigrationSummary> = {}): MigrationSummary {
    return {
      rulesApplied: 0,
      rulesSkipped: 0,
      filesModified: [],
      warnings: [],
      errors: [],
      ...overrides,
    };
  }

  it("should include failed rules in total count", () => {
    const summary = createSummary({
      rulesApplied: 1,
      rulesSkipped: 1,
      errors: [{ ruleId: "test/fail", error: new Error("boom") }],
    });

    printMigrationSummary(summary, false);

    const infoCall = mockedLogger.info.mock.calls.find((call: string[]) =>
      call[0].includes("total rules"),
    );
    expect(infoCall).toBeDefined();
    expect(infoCall![0]).toContain("3 total rules");
  });

  it("should display warnings from summary", () => {
    const summary = createSummary({
      warnings: ["Manual step: update config"],
    });

    printMigrationSummary(summary, false);

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Manual attention needed"),
    );
  });

  it("should display dry-run banner when in dry-run mode", () => {
    const summary = createSummary();

    printMigrationSummary(summary, true);

    expect(mockedLogger.info).toHaveBeenCalledWith(expect.stringContaining("[Dry Run]"));
  });

  it("should list modified files", () => {
    const summary = createSummary({
      rulesApplied: 1,
      filesModified: ["/project/config.ts", "/project/types.ts"],
    });

    printMigrationSummary(summary, false);

    expect(mockedLogger.info).toHaveBeenCalledWith(expect.stringContaining("Modified files"));
  });

  it("should display error details for failed rules", () => {
    const summary = createSummary({
      errors: [{ ruleId: "test/broken", error: new Error("parse failed") }],
    });

    printMigrationSummary(summary, false);

    expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining("Failed rules"));
  });

  it("should merge diffs from multiple rules showing original before and final after", () => {
    const summary = createSummary({
      rulesApplied: 2,
      filesModified: ["/project/config.ts"],
      diffs: [
        { file: "/project/config.ts", before: "const oldName = 1;", after: "const midName = 1;" },
        { file: "/project/config.ts", before: "const midName = 1;", after: "const newName = 1;" },
      ],
    });

    printMigrationSummary(summary, true);

    // The diff should show original → final, i.e., oldName → newName
    const logCalls = mockedLogger.log.mock.calls.flat() as string[];
    // Should show removal of original line (oldName)
    expect(logCalls.some((c: string) => c.includes("oldName"))).toBe(true);
    // Should show addition of final line (newName)
    expect(logCalls.some((c: string) => c.includes("newName"))).toBe(true);
    // Should NOT show intermediate midName as removed
    expect(logCalls.some((c: string) => c.includes("-") && c.includes("midName"))).toBe(false);
  });
});
