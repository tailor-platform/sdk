import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { defineTailorDBReplicationDestination } from "#/configure/services/tailordb-replication/index";
import {
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "#/configure/services/tailordb/permission";
import { db } from "#/configure/services/tailordb/schema";
import { PluginManager } from "#/plugin/manager";
import { defineApplication, loadApplication } from "./application";
import type { CLIError } from "#/cli/shared/errors";
import type { AppConfig } from "#/configure/config/types";
import type {
  TailorDBPluginTablesConfig,
  TailorDBReplicationsConfig,
} from "#/configure/services/tailordb-replication/types";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";
import type { Plugin } from "#/plugin/types";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

type ConfigOverrides = Partial<Pick<AppConfig, "db" | "dbReplicationDestinations">>;

function configOf(overrides: ConfigOverrides, dir = "/project") {
  return {
    ...defineConfig({ name: "shop", ...overrides }),
    path: path.join(dir, "tailor.config.ts"),
  };
}

describe("defineApplication TailorDB replications", () => {
  test("collects each namespace's replications and the destinations they use", () => {
    const application = defineApplication({
      config: configOf({
        db: {
          "main-db": {
            files: [],
            replications: {
              analytics: { destination: warehouse, tablePrefix: "shop_" },
              lake: undefined,
            },
          },
        },
      }),
    });

    expect(application.dbReplicationDestinations).toEqual([
      { name: "warehouse", bigquery: { project: "acme-analytics", dataset: "tailor" } },
    ]);
    expect(application.dbReplications).toEqual([
      {
        name: "analytics",
        source: { namespace: "main-db" },
        destination: "warehouse",
        tablePrefix: "shop_",
        enabled: true,
        types: [],
      },
    ]);
  });

  test("keeps a listed destination no replication uses", () => {
    const application = defineApplication({
      config: configOf({ dbReplicationDestinations: [warehouse] }),
    });

    expect(application.dbReplicationDestinations.map(({ name }) => name)).toEqual(["warehouse"]);
  });

  test("rejects two different destinations with the same name", () => {
    const other = defineTailorDBReplicationDestination("warehouse", {
      bigquery: { project: "acme-analytics", dataset: "lake" },
    });

    expect(() =>
      defineApplication({
        config: configOf({
          dbReplicationDestinations: [warehouse],
          db: { "main-db": { files: [], replications: { analytics: { destination: other } } } },
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'db.main-db.replications.analytics.destination: Two different destinations are named "warehouse"',
        ),
      }),
    );
  });

  test("rejects two destinations for the same dataset", () => {
    const copy = defineTailorDBReplicationDestination("warehouse-copy", {
      bigquery: { project: "acme-analytics", dataset: "tailor" },
    });

    expect(() =>
      defineApplication({ config: configOf({ dbReplicationDestinations: [warehouse, copy] }) }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'dbReplicationDestinations.1.bigquery: Destination "warehouse-copy" writes to the same dataset as destination "warehouse"',
        ),
      }),
    );
  });

  test("compares datasets case-insensitively", () => {
    const upper = defineTailorDBReplicationDestination("warehouse-upper", {
      bigquery: { project: "acme-analytics", dataset: "TAILOR" },
    });

    expect(() =>
      defineApplication({ config: configOf({ dbReplicationDestinations: [warehouse, upper] }) }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'Destination "warehouse-upper" writes to the same dataset as destination "warehouse"',
        ),
      }),
    );
  });

  test("rejects one replication name in two namespaces", () => {
    expect(() =>
      defineApplication({
        config: configOf({
          db: {
            "main-db": { files: [], replications: { analytics: { destination: warehouse } } },
            "order-db": { files: [], replications: { analytics: { destination: warehouse } } },
          },
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'db.order-db.replications.analytics: Replication "analytics" is also declared by TailorDB namespace "main-db"',
        ),
      }),
    );
  });
});

