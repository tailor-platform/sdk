import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./version-detector", () => ({
  detectInstalledVersion: vi.fn(),
}));

vi.mock("./codemod-registry", () => ({
  getApplicableCodemods: vi.fn(),
  resolveCodemodScript: vi.fn((p: string) => `/resolved/${p}`),
}));

// Mock execFile with promisify.custom so that promisify(execFile) uses our mock
const mockExecFileAsync = vi.fn();
vi.mock("node:child_process", () => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    [key: symbol]: ReturnType<typeof vi.fn>;
  };
  fn[promisify.custom] = mockExecFileAsync;
  return { execFile: fn };
});

// Mock fs.promises.mkdtemp and rm for bundleCodemod
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  const actualObj = actual as { promises: Record<string, unknown> };
  return {
    ...actual,
    promises: {
      ...actualObj.promises,
      mkdtemp: vi.fn().mockResolvedValue("/tmp/codemod-bundle-mock"),
      rm: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("upgrade service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw CLIError when SDK version is not detected", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue(null);

    const { upgrade } = await import("./service");

    await expect(upgrade({ to: "2.0.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Could not detect installed @tailor-platform/sdk version",
    );
  });

  it("should return early when no codemods are applicable", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([]);

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    expect(vi.mocked(logger.success)).toHaveBeenCalledWith(
      "No codemods applicable for this version range.",
    );
  });

  it("should log detected and target versions", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([]);

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    const infoCalls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    expect(infoCalls.some((c) => c.includes("1.33.0"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("2.0.0"))).toBe(true);
  });

  it("should log dry-run banner when dryRun is true", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([
      {
        id: "test/mock",
        name: "Mock",
        description: "Mock codemod",
        since: "1.0.0",
        until: "2.0.0",
        scriptPath: "v2/mock/scripts/transform.ts",
      },
    ]);

    // bundle call succeeds, run call returns no changes
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // bundle
      .mockResolvedValueOnce({ stdout: "✨ Done in 0.01s\n", stderr: "" }); // run

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: true, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    const infoCalls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    expect(infoCalls.some((c) => c.includes("[Dry Run]"))).toBe(true);
  });

  it("should handle codemod execution errors gracefully", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([
      {
        id: "test/failing",
        name: "Failing",
        description: "Fails",
        since: "1.0.0",
        until: "2.0.0",
        scriptPath: "v2/failing/scripts/transform.ts",
      },
    ]);

    // bundle call fails
    mockExecFileAsync.mockRejectedValueOnce(new Error("bundle failed"));

    const { upgrade } = await import("./service");
    await expect(upgrade({ to: "2.0.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Upgrade completed with 1 error(s)",
    );

    const { logger } = await import("@/cli/shared/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it("should count codemods as skipped when no changes are detected", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([
      {
        id: "test/noop",
        name: "No-op",
        description: "No changes",
        since: "1.0.0",
        until: "2.0.0",
        scriptPath: "v2/noop/scripts/transform.ts",
      },
    ]);

    // bundle succeeds, run returns no changes
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // bundle
      .mockResolvedValueOnce({ stdout: "✨ Done in 0.01s\n", stderr: "" }); // run

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    const logCalls = vi.mocked(logger.log).mock.calls.map((c) => c[0]);
    expect(logCalls.some((c) => c.includes("No changes needed"))).toBe(true);
  });

  it("should report modified files when codemod makes changes", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([
      {
        id: "test/changes",
        name: "Changes",
        description: "Makes changes",
        since: "1.0.0",
        until: "2.0.0",
        scriptPath: "v2/changes/scripts/transform.ts",
      },
    ]);

    // bundle succeeds, run returns changes with diff output
    const dryRunOutput = [
      "============================================================",
      "File: /test/config.ts",
      "============================================================",
      "--- [before] /test/config.ts",
      "+++ [after]  /test/config.ts",
      "+2 additions, -1 deletions",
      "✨ Done in 0.05s",
    ].join("\n");

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // bundle
      .mockResolvedValueOnce({ stdout: dryRunOutput, stderr: "" }); // run

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: true, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    expect(vi.mocked(logger.success)).toHaveBeenCalled();
  });

  it("should display diff preview in dry-run mode", async () => {
    const { detectInstalledVersion } = await import("./version-detector");
    vi.mocked(detectInstalledVersion).mockResolvedValue("1.33.0");

    const { getApplicableCodemods } = await import("./codemod-registry");
    vi.mocked(getApplicableCodemods).mockReturnValue([
      {
        id: "test/diff",
        name: "Diff",
        description: "Shows diff",
        since: "1.0.0",
        until: "2.0.0",
        scriptPath: "v2/diff/scripts/transform.ts",
      },
    ]);

    const dryRunOutput = [
      "============================================================",
      "File: /test/config.ts",
      "============================================================",
      "--- [before] /test/config.ts",
      "+++ [after]  /test/config.ts",
      '-import { defineGenerators } from "@tailor-platform/sdk";',
      '+import { definePlugins } from "@tailor-platform/sdk";',
      "+2 additions, -1 deletions",
      "✨ Done in 0.05s",
    ].join("\n");

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // bundle
      .mockResolvedValueOnce({ stdout: dryRunOutput, stderr: "" }); // run

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: true, path: "/test" });

    const { logger } = await import("@/cli/shared/logger");
    const logCalls = vi.mocked(logger.log).mock.calls.map((c) => c[0]);

    // Should display "Changes preview:" header
    const infoCalls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    expect(infoCalls.some((c) => c.includes("Changes preview"))).toBe(true);

    // Should contain diff lines (+ and - lines are styled)
    expect(logCalls.some((c) => c.includes("definePlugins"))).toBe(true);
    expect(logCalls.some((c) => c.includes("defineGenerators"))).toBe(true);
  });
});
