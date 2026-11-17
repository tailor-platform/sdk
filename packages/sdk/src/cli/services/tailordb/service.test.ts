import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "#/configure/services/tailordb/index";
import { PluginManager } from "#/plugin/manager";
import { precompileTailorDBTypeScripts } from "./hooks-validate-bundler";
import { createTailorDBService } from "./service";
import type { TailorTypePermission } from "#/configure/services/tailordb/permission";
import type { Plugin } from "#/plugin/types";
import type * as HooksValidateBundler from "./hooks-validate-bundler";

vi.mock("./hooks-validate-bundler", async (importOriginal) => {
  const actual = await importOriginal<typeof HooksValidateBundler>();
  return {
    ...actual,
    precompileTailorDBTypeScripts: vi.fn(actual.precompileTailorDBTypeScripts),
  };
});

const malformedTypePermission = {
  create: [{ conditions: [[null, "=", "loggedin"]], permit: true }],
  read: [{ conditions: [], permit: true }],
  update: [{ conditions: [], permit: true }],
  delete: [{ conditions: [], permit: true }],
} as unknown as TailorTypePermission;

describe("createTailorDBService.loadTypes", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  beforeEach(() => {
    vi.mocked(precompileTailorDBTypeScripts).mockClear();
  });

  function writeTypeFile(name: string, source: string): string {
    if (!tmpDir) {
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".tailordb-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  test("rejects duplicate type names loaded from multiple files in one namespace", async () => {
    const userFile = writeTypeFile(
      "user.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
export const order = db.table("Order", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );
    const accountFile = writeTypeFile(
      "account.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const account = db.table("User", {
  email: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
export const purchase = db.table("Order", {
  email: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [userFile, accountFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toMatchObject({
      code: "DEFINITION_NAME_DUPLICATE",
      message: expect.stringMatching(
        /^Duplicate TailorDB type name "Order" found in namespace "main":\n.*account\.ts \(export: purchase\)\n.*user\.ts \(export: order\)\nDuplicate TailorDB type name "User" found in namespace "main":\n.*account\.ts \(export: account\)\n.*user\.ts \(export: user\)$/,
      ),
      suggestion: "Give each TailorDB type a unique name within its namespace.",
      context: {
        kind: "tailordb-type",
        namespace: "main",
        duplicates: [
          {
            name: "Order",
            definitions: [
              { file: accountFile, exportName: "purchase" },
              { file: userFile, exportName: "order" },
            ],
          },
          {
            name: "User",
            definitions: [
              { file: accountFile, exportName: "account" },
              { file: userFile, exportName: "user" },
            ],
          },
        ],
      },
    });
  });

  test("reports a table that fails validation as DEFINITION_INVALID, naming its export", async () => {
    const file = writeTypeFile(
      "user.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
user.name = 1;
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [file] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error");
    await expect(service.loadTypes()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      message: expect.stringMatching(/^Invalid TailorDB type `user`:\n {2}- name: /),
      context: {
        kind: "tailordb-type",
        file,
        exportName: "user",
        issues: [{ path: ["name"] }, { path: ["metadata", "name"] }],
      },
    });
    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [expect.stringMatching(/Failed to load table from .*user\.ts/)],
    ]);
  });

  test("names every table file that fails to load", async () => {
    const firstFile = writeTypeFile("first.ts", `throw new Error("first table is broken");\n`);
    const secondFile = writeTypeFile("second.ts", `throw new Error("second table is broken");\n`);

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [firstFile, secondFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    const error = await service.loadTypes().catch((thrown: unknown) => thrown);
    if (!(error instanceof Error)) throw new Error("expected loadTypes to reject with an Error");
    expect(error.message).toMatch(/^(first|second) table is broken$/);
    expect(getErrorDiagnostics(error).location).toEqual({
      file: error.message.startsWith("first") ? firstFile : secondFile,
    });
    await vi.waitFor(() => {
      expect(vi.mocked(logger.error).mock.calls.toSorted()).toEqual([
        [expect.stringMatching(/Failed to load table from .*first\.ts/)],
        [expect.stringMatching(/Failed to load table from .*second\.ts/)],
      ]);
    });
  });

  test.each(["item", "toString", "__proto__"])(
    "reports invalid table name %s with its definition file and export",
    async (name) => {
      const file = writeTypeFile(
        "item.ts",
        `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const item = db.table(${JSON.stringify(name)}, {
  title: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
      );

      const service = createTailorDBService({
        namespace: "main",
        config: { files: [file] },
        baseDir: process.cwd(),
      });

      using _logger = silenceLogger("error");
      const error = await service.loadTypes().catch((thrown: unknown) => thrown);
      if (!(error instanceof Error)) throw new Error("expected loadTypes to reject with an Error");
      expect(error).toMatchObject({
        code: "DEFINITION_INVALID",
        message: expect.stringContaining("Invalid TailorDB type `item`"),
        context: {
          kind: "tailordb-type",
          file,
          exportName: "item",
          issues: [
            {
              path: ["name"],
              message: "must be 1-63 ASCII letters or digits, starting with an uppercase letter",
            },
            {
              path: ["metadata", "name"],
              message: "must be 1-63 ASCII letters or digits, starting with an uppercase letter",
            },
          ],
        },
      });
      expect(getErrorDiagnostics(error).location).toEqual({ file });
    },
  );

  const HOOKED_TYPE = `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string().hooks({ create: ({ value }) => value ?? "anonymous" }),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`;

  test("bundles the hook and validator scripts of each table it loads", async () => {
    const file = writeTypeFile("hooked.ts", HOOKED_TYPE);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [file] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();

    expect(precompileTailorDBTypeScripts).toHaveBeenCalledTimes(1);
  });

  test("loads the tables without bundling their hook and validator scripts when precompileScripts is false", async () => {
    const file = writeTypeFile("hooked.ts", HOOKED_TYPE);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [file] },
      baseDir: process.cwd(),
      precompileScripts: false,
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();

    expect(Object.hasOwn(types ?? {}, "User")).toBe(true);
    expect(precompileTailorDBTypeScripts).not.toHaveBeenCalled();
  });

  test("loads the same matched file only once", async () => {
    const userFile = writeTypeFile(
      "overlapping-glob.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [userFile, userFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "User")).toBe(true);
  });

  test("allows namespace plugin-generated types to be processed repeatedly", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onTailorDBNamespaceLoaded: () => ({
        tables: {
          auditLog: db
            .table("AuditLog", {
              message: db.string(),
            })
            .permission(unsafeAllowAllTypePermission)
            .gqlPermission(unsafeAllowAllGqlPermission),
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await service.processNamespacePlugins();
    await expect(service.processNamespacePlugins()).resolves.toBeUndefined();
    expect(Object.hasOwn(service.types, "AuditLog")).toBe(true);
  });

  test("leaves a failing namespace plugin's error to the caller", async () => {
    const plugin: Plugin = {
      id: "failing-namespace-plugin",
      description: "namespace generator that throws",
      importPath: "@example/failing-namespace",
      onTailorDBNamespaceLoaded: () => {
        throw new Error("namespace generation failed");
      },
    };
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager: new PluginManager([plugin]),
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await expect(service.processNamespacePlugins()).rejects.toMatchObject({
      code: "PLUGIN_NAMESPACE_HOOK_FAILED",
      message: expect.stringMatching(/failing-namespace-plugin.*namespace generation failed/),
      context: { pluginId: "failing-namespace-plugin", namespace: "main" },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("rejects a namespace plugin-generated type with no .permission() configured", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onTailorDBNamespaceLoaded: () => ({
        tables: {
          auditLog: db.table("AuditLogNoPermission", {
            message: db.string(),
          }),
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await expect(service.processNamespacePlugins()).rejects.toMatchObject({
      code: "TAILORDB_PERMISSION_INVALID",
      message: expect.stringMatching(
        /TailorDB table "AuditLogNoPermission".* has no \.permission\(\) configured/,
      ),
      context: {
        namespace: "main",
        errors: expect.arrayContaining([
          expect.stringContaining('TailorDB table "AuditLogNoPermission"'),
        ]),
      },
    });
  });

  test("rejects a namespace plugin-generated table that fails schema validation", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onTailorDBNamespaceLoaded: () => ({
        tables: {
          auditLog: db
            .table("BadAuditLog", {
              message: db.string(),
            })
            .permission(malformedTypePermission)
            .gqlPermission(unsafeAllowAllGqlPermission),
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await expect(service.processNamespacePlugins()).rejects.toMatchObject({
      code: "PLUGIN_TABLE_INVALID",
      message: expect.stringMatching(
        /TailorDB table "BadAuditLog".*generated as "auditLog" by plugin "namespace-plugin".*failed schema validation/s,
      ),
      context: {
        namespace: "main",
        issues: [expect.objectContaining({ path: expect.any(Array) })],
      },
    });
  });

  test("rejects an attachment plugin-generated table that fails schema validation", async () => {
    const typeFile = writeTypeFile(
      "with-generating-plugin.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission).plugin({ "gen-plugin": {} });
`,
    );
    const plugin: Plugin = {
      id: "gen-plugin",
      description: "generates a malformed table",
      importPath: "@example/gen",
      onTableLoaded: () => ({
        tables: {
          audit: db
            .table("BadGenerated", {
              message: db.string(),
            })
            .permission(malformedTypePermission)
            .gqlPermission(unsafeAllowAllGqlPermission),
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toThrow(
      /TailorDB table "BadGenerated".*generated as "audit" by plugin "gen-plugin".*failed schema validation/s,
    );
  });

  test("rejects a plugin-extended table that fails schema validation", async () => {
    const typeFile = writeTypeFile(
      "with-extending-plugin.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission).plugin({ "extend-plugin": {} });
`,
    );
    const plugin: Plugin = {
      id: "extend-plugin",
      description: "extends with a malformed field",
      importPath: "@example/extend",
      onTableLoaded: () => ({
        extends: {
          fields: { bad: { type: "bogus" } as unknown as ReturnType<typeof db.string> },
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toThrow(
      /TailorDB table "User".*extended by plugin "extend-plugin".*failed schema validation/s,
    );
  });

  test("rejects a null namespace plugin-generated table without crashing", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onTailorDBNamespaceLoaded: () => ({
        tables: {
          auditLog: null as unknown as ReturnType<typeof db.table>,
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await expect(service.processNamespacePlugins()).rejects.toThrow(
      /TailorDB table generated as "auditLog" by plugin "namespace-plugin".*failed schema validation/s,
    );
  });

  test("rejects a null attachment plugin-generated table without crashing", async () => {
    const typeFile = writeTypeFile(
      "with-null-generating-plugin.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission).plugin({ "null-plugin": {} });
`,
    );
    const plugin: Plugin = {
      id: "null-plugin",
      description: "generates a null table",
      importPath: "@example/null",
      onTableLoaded: () => ({
        tables: {
          audit: null as unknown as ReturnType<typeof db.table>,
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toThrow(
      /TailorDB table generated as "audit" by plugin "null-plugin".*failed schema validation/s,
    );
  });

  test("accepts a plugin-generated table that is a structural copy of a builder", async () => {
    const plugin: Plugin = {
      id: "clone-plugin",
      description: "returns a spread copy of a builder table",
      importPath: "@example/clone",
      onTailorDBNamespaceLoaded: () => ({
        tables: {
          auditLog: {
            ...db
              .table("ClonedAuditLog", {
                message: db.string(),
              })
              .permission(unsafeAllowAllTypePermission)
              .gqlPermission(unsafeAllowAllGqlPermission),
          },
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await service.processNamespacePlugins();
    expect(Object.hasOwn(service.types, "ClonedAuditLog")).toBe(true);
  });

  test("loads valid attachment plugin-generated and -extended tables", async () => {
    const typeFile = writeTypeFile(
      "with-valid-plugin.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission).plugin({ "valid-plugin": {} });
`,
    );
    const plugin: Plugin = {
      id: "valid-plugin",
      description: "extends and generates valid tables",
      importPath: "@example/valid",
      onTableLoaded: () => ({
        extends: {
          fields: { addedField: db.string() },
        },
        tables: {
          audit: db
            .table("GeneratedAudit", {
              message: db.string(),
            })
            .permission(unsafeAllowAllTypePermission)
            .gqlPermission(unsafeAllowAllGqlPermission),
        },
      }),
    };
    const pluginManager = new PluginManager([plugin]);
    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      pluginManager,
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "GeneratedAudit")).toBe(true);
    expect(Object.hasOwn(types?.["User"]?.fields ?? {}, "addedField")).toBe(true);
  });

  test("rejects a type with no .permission() configured", async () => {
    const typeFile = writeTypeFile(
      "no-permission.ts",
      `
import { db, unsafeAllowAllGqlPermission } from "@tailor-platform/sdk";
export const noPermission = db.table("NoPermission", {
  name: db.string(),
}).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log", "warn");
    await expect(service.loadTypes()).rejects.toThrow(
      new RegExp(
        `TailorDB table "NoPermission" \\(${typeFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} export noPermission\\) has no \\.permission\\(\\) configured`,
      ),
    );
  });

  test("rejects a type with no .gqlPermission() configured while GraphQL operations are enabled", async () => {
    const typeFile = writeTypeFile(
      "no-gql-permission.ts",
      `
import { db, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const noGqlPermission = db.table("NoGqlPermission", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log", "warn");
    await expect(service.loadTypes()).rejects.toThrow(
      /TailorDB table "NoGqlPermission".* has no \.gqlPermission\(\) configured/,
    );
  });

  test("allows a type with only .permission() when GraphQL operations are fully disabled", async () => {
    const typeFile = writeTypeFile(
      "gql-disabled.ts",
      `
import { db, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const gqlDisabled = db.table("GqlDisabled", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission).features({
  gqlOperations: { create: false, update: false, delete: false, read: false },
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log", "warn");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "GqlDisabled")).toBe(true);
  });

  test("allows a type with only .permission() when the namespace disables GraphQL operations by default", async () => {
    const typeFile = writeTypeFile(
      "namespace-gql-disabled.ts",
      `
import { db, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const namespaceGqlDisabled = db.table("NamespaceGqlDisabled", {
  name: db.string(),
}).permission(unsafeAllowAllTypePermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: {
        files: [typeFile],
        gqlOperations: { create: false, update: false, delete: false, read: false },
      },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log", "warn");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "NamespaceGqlDisabled")).toBe(true);
  });
});
