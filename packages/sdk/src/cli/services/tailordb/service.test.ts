import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "#/configure/services/tailordb/index";
import { PluginManager } from "#/plugin/manager";
import { createTailorDBService } from "./service";
import type { TailorTypePermission } from "#/configure/services/tailordb/permission";
import type { Plugin } from "#/plugin/types";

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
`,
    );
    const accountFile = writeTypeFile(
      "account.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const account = db.table("User", {
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
    await expect(service.loadTypes()).rejects.toThrow(
      /Duplicate TailorDB table name "User" detected in TailorDB service "main"/,
    );
  });

  test("allows type names that match Object prototype properties", async () => {
    const typeFile = writeTypeFile(
      "object-prototype.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const objectPrototype = db.table("toString", {
  value: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "toString")).toBe(true);
  });

  test("allows __proto__ as a type name", async () => {
    const typeFile = writeTypeFile(
      "proto.ts",
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const proto = db.table("__proto__", {
  value: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
      baseDir: process.cwd(),
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(service.typeSourceInfo, "__proto__")).toBe(true);
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
      onNamespaceLoaded: () => ({
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

  test("rejects a namespace plugin-generated type with no .permission() configured", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
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
    await expect(service.processNamespacePlugins()).rejects.toThrow(
      /TailorDB table "AuditLogNoPermission".* has no \.permission\(\) configured/,
    );
  });

  test("rejects a namespace plugin-generated table that fails schema validation", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
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
    await expect(service.processNamespacePlugins()).rejects.toThrow(
      /TailorDB table "BadAuditLog".*generated as "auditLog" by plugin "namespace-plugin".*failed schema validation/s,
    );
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
      /TailorDB table "User".*extended by plugin\(s\) "extend-plugin".*failed schema validation/s,
    );
  });

  test("rejects a null namespace plugin-generated table without crashing", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
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
      onNamespaceLoaded: () => ({
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
