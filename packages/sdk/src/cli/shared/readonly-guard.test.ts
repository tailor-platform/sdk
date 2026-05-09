import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writePlatformConfig } from "./context";
import { isCLIError } from "./errors";
import { assertWritable } from "./readonly-guard";
import { resetKeyringState } from "./token-store";

/**
 * Allowlist of command files that do NOT touch platform state, plus the
 * subcommand routers that only delegate to children. Every other command
 * file under `commands/` must call `assertWritable` so a readonly profile
 * cannot accidentally drive a mutation.
 *
 * Adding a new command? If it is a pure read or local-only operation, add
 * its path here. Otherwise, inject `await assertWritable(...)` at the top
 * of its `run()` and leave this list alone.
 */
const READ_OR_LOCAL_COMMAND_PATHS = new Set([
  // Top-level local-only operations
  "init.ts",
  "login.ts",
  "logout.ts",
  "open.ts",
  "show.ts",
  // API introspection (read-only)
  "api/index.ts",
  "api/inspect.ts",
  "api/list.ts",
  // Auth connections (read-only)
  "authconnection/index.ts",
  "authconnection/list.ts",
  // Crash report (local file ops + reporting endpoint, not workspace state)
  "crash-report/index.ts",
  "crash-report/list.ts",
  "crash-report/send.ts",
  // Executor (read-only)
  "executor/index.ts",
  "executor/get.ts",
  "executor/jobs.ts",
  "executor/list.ts",
  "executor/webhook.ts",
  // Function (read-only / local execution)
  "function/index.ts",
  "function/bundle.ts",
  "function/get.ts",
  "function/list.ts",
  "function/logs.ts",
  // function/test-run.ts is NOT here: it runs user code on the platform server
  // via client.testExecScript, so a readonly profile must block it.
  // Generate (local code generation)
  "generate/index.ts",
  // Machine user (read-only — token retrieval only fetches, does not mutate)
  "machineuser/index.ts",
  "machineuser/list.ts",
  "machineuser/token.ts",
  // OAuth2 client (read-only)
  "oauth2client/index.ts",
  "oauth2client/get.ts",
  "oauth2client/list.ts",
  // Organization (read-only branches; folder/update is write — guarded separately)
  "organization/index.ts",
  "organization/get.ts",
  "organization/list.ts",
  "organization/tree.ts",
  "organization/folder/index.ts",
  "organization/folder/get.ts",
  "organization/folder/list.ts",
  // Profile management — local config only, never platform state
  "profile/index.ts",
  "profile/create.ts",
  "profile/delete.ts",
  "profile/list.ts",
  "profile/update.ts",
  // Secret (read-only)
  "secret/index.ts",
  "secret/list.ts",
  "secret/vault/index.ts",
  "secret/vault/list.ts",
  // Setup (local file generation)
  "setup/index.ts",
  "setup/github/index.ts",
  // Skills (local file install)
  "skills/index.ts",
  "skills/install.ts",
  // Static website (read-only)
  "staticwebsite/index.ts",
  "staticwebsite/get.ts",
  "staticwebsite/list.ts",
  // TailorDB (read-only / local ops)
  "tailordb/index.ts",
  "tailordb/erd/index.ts",
  "tailordb/erd/export.ts",
  "tailordb/erd/serve.ts",
  "tailordb/migrate/index.ts",
  "tailordb/migrate/generate.ts",
  "tailordb/migrate/status.ts",
  // Upgrade (local SDK upgrade)
  "upgrade/index.ts",
  // User (read-only / local switch)
  "user/index.ts",
  "user/current.ts",
  "user/list.ts",
  "user/switch.ts",
  "user/pat/index.ts",
  "user/pat/list.ts",
  // Workflow (read-only branches)
  "workflow/index.ts",
  "workflow/executions.ts",
  "workflow/get.ts",
  "workflow/list.ts",
  // Workspace (read-only branches)
  "workspace/index.ts",
  "workspace/get.ts",
  "workspace/list.ts",
  "workspace/app/index.ts",
  "workspace/app/health.ts",
  "workspace/app/list.ts",
  "workspace/user/index.ts",
  "workspace/user/list.ts",
]);

