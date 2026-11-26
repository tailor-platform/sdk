import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { generatePluginExecutorFiles } from "./plugin-executor-generator";
import type { PluginExecutorInfoExtended } from "#/plugin/manager";

describe("generatePluginExecutorFiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function auditExecutor(namespace: string, name = `${namespace}-customer-audit`) {
    return {
      executor: {
        name,
        // Built from source so the test runner does not rewrite the dynamic import it reads.
        resolve: new Function('return import("@example/audit-plugin/executor")'),
        context: {
          sourceTable: { name: "Customer", fields: {} },
          namespace,
        },
      },
      pluginId: "audit-plugin",
      pluginImportPath: "@example/audit-plugin",
      namespace,
      sourceTableName: "Customer",
    } as unknown as PluginExecutorInfoExtended;
  }

  function outputDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-executor-generator-"));
    tempDirs.push(dir);
    vi.spyOn(logger, "log").mockImplementation(() => {});
    return dir;
  }

  test("imports a source table from the namespace of the executor", () => {
    const dir = outputDir();
    const sourceTables = new Map([
      [
        "crm-db",
        new Map([
          ["Customer", { filePath: path.join(dir, "crm/customer.ts"), exportName: "crmCustomer" }],
        ]),
      ],
      [
        "shop-db",
        new Map([
          [
            "Customer",
            { filePath: path.join(dir, "shop/customer.ts"), exportName: "shopCustomer" },
          ],
        ]),
      ],
    ]);

    const [crmFile] = generatePluginExecutorFiles(
      [auditExecutor("crm-db"), auditExecutor("shop-db")],
      dir,
      { tableFilePaths: new Map(), generatedFiles: [] },
      sourceTables,
    );

    expect(fs.readFileSync(crmFile!, "utf8")).toContain(
      'import { crmCustomer } from "../../crm/customer";',
    );
  });

  test("imports a table of another namespace that only that namespace defines", () => {
    const dir = outputDir();
    const executor = auditExecutor("main-db");
    Object.assign(executor.executor, {
      context: {
        ...(executor.executor as { context: object }).context,
        logTable: { name: "AuditLog", fields: {} },
      },
    });
    const sourceTables = new Map([
      [
        "main-db",
        new Map([
          ["Customer", { filePath: path.join(dir, "main/customer.ts"), exportName: "customer" }],
        ]),
      ],
      [
        "audit-db",
        new Map([
          ["AuditLog", { filePath: path.join(dir, "audit/audit-log.ts"), exportName: "auditLog" }],
        ]),
      ],
    ]);

    const [file] = generatePluginExecutorFiles(
      [executor],
      dir,
      { tableFilePaths: new Map(), generatedFiles: [] },
      sourceTables,
    );

    expect(fs.readFileSync(file!, "utf8")).toContain(
      'import { auditLog } from "../../audit/audit-log";',
    );
  });

  test("writes the namespace a legacy executor's record trigger names", () => {
    const dir = outputDir();
    const legacy = {
      executor: {
        name: "crm-db-customer-sync",
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
          tableName: "Customer",
          namespace: "crm-db",
        },
        operation: { kind: "function", body: "return {}" },
      },
      pluginId: "audit-plugin",
      pluginImportPath: "@example/audit-plugin",
      namespace: "crm-db",
    } as unknown as PluginExecutorInfoExtended;

    const [file] = generatePluginExecutorFiles([legacy], dir);

    expect(fs.readFileSync(file!, "utf8")).toContain(
      'tableName: "Customer",\n    namespace: "crm-db",',
    );
  });

  test("rejects two executors with one name instead of writing one over the other", () => {
    const dir = outputDir();

    expect(() =>
      generatePluginExecutorFiles(
        [auditExecutor("crm-db", "customer-audit"), auditExecutor("shop-db", "customer-audit")],
        dir,
      ),
    ).toThrow(expect.objectContaining({ code: "PLUGIN_EXECUTOR_NAME_DUPLICATE" }));
  });
});