describe("loadApplication TailorDB replication tables", () => {
  let tmpDir: string;

  aroundEach(async (runTest) => {
    // Inside the SDK package, so the table file resolves `@tailor-platform/sdk`.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".replication-")));
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(tmpDir, ".tailor"));
    try {
      await runTest();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  type LoadParams = {
    userTable?: string;
    replications?: TailorDBReplicationsConfig;
    plugins?: Plugin[];
    pluginTables?: TailorDBPluginTablesConfig;
  };

  async function load(params: LoadParams) {
    const userFile = path.join(tmpDir, "user.ts");
    fs.writeFileSync(
      userFile,
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    embedding: db.string().vector(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission)
  ${params.userTable ?? ""};
`,
    );
    const { application } = await loadApplication({
      config: configOf(
        {
          db: {
            "main-db": {
              files: [userFile],
              replications: params.replications ?? {
                analytics: { destination: warehouse },
                lake: { destination: warehouse, tablePrefix: "lake_" },
              },
              ...(params.pluginTables && { pluginTables: params.pluginTables }),
            },
          },
        },
        tmpDir,
      ),
      ...(params.plugins && { pluginManager: new PluginManager(params.plugins) }),
    });
    return application.dbReplications.map(({ name, types }) => ({ name, types }));
  }

  function pluginTable(name: string) {
    return db
      .table(name, { action: db.string(), ip: db.string() })
      .permission(unsafeAllowAllTypePermission)
      .gqlPermission(unsafeAllowAllGqlPermission);
  }

  function namespacePlugin(id: string, generate: () => TailorAnyDBType): Plugin {
    return {
      id,
      description: `Generate the ${id} table`,
      importPath: `@example/${id}`,
      onTailorDBNamespaceLoaded: () => ({ tables: { [id]: generate() } }),
    };
  }

  function auditLogPlugin(generate: () => TailorAnyDBType = () => pluginTable("AuditLog")): Plugin {
    return namespacePlugin("audit-log", generate);
  }

  const archivePlugin: Plugin = {
    id: "archive",
    description: "Generate an archive table for each table",
    importPath: "@example/archive",
    onTableLoaded: (context) => ({
      tables: { archive: pluginTable(`${context.table.name}Archive`) },
    }),
  };

  test("adds a table without targets to every replication of the namespace", async () => {
    const replications = await load({ userTable: '.replication({ excludeFields: ["email"] })' });

    expect(replications).toEqual([
      { name: "analytics", types: [{ name: "User", excludeFields: ["email"] }] },
      { name: "lake", types: [{ name: "User", excludeFields: ["email"] }] },
    ]);
  });

  test("adds a table to the replications it targets, with their fields", async () => {
    const replications = await load({
      userTable:
        '.replication({ targets: ["analytics"], includeFields: ["name"] }, { targets: ["lake"] })',
    });

    expect(replications).toEqual([
      { name: "analytics", types: [{ name: "User", includeFields: ["name"] }] },
      { name: "lake", types: [{ name: "User" }] },
    ]);
  });

  test("accepts a target the namespace declares but does not deploy", async () => {
    const replications = await load({
      userTable: '.replication({ targets: ["lake"] })',
      replications: { analytics: { destination: warehouse }, lake: undefined },
    });

    expect(replications).toEqual([{ name: "analytics", types: [] }]);
  });

  test("leaves a table without .replication() out", async () => {
    const replications = await load({});

    expect(replications.every(({ types }) => types.length === 0)).toBe(true);
  });

  test.each<{ title: string; pluginTables?: TailorDBPluginTablesConfig }>([
    { title: "pluginTables does not name" },
    { title: "pluginTables sets no replication for", pluginTables: { AuditLog: {} } },
  ])("keeps the plugin's .replication() for a table $title", async ({ pluginTables }) => {
    const replications = await load({
      plugins: [
        auditLogPlugin(() => pluginTable("AuditLog").replication({ excludeFields: ["ip"] })),
      ],
      ...(pluginTables && { pluginTables }),
    });

    expect(replications).toEqual([
      { name: "analytics", types: [{ name: "AuditLog", excludeFields: ["ip"] }] },
      { name: "lake", types: [{ name: "AuditLog", excludeFields: ["ip"] }] },
    ]);
  });

  test("replaces the plugin's .replication() with the table's pluginTables entries", async () => {
    const replications = await load({
      plugins: [
        auditLogPlugin(() => pluginTable("AuditLog").replication({ excludeFields: ["ip"] })),
      ],
      pluginTables: {
        AuditLog: { replication: [{ targets: ["analytics"], includeFields: ["action"] }] },
      },
    });

    expect(replications).toEqual([
      { name: "analytics", types: [{ name: "AuditLog", includeFields: ["action"] }] },
      { name: "lake", types: [] },
    ]);
  });

  test("leaves out a table whose pluginTables replication is false", async () => {
    const replications = await load({
      plugins: [auditLogPlugin(() => pluginTable("AuditLog").replication({}))],
      pluginTables: { AuditLog: { replication: false } },
    });

    expect(replications).toEqual([
      { name: "analytics", types: [] },
      { name: "lake", types: [] },
    ]);
  });

  test("replicates a table the plugin does not call .replication() on", async () => {
    const replications = await load({
      plugins: [auditLogPlugin()],
      pluginTables: { AuditLog: { replication: [{}] } },
    });

    expect(replications).toEqual([
      { name: "analytics", types: [{ name: "AuditLog" }] },
      { name: "lake", types: [{ name: "AuditLog" }] },
    ]);
  });

  test("sets a table a plugin generates for another table", async () => {
    const replications = await load({
      plugins: [archivePlugin],
      userTable: ".plugin({ archive: {} } as never)",
      pluginTables: { UserArchive: { replication: [{ targets: ["lake"] }] } },
    });

    expect(replications).toEqual([
      { name: "analytics", types: [] },
      { name: "lake", types: [{ name: "UserArchive" }] },
    ]);
  });

  test("accepts a plugin target the namespace does not declare when pluginTables replaces it", async () => {
    const replications = await load({
      plugins: [
        auditLogPlugin(() => pluginTable("AuditLog").replication({ targets: ["archive"] })),
      ],
      pluginTables: { AuditLog: { replication: [{ targets: ["lake"] }] } },
    });

    expect(replications).toEqual([
      { name: "analytics", types: [] },
      { name: "lake", types: [{ name: "AuditLog" }] },
    ]);
  });

  const keySuggestion =
    "Key pluginTables by the names of tables that plugins generate in the namespace, and set how a table you define is replicated with .replication() on it.";
  const pluginReplicationSuggestion =
    "Replace the replication a plugin sets on a table it generates with db.<namespace>.pluginTables.<table>.replication.";

  test.each<{ title: string; params: LoadParams; issues: string[]; suggestion?: string }>([
    {
      title: "a target the namespace does not declare",
      params: { userTable: '.replication({ targets: ["archive"] })' },
      issues: [
        'db.main-db.tables.User.replication.0.targets: Table "User" names replication "archive", which TailorDB namespace "main-db" does not declare in replications',
      ],
    },
    {
      title: "one replication set twice",
      params: { userTable: '.replication({}, { targets: ["lake"] })' },
      issues: [
        'db.main-db.tables.User.replication.1: Table "User" sets replication "lake" more than once',
      ],
    },
    {
      title: "a field the table does not have",
      params: { userTable: '.replication({ excludeFields: ["phone"] })' },
      issues: [
        'db.main-db.tables.User.replication.0.excludeFields.0: Table "User" has no field "phone" to replicate',
      ],
    },
    {
      title: "a vector field in includeFields",
      params: { userTable: '.replication({ includeFields: ["embedding"] })' },
      issues: [
        'db.main-db.tables.User.replication.0.includeFields.0: Table "User" lists vector field "embedding" in includeFields, which is not replicated',
      ],
    },
    {
      title: "two replications writing one table of a destination",
      params: {
        userTable: ".replication({})",
        replications: {
          analytics: { destination: warehouse, tablePrefix: "shop_" },
          lake: { destination: warehouse, tablePrefix: "SHOP_" },
        },
      },
      issues: [
        'db.main-db.replications.lake: Replications "analytics" and "lake" both write table "shop_user" of destination "warehouse"',
      ],
    },
    {
      title: "a pluginTables key no plugin generates",
      params: { plugins: [auditLogPlugin()], pluginTables: { auditLog: { replication: [{}] } } },
      issues: [
        'db.main-db.pluginTables.auditLog: No plugin generates table "auditLog" in TailorDB namespace "main-db" (plugin-generated tables: "AuditLog")',
      ],
      suggestion: keySuggestion,
    },
    {
      title: "a pluginTables key in a namespace no plugin generates tables for",
      params: { plugins: [], pluginTables: { AuditLog: { replication: [{}] } } },
      issues: [
        'db.main-db.pluginTables.AuditLog: No plugin generates table "AuditLog" in TailorDB namespace "main-db" (plugin-generated tables: none)',
      ],
      suggestion: keySuggestion,
    },
    {
      title: "a pluginTables key naming a table the config defines",
      params: { plugins: [auditLogPlugin()], pluginTables: { User: { replication: [{}] } } },
      issues: [
        'db.main-db.pluginTables.User: Table "User" is not generated by a plugin (plugin-generated tables: "AuditLog")',
      ],
      suggestion: keySuggestion,
    },
    {
      title: "a pluginTables target the namespace does not declare",
      params: {
        plugins: [auditLogPlugin()],
        pluginTables: { AuditLog: { replication: [{ targets: ["archive"] }] } },
      },
      issues: [
        'db.main-db.pluginTables.AuditLog.replication.0.targets: Table "AuditLog" names replication "archive", which TailorDB namespace "main-db" does not declare in replications',
      ],
    },
    {
      title: "a pluginTables field the table does not have",
      params: {
        plugins: [auditLogPlugin()],
        pluginTables: { AuditLog: { replication: [{ excludeFields: ["phone"] }] } },
      },
      issues: [
        'db.main-db.pluginTables.AuditLog.replication.0.excludeFields.0: Table "AuditLog" has no field "phone" to replicate',
      ],
    },
    {
      title: "an empty pluginTables replication",
      params: {
        plugins: [auditLogPlugin()],
        pluginTables: { AuditLog: { replication: [] as never } },
      },
      issues: [
        "db.main-db.pluginTables.AuditLog.replication: must list at least one entry, or be false to leave the table out",
      ],
    },
    {
      title: "a plugin target the namespace does not declare",
      params: {
        plugins: [
          auditLogPlugin(() => pluginTable("AuditLog").replication({ targets: ["archive"] })),
        ],
      },
      issues: [
        'db.main-db.tables.AuditLog.replication.0.targets: Table "AuditLog" generated by plugin "audit-log" names replication "archive", which TailorDB namespace "main-db" does not declare in replications',
      ],
      suggestion: pluginReplicationSuggestion,
    },
    {
      title: "plugin targets the namespace does not declare on two tables",
      params: {
        plugins: [
          auditLogPlugin(() => pluginTable("AuditLog").replication({ targets: ["archive"] })),
          namespacePlugin("setting", () =>
            pluginTable("Setting").replication({ targets: ["archive"] }),
          ),
        ],
      },
      issues: [
        'db.main-db.tables.AuditLog.replication.0.targets: Table "AuditLog" generated by plugin "audit-log"',
        'db.main-db.tables.Setting.replication.0.targets: Table "Setting" generated by plugin "setting"',
      ],
      suggestion: pluginReplicationSuggestion,
    },
    {
      title: "an unknown pluginTables key and an invalid entry together",
      params: {
        plugins: [auditLogPlugin()],
        pluginTables: {
          Audit: { replication: [{}] },
          AuditLog: { replication: [{ targets: ["archive"] }] },
        },
      },
      issues: [
        'db.main-db.pluginTables.Audit: No plugin generates table "Audit"',
        'db.main-db.pluginTables.AuditLog.replication.0.targets: Table "AuditLog" names replication "archive"',
      ],
      suggestion: keySuggestion,
    },
  ])("rejects $title", async ({ params, issues, suggestion }) => {
    const error = await load(params).catch((error: unknown) => error);

    expect(error).toMatchObject({ code: "CONFIG_INVALID" });
    expect((error as CLIError).suggestion).toBe(suggestion);
    for (const issue of issues) {
      expect(error).toHaveProperty("message", expect.stringContaining(issue));
    }
  });
});
