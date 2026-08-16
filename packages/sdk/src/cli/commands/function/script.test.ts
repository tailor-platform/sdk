import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetchRemoteSchemaSnapshot } from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  SCHEMA_SNAPSHOT_VERSION,
  normalizeSchemaSnapshot,
  type SchemaSnapshot,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { scriptCommand } from "./script";
import { SCRIPT_DB_TYPES_FILE_NAME, SCRIPT_SNAPSHOT_FILE_NAME } from "./script-scaffold";

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/commands/tailordb/migrate/schema-checks", async (importActual) => {
  const actual = await importActual<object>();
  return { ...actual, fetchRemoteSchemaSnapshot: vi.fn() };
});

function makeSnapshot(): SchemaSnapshot {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    tables: {
      Product: {
        name: "Product",
        pluralForm: "products",
        fields: {
          name: { type: "string", required: true },
        },
      },
    },
  };
}

function mockConfig(dir: string, options: { plugins?: unknown[]; db?: unknown } = {}): void {
  vi.mocked(loadConfig).mockResolvedValue({
    config: {
      path: path.join(dir, "tailor.config.ts"),
      db: options.db ?? { tailordb: {} },
    },
    plugins: options.plugins ?? [],
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

const kyselyPluginStub = {
  id: "@tailor-platform/kysely-type",
  description: "stub",
  pluginConfig: { distPath: "./generated/tailordb.ts" },
};

describe("function script", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReset();
    vi.mocked(fetchRemoteSchemaSnapshot).mockReset();
    vi.mocked(initOperatorClient).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );
  });

  test("scaffolds a skeleton importing the project's generated types when kyselyTypePlugin is configured", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir), { plugins: [kyselyPluginStub] });

    await runCommand(scriptCommand, ["scripts/fix.ts"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8");
    expect(script).toContain('import { getDB } from "../generated/tailordb";');
    expect(script).toContain('getDB("tailordb")');
    expect(fs.existsSync(path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME))).toBe(false);
    expect(fs.existsSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME))).toBe(false);
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("generates db.ts and db.snapshot.json from the deployed schema without the plugin", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir));
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    await runCommand(scriptCommand, ["scripts/fix.ts"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8");
    expect(script).toContain('import { getDB } from "./db";');
    const dbTypes = fs.readFileSync(
      path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME),
      "utf-8",
    );
    expect(dbTypes).toContain("export const getDB = createGetDB<Namespace>();");
    expect(dbTypes).toContain("Product: {");
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "utf-8"),
    );
    expect(snapshot.namespace).toBe("tailordb");
  });

  test("refreshes generated types and keeps the script when it already exists", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir));
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    await runCommand(scriptCommand, ["scripts/fix.ts"]);

    const scriptPath = path.join(tmp.dir, "scripts/fix.ts");
    fs.writeFileSync(scriptPath, "// edited by the user\n");
    const refreshed = makeSnapshot();
    refreshed.tables.Product!.fields.price = { type: "float", required: false };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(refreshed));

    await runCommand(scriptCommand, ["scripts/fix.ts"]);

    expect(fs.readFileSync(scriptPath, "utf-8")).toBe("// edited by the user\n");
    const dbTypes = fs.readFileSync(
      path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME),
      "utf-8",
    );
    expect(dbTypes).toContain("price: number | null;");
  });

  test("refuses to overwrite a db.ts the scaffold did not generate", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir));
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    fs.mkdirSync(path.join(tmp.dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME), "export {};\n");

    const result = await runCommand(scriptCommand, ["scripts/fix.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Refusing to overwrite/);
  });

  test("requires --namespace when the config defines multiple namespaces", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir), { db: { one: {}, two: {} } });

    const result = await runCommand(scriptCommand, ["scripts/fix.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/--namespace/);
  });

  test("rejects a namespace with no deployed tables", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(fs.realpathSync(tmp.dir));
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot({ ...makeSnapshot(), tables: {} }),
    );

    const result = await runCommand(scriptCommand, ["scripts/fix.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/no deployed tables/);
  });
});
