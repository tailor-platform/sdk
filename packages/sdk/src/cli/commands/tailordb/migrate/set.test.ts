import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { prompt } from "#/cli/shared/prompt";
import { setCommand } from "./set";
import { snapshotType, writeDiff, writeInitialSchema } from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
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

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: { confirm: vi.fn() },
}));

function mockConfig(namespaces: string[] = ["tailordb"]): void {
  const db: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    db[namespace] = { migration: { directory: state.migrationsDir } };
  }
  vi.mocked(loadConfig).mockResolvedValue({
    config: {
      path: path.join(path.dirname(state.migrationsDir), "tailor.config.ts"),
      db,
    },
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

describe("tailordb migration set", () => {
  aroundEach(async (runTest) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-set-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    writeDiff(state.migrationsDir, 1, [
      { kind: "type_added", typeName: "Post", after: snapshotType("Post") },
    ]);
    writeDiff(state.migrationsDir, 2, []);
    mockConfig();

    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0002", "sdk-name": "my-app" },
      },
    });
    state.setMetadata.mockResolvedValue({});
    vi.mocked(initOperatorClient).mockResolvedValue({
      getMetadata: state.getMetadata,
      setMetadata: state.setMetadata,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    await runTest();

    vi.restoreAllMocks();
    vi.mocked(prompt.confirm).mockReset();
    state.getMetadata.mockReset();
    state.setMetadata.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("sets the checkpoint label preserving other labels", async () => {
    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001", "sdk-name": "my-app" },
      }),
    );
  });

  test("sets the current migration history generation from a re-baselined snapshot", async () => {
    const schemaPath = path.join(state.migrationsDir, "0000", "schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
        ...schema,
        rebaseline: {
          historyId: "hcurrent",
          replacedHistoryId: null,
          replacedLatestMigration: 2,
        },
      }),
    );

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: {
          "sdk-migration": "m0001",
          "sdk-migration-history": "hcurrent",
          "sdk-name": "my-app",
        },
      }),
    );
  });

  test("removes a stale remote history generation for a markerless local history", async () => {
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0002",
          "sdk-migration-history": "hstale",
          "sdk-name": "my-app",
        },
      },
    });

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001", "sdk-name": "my-app" },
      }),
    );
  });

  test("accepts 4-digit migration numbers", async () => {
    const result = await runCommand(setCommand, ["0001", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0001" }),
      }),
    );
  });

  test("accepts 0 as the baseline", async () => {
    const result = await runCommand(setCommand, ["0", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("accepts 0 even when no migrations directory exists", async () => {
    fs.rmSync(state.migrationsDir, { recursive: true, force: true });

    const result = await runCommand(setCommand, ["0", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test.each(["abc", "1abc", "00", "01"])(
    "rejects invalid migration number format %j",
    async (input) => {
      const result = await runCommand(setCommand, [input, "--yes"]);

      expect(result.success).toBe(false);
      expect(String(result.error)).toMatch(/Invalid migration number format/);
      expect(state.setMetadata).not.toHaveBeenCalled();
    },
  );

  test("rejects migration numbers above 9999", async () => {
    const result = await runCommand(setCommand, ["12345", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/out of range/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects a migration number beyond the working tree's latest", async () => {
    const result = await runCommand(setCommand, ["3", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/does not exist in working tree/);
    expect(state.getMetadata).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects a migration number missing from a gapped history", async () => {
    fs.rmSync(path.join(state.migrationsDir, "0001"), { recursive: true, force: true });

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration file validation failed/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects when the history has a gap below the target number", async () => {
    fs.rmSync(path.join(state.migrationsDir, "0001"), { recursive: true, force: true });

    const result = await runCommand(setCommand, ["2", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration file validation failed/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("preserves labels updated while the confirmation prompt is open", async () => {
    state.getMetadata
      .mockResolvedValueOnce({
        metadata: { labels: { "sdk-migration": "m0002", "sdk-name": "my-app" } },
      })
      .mockResolvedValueOnce({
        metadata: {
          labels: { "sdk-migration": "m0002", "sdk-name": "my-app", "added-later": "yes" },
        },
      });

    const result = await runCommand(setCommand, ["1"]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledTimes(1);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001", "sdk-name": "my-app", "added-later": "yes" },
      }),
    );
  });

  test("shows <unset> instead of 0000 when no checkpoint label exists", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    const output = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Current migration: <unset>");
  });

  test("still sets the label when namespace metadata does not exist yet", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001" },
      }),
    );
  });

  test("aborts before prompting when reading metadata fails with a non-NotFound error", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));

    const result = await runCommand(setCommand, ["1"]);

    expect(result.success).toBe(false);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("makes no changes when the confirmation prompt is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(setCommand, ["1"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("requires --namespace when multiple namespaces have migrations", async () => {
    mockConfig(["tailordb", "analyticsdb"]);

    const result = await runCommand(setCommand, ["1", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/specify namespace with --namespace/);
  });

  test("rejects an unknown --namespace", async () => {
    const result = await runCommand(setCommand, ["1", "--yes", "--namespace", "nope"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not found or does not have migrations configured/);
  });
});
