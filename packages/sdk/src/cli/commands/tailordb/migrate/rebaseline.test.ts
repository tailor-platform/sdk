import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { prompt } from "#/cli/shared/prompt";
import { rebaselineCommand } from "./rebaseline";
import {
  parsedType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
  listTailorDBTypes: vi.fn(),
  listTailorDBGQLPermissions: vi.fn(),
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

vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    tailorDBServices: [
      {
        namespace: "tailordb",
        config: { files: [] },
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        get types() {
          return state.localTypes;
        },
      },
    ],
  })),
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
    plugins: [],
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

function remoteType(name: string): Record<string, unknown> {
  return {
    name,
    schema: {
      fields: {
        id: {
          type: "uuid",
          required: true,
          allowedValues: [],
          validate: [],
          fields: {},
        },
        name: {
          type: "string",
          required: true,
          allowedValues: [],
          validate: [],
          fields: {},
        },
      },
      settings: {
        pluralForm: `${name}s`,
        aggregation: false,
        bulkUpsert: false,
        publishRecordEvents: false,
        disableGqlOperations: {
          create: false,
          update: false,
          delete: false,
          read: false,
        },
      },
      relationships: {},
      indexes: {},
      files: {},
    },
  };
}

function migrationDirectories(): string[] {
  return fs
    .readdirSync(state.migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

describe("tailordb migration rebaseline", () => {
  aroundEach(async (runTest) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-rebaseline-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    writeDiff(state.migrationsDir, 1, [
      { kind: "type_added", typeName: "Post", after: snapshotType("Post") },
    ]);
    fs.writeFileSync(path.join(state.migrationsDir, "0001", "migrate.ts"), "export {};");
    fs.writeFileSync(path.join(state.migrationsDir, "0001", "db.ts"), "export {};");
    state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
    mockConfig();

    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001", "sdk-name": "my-app" } },
    });
    state.setMetadata.mockResolvedValue({});
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User"), remoteType("Post")],
      nextPageToken: "",
    });
    state.listTailorDBGQLPermissions.mockResolvedValue({ permissions: [], nextPageToken: "" });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getMetadata: state.getMetadata,
      setMetadata: state.setMetadata,
      listTailorDBTypes: state.listTailorDBTypes,
      listTailorDBGQLPermissions: state.listTailorDBGQLPermissions,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    await runTest();

    vi.restoreAllMocks();
    state.getMetadata.mockReset();
    state.setMetadata.mockReset();
    state.listTailorDBTypes.mockReset();
    state.listTailorDBGQLPermissions.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("collapses the full history into a current-format baseline and resets the checkpoint", async () => {
    fs.writeFileSync(path.join(state.migrationsDir, "README.md"), "migration notes");
    fs.mkdirSync(path.join(state.migrationsDir, "fixtures"));
    fs.writeFileSync(path.join(state.migrationsDir, "fixtures", "seed.json"), "{}");
    fs.mkdirSync(path.join(state.migrationsDir, "2026"));
    fs.writeFileSync(path.join(state.migrationsDir, "2026", "notes.md"), "not a migration");
    fs.mkdirSync(path.join(state.migrationsDir, "0005"));
    fs.writeFileSync(path.join(state.migrationsDir, "0005", "migrate.ts"), "export {};");
    fs.writeFileSync(path.join(state.migrationsDir, "0005", "db.ts"), "export {};");
    fs.writeFileSync(path.join(state.migrationsDir, "9999"), "not a migration directory");

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(true);
    expect(migrationDirectories()).toEqual(["0000", "2026", "fixtures"]);
    const baseline = JSON.parse(
      fs.readFileSync(path.join(state.migrationsDir, "0000", "schema.json"), "utf-8"),
    ) as { version: number; types: Record<string, unknown> };
    expect(baseline.version).toBe(2);
    expect(Object.keys(baseline.types).toSorted()).toEqual(["Post", "User"]);
    expect(baseline).toMatchObject({ namespace: "tailordb" });
    expect(fs.readFileSync(path.join(state.migrationsDir, "README.md"), "utf-8")).toBe(
      "migration notes",
    );
    expect(fs.readFileSync(path.join(state.migrationsDir, "fixtures", "seed.json"), "utf-8")).toBe(
      "{}",
    );
    expect(fs.readFileSync(path.join(state.migrationsDir, "2026", "notes.md"), "utf-8")).toBe(
      "not a migration",
    );
    expect(fs.readFileSync(path.join(state.migrationsDir, "9999"), "utf-8")).toBe(
      "not a migration directory",
    );
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0000", "sdk-name": "my-app" },
      }),
    );
  });

  test("rejects ungenerated local schema changes before reading the remote", async () => {
    state.localTypes = { User: parsedType("User") };

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(
      /migration history must reproduce the current local schema/i,
    );
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.getMetadata).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("writes the selected namespace instead of preserving a stale snapshot namespace", async () => {
    const schemaPath = path.join(state.migrationsDir, "0000", "schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(schemaPath, JSON.stringify({ ...schema, namespace: "stale-namespace" }));

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as {
      namespace: string;
    };
    expect(baseline.namespace).toBe("tailordb");
  });

  test("rejects when the connected workspace has not applied the latest migration", async () => {
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0000", "sdk-name": "my-app" } },
    });

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/must be at the latest migration 0001/i);
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects when the connected workspace schema differs from the latest snapshot", async () => {
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User")],
      nextPageToken: "",
    });

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/remote schema must match the latest migration/i);
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("does not change local or remote state when confirmation is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(rebaselineCommand, []);

    expect(result.success).toBe(true);
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects migration files changed while waiting for confirmation", async () => {
    vi.mocked(prompt.confirm).mockImplementation(async () => {
      fs.writeFileSync(path.join(state.migrationsDir, "0001", "migrate.ts"), "export const x = 1;");
      return true;
    });

    const result = await runCommand(rebaselineCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/migration files changed while waiting for confirmation/i);
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects orphaned migration artifacts added while waiting for confirmation", async () => {
    vi.mocked(prompt.confirm).mockImplementation(async () => {
      const orphanDir = path.join(state.migrationsDir, "0005");
      fs.mkdirSync(orphanDir);
      fs.writeFileSync(path.join(orphanDir, "migrate.ts"), "export {};");
      return true;
    });

    const result = await runCommand(rebaselineCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/migration files changed while waiting for confirmation/i);
    expect(migrationDirectories()).toEqual(["0000", "0001", "0005"]);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects local type changes made while waiting for confirmation", async () => {
    vi.mocked(prompt.confirm).mockImplementation(async () => {
      state.localTypes = { User: parsedType("User") };
      return true;
    });

    const result = await runCommand(rebaselineCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(
      /migration history must reproduce the current local schema/i,
    );
    expect(migrationDirectories()).toEqual(["0000", "0001"]);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("requires --namespace when multiple namespaces have migrations", async () => {
    mockConfig(["tailordb", "analyticsdb"]);

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/specify namespace with --namespace/);
    expect(state.getMetadata).not.toHaveBeenCalled();
  });

  test("keeps the activated baseline when the checkpoint update fails", async () => {
    state.setMetadata.mockRejectedValue(new Error("metadata unavailable"));

    const result = await runCommand(rebaselineCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/local migration history was re-baselined/i);
    expect(migrationDirectories()).toEqual(["0000"]);
  });
});
