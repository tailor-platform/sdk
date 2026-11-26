import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { freshErdExportFailureMessage, resolveWatchPaths, runFreshErdExport } from "./serve";
import type { ErdBuildResult } from "./export";
import type { LocalErdSchemaContext } from "./local-schema";

describe("resolveWatchPaths", () => {
  let tempDir: string;

  aroundEach(async (runTest) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-watch-"));
    await runTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("expands TailorDB file globs and includes the literal base directory", async () => {
    const configPath = path.join(tempDir, "tailor.config.ts");
    const typeDir = path.join(tempDir, "tailordb");
    const typeFile = path.join(typeDir, "user.ts");
    fs.writeFileSync(configPath, "export default {};");
    fs.mkdirSync(typeDir);
    fs.writeFileSync(typeFile, "export const User = {};");

    const context = {
      config: {
        path: configPath,
        db: {
          main: {
            files: [path.join(typeDir, "*.ts")],
          },
        },
      },
      namespaces: [],
    } as unknown as LocalErdSchemaContext;
    const results = [{ namespace: "main" }] as ErdBuildResult[];

    const paths = await resolveWatchPaths(context, results);

    expect(paths).toContain(configPath);
    expect(paths).toContain(typeFile);
    expect(paths).toContain(typeDir);
    expect(paths).not.toContain(path.join(typeDir, "*.ts"));
  });
});

describe("freshErdExportFailureMessage", () => {
  test("reads the message of the JSON error envelope on the last line", () => {
    const stderr = [
      "⚠ tailordb erd is a beta feature.",
      "",
      JSON.stringify({
        error: { code: "CONFIG_NOT_FOUND", message: "Configuration file not found" },
      }),
    ].join("\n");

    expect(freshErdExportFailureMessage(stderr)).toBe("Configuration file not found");
  });

  test("keeps the details and suggestion of the error envelope", () => {
    const stderr = JSON.stringify({
      error: {
        code: "CONFIG_INVALID",
        message: "Invalid config",
        details: "db.main is missing",
        suggestion: "Fix tailor.config.ts",
      },
    });

    expect(freshErdExportFailureMessage(stderr)).toBe(
      "Invalid config\ndb.main is missing\nFix tailor.config.ts",
    );
  });

  test("falls back to the whole output when the last line is not an error envelope", () => {
    expect(freshErdExportFailureMessage("node: bad option\n")).toBe("node: bad option");
  });

  test("returns undefined for empty output", () => {
    expect(freshErdExportFailureMessage("\n")).toBeUndefined();
  });
});

describe("runFreshErdExport", () => {
  let tempDir: string;

  aroundEach(async (runTest) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-export-"));
    await runTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  test("stops the export child when the signal aborts, so an abandoned load does not keep a full export running", async () => {
    const cliEntry = path.join(tempDir, "slow-export.mjs");
    const pidFile = path.join(tempDir, "pid");
    fs.writeFileSync(
      cliEntry,
      `import * as fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const abandoned = new AbortController();
    const exporting = runFreshErdExport({
      cliEntry,
      outputDir: path.join(tempDir, "out"),
      signal: abandoned.signal,
    });
    const outcome = exporting.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true), { timeout: 5000 });
    const pid = Number(fs.readFileSync(pidFile, "utf8"));

    abandoned.abort();

    expect(await outcome).toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false), { timeout: 5000 });
  });
});