/**
 * Recursively list `*.ts` files under `dir`, excluding tests and fixtures.
 * Paths are returned relative to `dir` with forward slashes.
 * @param dir - Root directory to walk
 * @returns Relative file paths
 */
function listCommandSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__test_fixtures__") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = listCommandSourceFiles(child).map((p) => `${entry.name}/${p}`);
      out.push(...nested);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    out.push(entry.name);
  }
  return out;
}

/**
 * Decide whether a file defines a runnable CLI command. Helper modules that
 * only export utilities are skipped because they are exercised through the
 * commands that import them.
 * @param source - File source code
 * @returns Whether the file defines a runnable command
 */
function isRunnableCommandFile(source: string): boolean {
  const definesCommand = source.includes("defineAppCommand(") || source.includes("defineCommand(");
  if (!definesCommand) return false;
  return /\brun\s*[:(]/.test(source);
}

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-readonly-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    setPassword() {}
    getPassword(): string | null {
      return null;
    }
    deletePassword() {}
  },
}));

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

const validUUID = "12345678-1234-4abc-8def-123456789012";

describe("assertWritable", () => {
  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        rw: { user: "u@example.com", workspace_id: validUUID },
        ro: { user: "u@example.com", workspace_id: validUUID, readonly: true },
        ro_false: { user: "u@example.com", workspace_id: validUUID, readonly: false },
      },
      current_user: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves when no profile is in scope", async () => {
    await expect(assertWritable()).resolves.toBeUndefined();
  });

  it("resolves when explicit profile has readonly undefined", async () => {
    await expect(assertWritable({ profile: "rw" })).resolves.toBeUndefined();
  });

  it("resolves when explicit profile has readonly false", async () => {
    await expect(assertWritable({ profile: "ro_false" })).resolves.toBeUndefined();
  });

  it("resolves silently when profile not found (deferring error to caller)", async () => {
    await expect(assertWritable({ profile: "missing" })).resolves.toBeUndefined();
  });

  it("throws CLIError with PROFILE_READONLY when profile is readonly via opts", async () => {
    const promise = assertWritable({ profile: "ro" });
    await expect(promise).rejects.toThrow('Profile "ro" is read-only.');
    await promise.catch((err) => {
      expect(isCLIError(err)).toBe(true);
      expect(err.code).toBe("PROFILE_READONLY");
    });
  });

  it("throws when readonly profile is selected via TAILOR_PLATFORM_PROFILE env", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "ro");
    await expect(assertWritable()).rejects.toThrow('Profile "ro" is read-only.');
  });

  it("opts.profile takes precedence over env (rw opts wins over ro env)", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "ro");
    await expect(assertWritable({ profile: "rw" })).resolves.toBeUndefined();
  });

  it("opts.profile takes precedence over env (ro opts loses to rw env? no — opts wins, throws)", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "rw");
    await expect(assertWritable({ profile: "ro" })).rejects.toThrow('Profile "ro" is read-only.');
  });
});

describe("write command coverage", () => {
  const commandsDir = path.resolve(__dirname, "..", "commands");

  it("every runnable command not on the read-only allowlist calls assertWritable", () => {
    // Must match an actual call site, not just the import statement, so that
    // deleting the call (while leaving the import) still fails this test.
    const callPattern = /\bawait\s+assertWritable\s*\(/;
    const offenders: string[] = [];
    for (const relativePath of listCommandSourceFiles(commandsDir)) {
      if (READ_OR_LOCAL_COMMAND_PATHS.has(relativePath)) continue;
      const source = fs.readFileSync(path.join(commandsDir, relativePath), "utf-8");
      if (!isRunnableCommandFile(source)) continue;
      if (!callPattern.test(source)) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("read-only allowlist entries reference real files", () => {
    const missing: string[] = [];
    for (const relativePath of READ_OR_LOCAL_COMMAND_PATHS) {
      if (!fs.existsSync(path.join(commandsDir, relativePath))) {
        missing.push(relativePath);
      }
    }
    expect(missing).toEqual([]);
  });
});
