import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { statusCommand } from "./status";
import { writeDiff, writeInitialSchema } from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  getMetadata: vi.fn(),
}));

function markHistoryAsRebaselined(historyId = "hlocal"): void {
  const schemaPath = path.join(state.migrationsDir, "0000", "schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
  fs.writeFileSync(
    schemaPath,
    JSON.stringify({
      ...schema,
      rebaseline: {
        historyId,
        replacedHistoryId: null,
        replacedLatestMigration: 0,
      },
    }),
  );
}

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

describe("tailordb migration status --json", () => {
  aroundEach(async (runTest) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-status-json-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");
    vi.mocked(loadAccessToken).mockReset().mockResolvedValue("mock-token");
    vi.mocked(initOperatorClient).mockReset();
    writeInitialSchema(state.migrationsDir, {});
    writeDiff(state.migrationsDir, 1, [], { description: "Add users" });
    writeDiff(state.migrationsDir, 2, [], { description: "Add orders" });

    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        db: {
          tailordb: {
            migration: {
              directory: state.migrationsDir,
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0001",
        },
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getMetadata: state.getMetadata,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    await runTest();

    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits a parseable JSON array of namespace migration statuses", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
        currentMigrationLabel: "0001",
        pendingMigrations: [
          {
            number: 2,
            label: "0002",
            description: "Add orders",
          },
        ],
      },
    ]);
  });

  test("treats metadata NotFound as no applied migrations", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 0,
        pendingMigrations: [{ number: 1 }, { number: 2 }],
      },
    ]);
  });

  test("propagates metadata errors other than NotFound", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration status check failed for 1 namespace: tailordb/);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("unavailable"),
      },
    ]);
  });

  test("reports unsupported pending migration file versions", async () => {
    fs.writeFileSync(
      path.join(state.migrationsDir, "0002", "diff.json"),
      JSON.stringify({ version: 4 }),
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("This SDK supports migration file format versions 1-3"),
      },
    ]);
  });

  test("reports unsupported local versions before loading credentials", async () => {
    fs.writeFileSync(
      path.join(state.migrationsDir, "0002", "diff.json"),
      JSON.stringify({ version: 4 }),
    );
    vi.mocked(loadAccessToken).mockRejectedValueOnce(new Error("authentication unavailable"));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("This SDK supports migration file format versions 1-3"),
      },
    ]);
    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test.each([
    ["baseline", "0000/schema.json"],
    ["applied diff", "0001/diff.json"],
  ])("reports unsupported versions in the %s", async (_description, relativePath) => {
    const filePath = path.join(state.migrationsDir, relativePath);
    const contents = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(filePath, JSON.stringify({ ...contents, version: 4 }));
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0002" } },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("This SDK supports migration file format versions 1-3"),
      },
    ]);
  });

  test("reports a remote migration history mismatch", async () => {
    markHistoryAsRebaselined();
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hremote" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringMatching(/remote migration history .*hremote.*local.*hlocal/i),
      },
    ]);
  });

  test("identifies a migration history mismatch in human-readable output", async () => {
    markHistoryAsRebaselined();
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hremote" },
      },
    });
    using stderr = captureStderr();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain(
      "Migration status error: Remote migration history ID hremote does not match local migration history ID hlocal.",
    );
    expect(stderr.output).not.toContain("Failed to read migration state");
  });

  test("accepts a matching remote migration history", async () => {
    markHistoryAsRebaselined();
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hlocal" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
      },
    ]);
  });

  test("does not report a history mismatch for an undeployed namespace", async () => {
    markHistoryAsRebaselined();
    state.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 0,
      },
    ]);
  });

  test("keeps reporting healthy namespaces when another namespace fails", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(path.dirname(state.migrationsDir), "tailor.config.ts"),
        db: {
          tailordb: { migration: { directory: state.migrationsDir } },
          analyticsdb: { migration: { directory: state.migrationsDir } },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    state.getMetadata.mockImplementation(({ trn }: { trn: string }) =>
      trn.endsWith("analyticsdb")
        ? Promise.reject(new ConnectError("unavailable", Code.Unavailable))
        : Promise.resolve({ metadata: { labels: { "sdk-migration": "m0001" } } }),
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(
      /Migration status check failed for 1 namespace: analyticsdb/,
    );
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
        pendingMigrations: [{ number: 2 }],
      },
      {
        status: "error",
        namespace: "analyticsdb",
        error: expect.stringContaining("unavailable"),
      },
    ]);
  });
});
