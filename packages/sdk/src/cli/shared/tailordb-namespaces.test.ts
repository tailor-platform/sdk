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
    const [namespace] = await createTailorDBNamespaceLoader()(configPath, ["billing"]);

    expect(namespace!.namespace).toBe("billing");
    expect(Object.keys(namespace!.tables)).toEqual(["Invoice"]);
  });

  test("loads each config once for several of its namespaces", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] }, audit: { files: [] } } };`,
      "tailordb/invoice.ts": invoiceTable,
    });
    vi.mocked(loadConfig).mockClear();

    using _logger = silenceLogger("error", "log");
    const loadTailorDB = createTailorDBNamespaceLoader();
    await loadTailorDB(configPath, ["billing"]);
    await loadTailorDB(configPath, ["audit"]);

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
    const [namespace] = await createTailorDBNamespaceLoader()(configPath, ["billing"]);

    expect(Object.keys(namespace!.tables)).toEqual(["AuditLog"]);
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
    const [namespace] = await createTailorDBNamespaceLoader()(configPath, ["billing"]);

    expect(Object.keys(namespace!.tables)).toEqual(["Invoice"]);
  });

  test("loads each namespace once when it is requested again, even concurrently", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `
export default { name: "billing-app", db: { billing: { files: [] } } };
export const plugins = [{
  id: "load-counter",
  description: "Counts namespace loads",
  importPath: "@example/load-counter",
  onNamespaceLoaded: () => {
    globalThis.__namespaceLoads = (globalThis.__namespaceLoads ?? 0) + 1;
    return {};
  },
}];
`,
    });
    const counter = globalThis as { __namespaceLoads?: number };
    counter.__namespaceLoads = 0;

    using _logger = silenceLogger("error", "log");
    const loadTailorDB = createTailorDBNamespaceLoader();
    await Promise.all([loadTailorDB(configPath, ["billing"]), loadTailorDB(configPath)]);
    await loadTailorDB(configPath, ["billing"]);

    expect(counter.__namespaceLoads).toBe(1);
    delete counter.__namespaceLoads;
  });

  test("loads one namespace at a time even when namespaces are requested concurrently", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `
export default { name: "billing-app", db: { billing: { files: [] }, audit: { files: [] } } };
export const plugins = [{
  id: "overlap-recorder",
  description: "Records overlapping namespace loads",
  importPath: "@example/overlap-recorder",
  onNamespaceLoaded: async () => {
    const state = globalThis.__namespaceLoadOverlap;
    state.active += 1;
    state.max = Math.max(state.max, state.active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    state.active -= 1;
    return {};
  },
}];
`,
    });
    const overlap = { active: 0, max: 0 };
    const state = globalThis as { __namespaceLoadOverlap?: typeof overlap };
    state.__namespaceLoadOverlap = overlap;

    using _logger = silenceLogger("error", "log");
    const loadTailorDB = createTailorDBNamespaceLoader();
    await Promise.all([loadTailorDB(configPath, ["billing"]), loadTailorDB(configPath, ["audit"])]);

    expect(overlap.max).toBe(1);
    delete state.__namespaceLoadOverlap;
  });

  test.each([
    ["missing", 'TailorDB namespace "missing" not found in config.db of'],
    ["toString", 'TailorDB namespace "toString" not found in config.db of'],
    ["shared", 'TailorDB namespace "shared" is external in'],
  ])("rejects namespace %s that the other config does not own", async (namespace, message) => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: [] }, shared: { external: true } } };`,
    });

    await expect(createTailorDBNamespaceLoader()(configPath, [namespace])).rejects.toThrow(
      `${message} ${configPath}.`,
    );
  });

  test("loads every namespace not marked external, in config order, when namespaces is omitted", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { billing: { files: ["./tailordb/*.ts"] }, shared: { external: true }, audit: { files: [] } } };`,
      "tailordb/invoice.ts": invoiceTable,
    });

    using _logger = silenceLogger("error", "log");
    const namespaces = await createTailorDBNamespaceLoader()(configPath);

    expect(namespaces.map((ns) => ns.namespace)).toEqual(["billing", "audit"]);
  });

  test("rejects a config without a namespace to load when namespaces is omitted", async () => {
    const configPath = writeProject({
      "tailor.config.ts": `export default { name: "billing-app", db: { shared: { external: true } } };`,
    });

    await expect(createTailorDBNamespaceLoader()(configPath)).rejects.toThrow(
      `${configPath} defines no TailorDB namespace without external: true.`,
    );
  });
});
