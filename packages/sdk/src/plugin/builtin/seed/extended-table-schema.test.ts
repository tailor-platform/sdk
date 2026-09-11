import * as fs from "node:fs";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { _clearCacheForTesting } from "#/plugin/get-generated-table";
import { generateLinesDbSchemaFile } from "./lines-db-processor";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Generates the seed schema file for a table a plugin extends, the way
// `tailor generate` does, and validates rows through it.
describe("seed schema of a plugin-extended table", () => {
  let schema: StandardSchemaV1;
  let tempDir: string;

  aroundEach(async (runTest) => {
    _clearCacheForTesting();
    // Real path, so the schema file and the config resolve the table to one module.
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-")));
    fs.mkdirSync(path.join(tempDir, "tailordb"));
    fs.mkdirSync(path.join(tempDir, "seed", "data"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "order.mjs"),
      `import { db } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { name: db.string(), note: db.string({ optional: true }) })
  .hooks({ create: ({ input }) => ({ note: input.note ?? "from hook" }) });
order.plugin({ "@test/lifecycle": {} });
`,
    );
    fs.writeFileSync(
      path.join(tempDir, "tailor.config.mjs"),
      `import { db } from "@tailor-platform/sdk";
export const plugins = [{
  id: "@test/lifecycle",
  description: "test",
  importPath: "@test/lifecycle",
  onTableLoaded() {
    return { extends: { fields: { rank: db.int(), archivedAt: db.datetime({ optional: true }) } } };
  },
}];
export default {
  db: { main: { files: [${JSON.stringify(path.join(tempDir, "tailordb", "order.mjs"))}] } },
};
`,
    );
    const schemaPath = path.join(tempDir, "seed", "data", "Order.schema.ts");
    fs.writeFileSync(
      schemaPath,
      generateLinesDbSchemaFile(
        {
          tableName: "Order",
          exportName: "order",
          importPath: path.join(tempDir, "tailordb", "order.mjs"),
          optionalFields: ["id"],
          omitFields: [],
          foreignKeys: [],
          indexes: [],
        },
        { typeImportPath: "../../tailordb/order.mjs", configImportPath: "../../tailor.config.mjs" },
      ),
    );
    const loaded = (await import(pathToFileURL(schemaPath).href)) as {
      schema: StandardSchemaV1;
    };
    schema = loaded.schema;
    await runTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const validate = (row: unknown) => schema["~standard"].validate(row);

  test("accepts a row that gives the plugin-added field a value of its type", async () => {
    const result = await validate({ name: "a", rank: 1 });
    expect(result).toMatchObject({ value: { name: "a", rank: 1, note: "from hook" } });
  });

  test("reports a plugin-added field carrying a value of the wrong type", async () => {
    const result = await validate({ name: "a", rank: "first" });
    expect(result).toMatchObject({ issues: [{ path: ["rank"] }] });
  });

  test("reports a required plugin-added field the row omits", async () => {
    const result = await validate({ name: "a" });
    expect(result).toMatchObject({ issues: [{ path: ["rank"] }] });
  });

  test("still reports a field neither the table nor its plugins declare", async () => {
    const result = await validate({ name: "a", rank: 1, legacyCode: "X" });
    expect(result).toMatchObject({
      issues: [{ message: expect.stringContaining("not declared"), path: ["legacyCode"] }],
    });
  });
});
