import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunOutput } from "./types";
import type { SpawnSyncReturns } from "node:child_process";

vi.mock("#/cli/shared/logger", () => ({
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

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

function makeOutput(overrides: Partial<RunOutput> = {}): RunOutput {
  return {
    codemodsApplied: 0,
    codemodsSkipped: 0,
    filesModified: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function makeSpawnSyncResult(
  overrides: Partial<SpawnSyncReturns<string>> = {},
): SpawnSyncReturns<string> {
  return {
    stdout: JSON.stringify(makeOutput()),
    stderr: "",
    status: 0,
    signal: null,
    pid: 0,
    output: [],
    error: undefined,
    ...overrides,
  };
}

async function setupUpgrade(version: string | null) {
  const { detectInstalledVersion } = await import("./version-detector");
  vi.mocked(detectInstalledVersion).mockResolvedValue(version);
  return (await import("./service")).upgrade;
}

describe("upgrade service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("should throw CLIError when SDK version is not detected", async () => {
    const upgrade = await setupUpgrade(null);

    await expect(upgrade({ from: "1.33.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Could not detect installed @tailor-platform/sdk version",
    );
  });

  test("should invoke sdk-codemod with correct arguments", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(makeSpawnSyncResult());

    await upgrade({ from: "1.33.0", dryRun: false, path: "/test" });

    const expectedNpx = process.platform === "win32" ? "npx.cmd" : "npx";
    expect(spawnSync).toHaveBeenCalledWith(
      expectedNpx,
      expect.arrayContaining([
        "@tailor-platform/sdk-codemod@latest",
        "--from",
        "1.33.0",
        "--to",
        "2.0.0",
        "--target",
        "/test",
      ]),
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  test("should pass --dry-run to sdk-codemod", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(makeSpawnSyncResult());

    await upgrade({ from: "1.33.0", dryRun: true, path: "/test" });

    const expectedNpx = process.platform === "win32" ? "npx.cmd" : "npx";
    expect(spawnSync).toHaveBeenCalledWith(
      expectedNpx,
      expect.arrayContaining(["--dry-run"]),
      expect.anything(),
    );
  });

  test("should display summary from sdk-codemod output", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(
      makeSpawnSyncResult({
        stdout: JSON.stringify(
          makeOutput({ codemodsApplied: 1, filesModified: ["/test/config.ts"] }),
        ),
      }),
    );

    await upgrade({ from: "1.33.0", dryRun: false, path: "/test" });

    const { logger } = await import("#/cli/shared/logger");
    const infoCalls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    expect(infoCalls.some((c) => c.includes("1 applied"))).toBe(true);
  });

  test("should throw CLIError when sdk-codemod returns errors", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(
      makeSpawnSyncResult({
        stdout: JSON.stringify(
          makeOutput({ errors: [{ codemodId: "test/fail", message: "transform failed" }] }),
        ),
        status: 1,
      }),
    );

    await expect(upgrade({ from: "1.33.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Upgrade completed with 1 error(s)",
    );
  });

  test("should throw CLIError when spawning fails", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(
      makeSpawnSyncResult({ stdout: "", status: null, error: new Error("ENOENT") }),
    );

    await expect(upgrade({ from: "1.33.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Failed to run @tailor-platform/sdk-codemod",
    );
  });

  test("should forward captured stderr to process.stderr in the success path", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    const stderrPayload = "Running: define-generators-to-plugins\n  1 file(s) modified\n";
    vi.mocked(spawnSync).mockReturnValue(
      makeSpawnSyncResult({
        stdout: JSON.stringify(
          makeOutput({ codemodsApplied: 1, filesModified: ["/test/config.ts"] }),
        ),
        stderr: stderrPayload,
      }),
    );
    using stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await upgrade({ from: "1.33.0", dryRun: true, path: "/test" });

    expect(stderrWrite).toHaveBeenCalledWith(stderrPayload);
  });

  test("should throw CLIError when stdout is not valid JSON", async () => {
    const upgrade = await setupUpgrade("2.0.0");
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(makeSpawnSyncResult({ stdout: "not json" }));

    await expect(upgrade({ from: "1.33.0", dryRun: false, path: "/test" })).rejects.toThrow(
      "Failed to parse output",
    );
  });
});
