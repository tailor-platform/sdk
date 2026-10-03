import * as fs from "node:fs";
import * as path from "pathe";
import { expect, test } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { generate } from "./service";

test("generates from local referenced definitions without running the owner's generation hooks", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".referenced-db-")));
  const output = path.join(dir, "result.json");
  try {
    fs.mkdirSync(path.join(dir, "consumer"));
    fs.mkdirSync(path.join(dir, "owner"));
    fs.writeFileSync(
      path.join(dir, "consumer/tailor.config.ts"),
      `
export default { name: "consumer", db: {
  local: { files: ["./tables.ts"] },
  shared: { attach: false, schemaFrom: "../owner/tailor.config.ts" },
} };
export const plugins = [{
  id: "definitions", description: "Write loaded definitions",
  onTailorDBReady: (ctx) => ({ files: [{
    path: ${JSON.stringify(output)},
    content: JSON.stringify({
      owned: ctx.tailordb.map(ns => [ns.namespace, Object.keys(ns.tables)]),
      referenced: ctx.referencedTailordb.map(ns => [ns.namespace, Object.keys(ns.tables)]),
    }),
  }] }),
}];
`,
    );
    fs.writeFileSync(
      path.join(dir, "consumer/tables.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const user = db.table("User", { email: db.string() })
  .permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);
`,
    );
    fs.writeFileSync(
      path.join(dir, "owner/tailor.config.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export default { name: "owner", db: {
  shared: { files: [] },
  unrelated: { attach: false, schemaFrom: "does-not-exist.ts" },
} };
export const plugins = [{
  id: "namespace-table", description: "Define shared User", importPath: "@example/namespace-table",
  onNamespaceLoaded: () => ({ tables: {
    user: db.table("User", { plan: db.string() })
      .permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission),
  } }),
  onTailorDBReady: () => { throw new Error("owner generation hook ran"); },
}];
`,
    );
    using _logger = silenceLogger("log", "info", "success");
    await generate({ configPath: path.join(dir, "consumer/tailor.config.ts") });
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual({
      owned: [["local", ["User"]]],
      referenced: [["shared", ["User"]]],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
