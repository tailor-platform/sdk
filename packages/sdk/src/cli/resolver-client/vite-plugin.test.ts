import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { tailorResolvers } from "./vite-plugin";

const PING_RESOLVER = `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "ping",
  operation: "query",
  permission: "allowAnonymous",
  input: { message: t.string() },
  body: ({ input }) => input.message,
  output: t.string(),
});
`;

const ORDER_TABLE = `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { status: db.enum(["PAID", "OPEN"]) })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

// Inside the package, so the project's `@tailor-platform/sdk` imports resolve to its build.
function project(): Disposable & { dir: string; config: string; resolver: string; table: string } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-resolver-client-")),
  );
  const config = path.join(dir, "tailor.config.ts");
  const resolver = path.join(dir, "resolvers", "ping.ts");
  const table = path.join(dir, "tailordb", "order.ts");
  fs.mkdirSync(path.dirname(resolver));
  fs.mkdirSync(path.dirname(table));
  fs.writeFileSync(
    config,
    `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  name: "app",
  db: { main: { files: ["./tailordb/*.ts"] } },
  resolver: { main: { files: ["./resolvers/*.ts"] } },
});
`,
  );
  fs.writeFileSync(resolver, PING_RESOLVER);
  fs.writeFileSync(table, ORDER_TABLE);
  return {
    dir,
    config,
    resolver,
    table,
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function load(plugin: ReturnType<typeof tailorResolvers>, id: string) {
  const addWatchFile = vi.fn();
  const code = await plugin.load.call({ addWatchFile }, id);
  return { code, addWatchFile };
}

describe("tailorResolvers", () => {
  test("turns resolvers.tailor into the functions calling the project's resolvers", async () => {
    using p = project();

    const { code } = await load(tailorResolvers(), path.join(p.dir, "resolvers.tailor"));

    expect(code).toContain("query ping($message: String!) { ping(message: $message) }");
    expect(code).toContain("export { resolver0 as ping };");
  });

  test("gives the generated functions the url it was given to fall back to", async () => {
    using p = project();

    const { code } = await load(
      tailorResolvers({ url: "https://xyz.erp.dev" }),
      path.join(p.dir, "resolvers.tailor"),
    );

    expect(code).toContain('setResolverDefaults({ url: "https://xyz.erp.dev" });');
  });

  test("reloads the module when the config or a resolver file changes", async () => {
    using p = project();

    const { addWatchFile } = await load(tailorResolvers(), path.join(p.dir, "resolvers.tailor"));

    expect(addWatchFile).toHaveBeenCalledWith(p.config);
    expect(addWatchFile).toHaveBeenCalledWith(p.resolver);
  });

  test("reads the config it was pointed at instead of searching for one", async () => {
    using p = project();
    const elsewhere = fs.realpathSync(
      fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-elsewhere-")),
    );
    try {
      const { code } = await load(
        tailorResolvers({ config: p.config }),
        path.join(elsewhere, "resolvers.tailor"),
      );

      expect(code).toContain("export { resolver0 as ping };");
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("turns tailordb.tailor into the record operations of the project's TailorDB types", async () => {
    using p = project();

    const { code } = await load(tailorResolvers(), path.join(p.dir, "tailordb.tailor"));

    expect(code).toContain("export { crud0 as Order };");
    expect(code).toContain("createRecords(");
    expect(code).toContain('"typeName":"Order"');
  });

  test("reloads tailordb.tailor when a TailorDB definition changes", async () => {
    using p = project();

    const { addWatchFile } = await load(tailorResolvers(), path.join(p.dir, "tailordb.tailor"));

    expect(addWatchFile).toHaveBeenCalledWith(p.config);
    expect(addWatchFile).toHaveBeenCalledWith(p.table);
  });

  test("leaves other files to the bundler", async () => {
    using p = project();

    const { code } = await load(tailorResolvers(), path.join(p.dir, "main.ts"));

    expect(code).toBeUndefined();
  });
});
