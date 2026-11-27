import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { generatePluginTableFiles } from "./plugin-table-generator";

describe("generatePluginTableFiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test("labels generated files as TailorDB table files", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-table-generator-"));
    tempDirs.push(outputDir);
    const log = vi.spyOn(logger, "log").mockImplementation(() => {});

    generatePluginTableFiles(
      [
        {
          pluginId: "audit-plugin",
          pluginImportPath: "@example/audit-plugin",
          sourceTableName: "Order",
          kind: "auditLog",
          table: { name: "AuditLog", fields: {} },
          namespace: "main",
        },
      ],
      outputDir,
    );

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Plugin Table File:"));
  });

  function generatedTable(namespace: string) {
    return {
      pluginId: "audit-plugin",
      pluginImportPath: "@example/audit-plugin",
      sourceTableName: "Customer",
      kind: "auditLog",
      table: { name: "CustomerAudit", fields: {} },
      namespace,
    };
  }

  test("writes a table that several namespaces generate once per namespace", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-table-generator-"));
    tempDirs.push(outputDir);
    vi.spyOn(logger, "log").mockImplementation(() => {});

    const result = generatePluginTableFiles(
      [generatedTable("shop-db"), generatedTable("crm-db")],
      outputDir,
    );

    expect(result.generatedFiles).toEqual([
      path.join(outputDir, "audit-plugin", "types", "shop-db", "customer-audit.ts"),
      path.join(outputDir, "audit-plugin", "types", "crm-db", "customer-audit.ts"),
    ]);
    expect(result.tableFilePaths.get("crm-db")?.get("CustomerAudit")).toBe(
      path.join("audit-plugin", "types", "crm-db", "customer-audit.ts"),
    );
  });

  test("rejects a table that one namespace generates twice", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-table-generator-"));
    tempDirs.push(outputDir);
    vi.spyOn(logger, "log").mockImplementation(() => {});

    expect(() =>
      generatePluginTableFiles([generatedTable("shop-db"), generatedTable("shop-db")], outputDir),
    ).toThrow(expect.objectContaining({ code: "PLUGIN_TABLE_NAME_DUPLICATE" }));
  });
});
