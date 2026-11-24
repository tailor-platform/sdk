import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchRemoteSchemaSnapshot } from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  SCHEMA_SNAPSHOT_VERSION,
  normalizeSchemaSnapshot,
  type SchemaSnapshot,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { loadTailorDBNamespaces } from "#/cli/shared/tailordb-namespaces";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { scaffoldCommand } from "./scaffold";
import { SCRIPT_DB_TYPES_FILE_NAME, SCRIPT_SNAPSHOT_FILE_NAME } from "./script-scaffold";
import { functionCommand } from "./index";

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfigFile: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/tailordb-namespaces", () => ({
  loadTailorDBNamespaces: vi.fn(),
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

function mockLocalNamespace(snapshot: SchemaSnapshot = makeSnapshot()): void {
  const types = Object.fromEntries(
    Object.entries(snapshot.tables).map(([tableName, table]) => [
      tableName,
      {
        name: table.name,
        pluralForm: table.pluralForm,
        fields: Object.fromEntries(
          Object.entries(table.fields).map(([fieldName, config]) => [fieldName, { config }]),
        ),
        settings: {},
        forwardRelationships: {},
        backwardRelationships: {},
        permissions: {},
      },
    ]),
  );
  vi.mocked(loadTailorDBNamespaces).mockResolvedValue({
    config: {} as never,
    plugins: [],
    namespaces: [{ namespace: snapshot.namespace, tables: types, sourceInfo: new Map() }],
  } as never);
}

function mockConfig(dir: string, options: { plugins?: unknown[]; db?: unknown } = {}): void {
  vi.mocked(loadConfigFile).mockResolvedValue({
    kind: "config",
    config: {
      path: path.join(dir, "tailor.config.ts"),
      db: options.db ?? { tailordb: {} },
    },
    plugins: options.plugins ?? [],
  } as unknown as Awaited<ReturnType<typeof loadConfigFile>>);
}

const kyselyPluginStub = {
  id: "@tailor-platform/kysely-type",
  description: "stub",
  pluginConfig: { distPath: "./generated/tailordb.ts" },
};

