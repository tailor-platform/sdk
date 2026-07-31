import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { statusCommand } from "./status";
import { writeDiff, writeInitialSchema } from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  getMetadata: vi.fn(),
}));

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
        namespace: "tailordb",
        currentMigration: 0,
        pendingMigrations: [{ number: 1 }, { number: 2 }],
      },
    ]);
  });

  test("propagates metadata errors other than NotFound", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/unavailable/);
  });
});
