import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { loadConfig } from "./config-loader";
import { createTailorDBNamespaceLoader } from "./tailordb-namespaces";
import type * as ConfigLoaderModule from "./config-loader";

vi.mock("./config-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigLoaderModule>();
  return { ...actual, loadConfig: vi.fn(actual.loadConfig) };
});

const invoiceTable = `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const invoice = db.table("Invoice", {
  amount: db.int(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`;

describe("createTailorDBNamespaceLoader", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeProject(files: Record<string, string>): string {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".other-app-")));
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(tmpDir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    return path.join(tmpDir, "tailor.config.ts");
  }

  test("loads a namespace's tables with its db files resolved from the other config's directory", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] } } };`,
      "tailordb/invoice.ts": invoiceTable,
    });

    using _logger = silenceLogger("error", "log");
    const namespace = await createTailorDBNamespaceLoader()(configPath, "billing");

    expect(namespace.namespace).toBe("billing");
    expect(Object.keys(namespace.tables)).toEqual(["Invoice"]);
  });

  test("does not load consumer tables when the owner's file patterns match nothing", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] } } };`,
      "consumer/tailordb/invoice.ts": invoiceTable,
    });
    using _cwd = vi
      .spyOn(process, "cwd")
      .mockReturnValue(path.join(path.dirname(configPath), "consumer"));
    using _logger = silenceLogger("error", "log", "warn");

    const namespace = await createTailorDBNamespaceLoader()(configPath, "billing");

    expect(Object.keys(namespace.tables)).toEqual([]);
  });

  test("loads each config once for several of its namespaces", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] }, audit: { files: [] } } };`,
      "tailordb/invoice.ts": invoiceTable,
    });
    vi.mocked(loadConfig).mockClear();

    using _logger = silenceLogger("error", "log");
    const loadTailorDB = createTailorDBNamespaceLoader();
    await loadTailorDB(configPath, "billing");
    await loadTailorDB(configPath, "audit");

    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  test("applies the other config's namespace plugins", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export default { name: "billing-app", db: { billing: { files: [] } } };
export const plugins = [{
  id: "audit-log",
  description: "Adds an audit log table",
  importPath: "@example/audit-log",
  onNamespaceLoaded: () => ({
    tables: {
      auditLog: db.table("AuditLog", { message: db.string() })
        .permission(unsafeAllowAllTypePermission)
        .gqlPermission(unsafeAllowAllGqlPermission),
    },
  }),
}];
`,
    });

    using _logger = silenceLogger("error", "log");
    const namespace = await createTailorDBNamespaceLoader()(configPath, "billing");

    expect(Object.keys(namespace.tables)).toEqual(["AuditLog"]);
  });

  test("does not run the other config's generation hooks", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `
export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] } } };
export const plugins = [{
  id: "back-reference",
  description: "Would load this config again from its own generation hook",
  onTailorDBReady: () => {
    throw new Error("generation hook of the other config ran");
  },
}];
`,
      "tailordb/invoice.ts": invoiceTable,
    });

    using _logger = silenceLogger("error", "log");
    const namespace = await createTailorDBNamespaceLoader()(configPath, "billing");

    expect(Object.keys(namespace.tables)).toEqual(["Invoice"]);
  });

  test.each([
    ["missing", 'TailorDB namespace "missing" not found in config.db of'],
    ["toString", 'TailorDB namespace "toString" not found in config.db of'],
    ["shared", 'TailorDB namespace "shared" is owned by another application, not'],
  ])("rejects namespace %s that the other config does not own", async (namespace, message) => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: [] }, shared: { external: true } } };`,
    });

    await expect(createTailorDBNamespaceLoader()(configPath, namespace)).rejects.toThrow(
      `${message} ${configPath}.`,
    );
  });

  test.each([
    { attach: true },
    { attach: true, schemaFrom: "missing.config.ts" },
    { attach: false, schemaFrom: "missing.config.ts" },
  ])("rejects a non-owned namespace without following its reference: %j", async (entry) => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "other-app", db: { shared: ${JSON.stringify(entry)} } };`,
    });
    await expect(createTailorDBNamespaceLoader()(configPath, "shared")).rejects.toThrow(
      `TailorDB namespace "shared" is owned by another application, not ${configPath}. Point schemaFrom at the config that defines its tables.`,
    );
  });
});
