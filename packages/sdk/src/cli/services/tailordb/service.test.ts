import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { silenceLogger } from "#src/cli/shared/test-helpers/silence-logger";
import { db } from "#src/configure/services/tailordb/index";
import { PluginManager } from "#src/plugin/manager";
import { createTailorDBService } from "./service";
import type { Plugin } from "#src/plugin/types";

describe("createTailorDBService.loadTypes", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
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
import { db } from "@tailor-platform/sdk";
export const user = db.type("User", {
  name: db.string(),
});
`,
    );
    const accountFile = writeTypeFile(
      "account.ts",
      `
import { db } from "@tailor-platform/sdk";
export const account = db.type("User", {
  email: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [userFile, accountFile] },
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toThrow(
      /Duplicate TailorDB type name "User" detected in TailorDB service "main"/,
    );
  });

  test("allows type names that match Object prototype properties", async () => {
    const typeFile = writeTypeFile(
      "object-prototype.ts",
      `
import { db } from "@tailor-platform/sdk";
export const objectPrototype = db.type("toString", {
  value: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
    });

    using _logger = silenceLogger("error", "log");
    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "toString")).toBe(true);
  });

  test("allows __proto__ as a type name", async () => {
    const typeFile = writeTypeFile(
      "proto.ts",
      `
import { db } from "@tailor-platform/sdk";
export const proto = db.type("__proto__", {
  value: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
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
import { db } from "@tailor-platform/sdk";
export const user = db.type("User", {
  name: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [userFile, userFile] },
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
        types: {
          auditLog: db.type("AuditLog", {
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
    });

    using _logger = silenceLogger("error", "log");
    await service.loadTypes();
    await service.processNamespacePlugins();
    await expect(service.processNamespacePlugins()).resolves.toBeUndefined();
    expect(Object.hasOwn(service.types, "AuditLog")).toBe(true);
  });
});
