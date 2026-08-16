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
});