describe("function scaffold", () => {
  beforeEach(() => {
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", undefined);
    vi.mocked(loadConfigFile).mockReset();
    vi.mocked(fetchRemoteSchemaSnapshot).mockReset();
    vi.mocked(loadTailorDBNamespaces).mockReset();
    vi.mocked(loadAccessToken).mockClear();
    vi.mocked(loadWorkspaceId).mockClear();
    vi.mocked(initOperatorClient).mockClear();
    vi.mocked(initOperatorClient).mockResolvedValue(mockOperatorClient({}));
    mockLocalNamespace();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("is registered as `scaffold`", async () => {
    using tmp = tempCwd("sdk-function-scaffold-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);

    await runCommand(functionCommand, ["scaffold", "scripts/fix.ts", "--namespace", "tailordb"]);

    expect(fs.existsSync(path.join(tmp.dir, "scripts/fix.ts"))).toBe(true);
  });

  test("runs under the deprecated name `script` and warns that it is removed in v3", async () => {
    using tmp = tempCwd("sdk-function-scaffold-");
    using stderr = captureStderr();
    mockConfig(tmp.dir);

    await runCommand(functionCommand, ["script", "scripts/fix.ts", "--namespace", "tailordb"]);

    expect(fs.existsSync(path.join(tmp.dir, "scripts/fix.ts"))).toBe(true);
    expect(stderr.output).toContain(
      "`tailor function script` is deprecated and will be removed in v3. Use `tailor function scaffold` instead.",
    );
  });

  test("does not warn when invoked as `scaffold`", async () => {
    using tmp = tempCwd("sdk-function-scaffold-");
    using stderr = captureStderr();
    mockConfig(tmp.dir);

    await runCommand(functionCommand, ["scaffold", "scripts/fix.ts", "--namespace", "tailordb"]);

    expect(stderr.output).not.toContain("deprecated");
  });

  test("refreshes a db.ts written by `function script` instead of refusing it as not generated", async () => {
    using tmp = tempCwd("sdk-function-scaffold-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    fs.mkdirSync(path.join(tmp.dir, "scripts"));
    const dbTypesPath = path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME);
    fs.writeFileSync(
      dbTypesPath,
      [
        "/**",
        " * Auto-generated Kysely types for one-off scripts in this directory.",
        " * Generated by `tailor function script` from the selected TailorDB schema.",
        " *",
        " * DO NOT EDIT - Re-run `tailor function script` to refresh.",
        " */",
        "export const stale = true;",
      ].join("\n"),
    );

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    const refreshed = fs.readFileSync(dbTypesPath, "utf-8");
    expect(refreshed).toContain("Generated by `tailor function scaffold`");
    expect(refreshed).not.toContain("stale");
  });

  test("resolves the generated types' distPath against the config's directory", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });
    fs.mkdirSync(path.join(tmp.dir, "sub"));
    process.chdir(path.join(tmp.dir, "sub"));

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    const script = fs.readFileSync(path.join(tmp.dir, "sub/scripts/fix.ts"), "utf-8");
    expect(script).toContain('import { getDB } from "../../generated/tailordb";');
  });

  test("scaffolds a skeleton importing the project's generated types when kyselyTypePlugin is configured", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8");
    expect(script).toContain('import { getDB } from "../generated/tailordb";');
    expect(script).toContain('getDB("tailordb")');
    expect(fs.existsSync(path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME))).toBe(false);
    expect(fs.existsSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME))).toBe(false);
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("scaffolds a skeleton importing getDB from the SDK when kyselyTypePlugin sets contentMapper", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      plugins: [{ ...kyselyPluginStub, pluginConfig: { contentMapper: true } }],
    });

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8");
    expect(script).toContain('import { getDB } from "@tailor-platform/sdk/plugin/kysely-type/db";');
    expect(script).toContain('getDB("tailordb")');
  });

  test("fails when kyselyTypePlugin sets neither distPath nor contentMapper, instead of guessing where getDB comes from", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [{ ...kyselyPluginStub, pluginConfig: {} }] });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/without a distPath or contentMapper: true/);
  });

  test.each([
    { args: [], configHints: [] },
    {
      args: ["--config", "apps/shop/tailor.config.ts"],
      configHints: ["--config=apps/shop/tailor.config.ts"],
    },
  ])(
    "names --config in the next-step hint only when it was given ($args)",
    async ({ args, configHints }) => {
      using tmp = tempCwd("sdk-function-script-");
      using _logger = silenceLogger("info", "success", "warn");
      mockConfig(tmp.dir);

      await runCommand(scaffoldCommand, ["scripts/fix.ts", ...args]);

      const nextHint = vi
        .mocked(logger.info)
        .mock.calls.map(([message]) => String(message))
        .find((message) => message.startsWith("Next:"));
      expect(nextHint).toContain("function run scripts/fix.ts");
      expect(nextHint?.match(/--config=[^\s`]+/g) ?? []).toEqual(configHints);
    },
  );

  test("generates db.ts and db.snapshot.json from local definitions without authentication by default", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

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
    expect(snapshot.source).toBe("local");
    expect(loadTailorDBNamespaces).toHaveBeenCalledWith({
      configPath: undefined,
      namespaces: ["tailordb"],
    });
    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(loadWorkspaceId).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("generates db.ts and db.snapshot.json from the deployed schema with --remote", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb", "--remote"]);

    const snapshot = JSON.parse(
      fs.readFileSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "utf-8"),
    );
    expect(snapshot.source).toBe("remote");
    expect(loadTailorDBNamespaces).not.toHaveBeenCalled();
    expect(loadAccessToken).toHaveBeenCalledOnce();
    expect(loadWorkspaceId).toHaveBeenCalledOnce();
    expect(fetchRemoteSchemaSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "12345678-1234-4abc-8def-123456789012",
      "tailordb",
    );
  });

  test("uses script-scoped remote types instead of kyselyTypePlugin with --remote", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    expect(fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8")).toContain(
      'import { getDB } from "./db";',
    );
    expect(fs.existsSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME))).toBe(true);
  });

  test("generates Temporal remote types when kyselyTypePlugin is configured with temporal", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      plugins: [
        { ...kyselyPluginStub, pluginConfig: { ...kyselyPluginStub.pluginConfig, temporal: true } },
      ],
    });
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    const dbTypes = fs.readFileSync(
      path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME),
      "utf-8",
    );
    expect(dbTypes).toContain("export const getDB = createGetDB<Namespace>({ temporal: true });");
  });

  test("refuses to add remote types to an existing kyselyTypePlugin script", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });
    fs.mkdirSync(path.join(tmp.dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, "scripts/fix.ts"), "export default function main() {}\n");

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "SCRIPT_EXISTS",
      suggestion: expect.stringMatching(/Scaffold --remote at a new path/),
    });
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("refuses to re-scaffold an existing kyselyTypePlugin script", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });
    fs.mkdirSync(path.join(tmp.dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, "scripts/fix.ts"), "export default function main() {}\n");

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "SCRIPT_EXISTS",
      suggestion: expect.stringMatching(/nothing to refresh/),
    });
    expect(loadTailorDBNamespaces).not.toHaveBeenCalled();
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("refreshes generated types and keeps the script when it already exists", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    const scriptPath = path.join(tmp.dir, "scripts/fix.ts");
    fs.writeFileSync(scriptPath, "// edited by the user\n");
    const refreshed = makeSnapshot();
    refreshed.tables.Product!.fields.price = { type: "float", required: false };
    mockLocalNamespace(refreshed);

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

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
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    fs.mkdirSync(path.join(tmp.dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME), "export {};\n");

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Refusing to overwrite/);
  });

  test("rejects a script named db.ts when the generated types would share the path", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    const result = await runCommand(scaffoldCommand, ["scripts/db.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/reserved for the generated Kysely types/);
  });

  test("re-scaffolds over a corrupt snapshot sidecar", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    fs.mkdirSync(path.join(tmp.dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "{broken");

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    const snapshot = JSON.parse(
      fs.readFileSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "utf-8"),
    );
    expect(snapshot.namespace).toBe("tailordb");
  });

  test("rejects --namespace outside the owned namespaces when kyselyTypePlugin is configured", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      plugins: [kyselyPluginStub],
      db: { tailordb: {}, theirs: { external: true } },
    });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "theirs"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/requires --remote/);
  });

  test("auto-selects the single owned namespace over external ones when kyselyTypePlugin is configured", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      plugins: [kyselyPluginStub],
      db: { tailordb: {}, theirs: { external: true } },
    });

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8");
    expect(script).toContain('getDB("tailordb")');
  });

  test("rejects a namespace conflicting with the directory's existing sidecar", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { db: { tailordb: {}, other: {} } });
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "tailordb"]);

    const result = await runCommand(scaffoldCommand, ["scripts/other.ts", "--namespace", "other"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/target namespace "tailordb"/);
  });

  test("keeps refreshing generated types when kyselyTypePlugin is added later", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    mockConfig(tmp.dir, { plugins: [kyselyPluginStub] });
    const refreshed = makeSnapshot();
    refreshed.tables.Product!.fields.price = { type: "float", required: false };
    mockLocalNamespace(refreshed);

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    const dbTypes = fs.readFileSync(
      path.join(tmp.dir, "scripts", SCRIPT_DB_TYPES_FILE_NAME),
      "utf-8",
    );
    expect(dbTypes).toContain("price: number | null;");
    expect(fs.readFileSync(path.join(tmp.dir, "scripts/fix.ts"), "utf-8")).toContain(
      'import { getDB } from "./db";',
    );
  });

  test("requires --namespace when the config defines multiple namespaces", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { db: { one: {}, two: {} } });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/--namespace/);
  });

  test("auto-selects the single owned namespace over external ones for local generation", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      db: { tailordb: {}, theirs: { external: true } },
    });

    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    expect(loadTailorDBNamespaces).toHaveBeenCalledWith({
      configPath: undefined,
      namespaces: ["tailordb"],
    });
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("requires --remote for an external-only config and auto-selects it remotely", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { db: { theirs: { external: true } } });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/External namespaces require --remote/);
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();

    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot({ ...makeSnapshot(), namespace: "theirs" }),
    );
    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    expect(fetchRemoteSchemaSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "12345678-1234-4abc-8def-123456789012",
      "theirs",
    );
  });

  test("requires --remote for an external namespace", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      db: { tailordb: {}, theirs: { external: true } },
    });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "theirs"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/requires --remote/);
    expect(loadTailorDBNamespaces).not.toHaveBeenCalled();
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("uses the deployed schema for an external namespace with --remote", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      db: { tailordb: {}, theirs: { external: true } },
    });
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot({ ...makeSnapshot(), namespace: "theirs" }),
    );

    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "theirs", "--remote"]);

    expect(loadTailorDBNamespaces).not.toHaveBeenCalled();
    expect(fetchRemoteSchemaSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "12345678-1234-4abc-8def-123456789012",
      "theirs",
    );
  });

  test("requires --namespace when --remote includes owned and external namespaces", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, {
      db: { tailordb: {}, theirs: { external: true } },
    });

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Multiple TailorDB namespaces/);
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("switches an owned namespace sidecar back to local unless --remote is repeated", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));
    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);

    vi.mocked(fetchRemoteSchemaSnapshot).mockClear();
    await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    const snapshot = JSON.parse(
      fs.readFileSync(path.join(tmp.dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "utf-8"),
    );
    expect(snapshot.source).toBe("local");
    expect(loadTailorDBNamespaces).toHaveBeenCalledWith({
      configPath: undefined,
      namespaces: ["tailordb"],
    });
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });

  test("requires --remote to refresh a sidecar pinned to an external namespace", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir, { db: { theirs: { external: true } } });
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot({ ...makeSnapshot(), namespace: "theirs" }),
    );
    await runCommand(scaffoldCommand, ["scripts/fix.ts", "--namespace", "theirs", "--remote"]);

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/requires --remote/);
  });

  test("rejects a namespace with no deployed tables", async () => {
    using tmp = tempCwd("sdk-function-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot({ ...makeSnapshot(), tables: {} }),
    );

    const result = await runCommand(scaffoldCommand, ["scripts/fix.ts", "--remote"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/no deployed tables/);
  });
});
