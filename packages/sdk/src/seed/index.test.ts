import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test, expect } from "vitest";
import { validateSeedData } from "./index";

// The data dirs live outside the workspace, so their schema files import
// lines-db by resolved URL instead of by package name.
const linesDbUrl = import.meta.resolve("@toiroakr/lines-db");

function schemaSource(foreignKeys: object[] = []): string {
  return `
import { defineSchema } from "${linesDbUrl}";

export const schema = defineSchema(
  {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) =>
        typeof value.name === "string"
          ? { value }
          : { issues: [{ message: "name is required", path: [{ key: "name" }] }] },
    },
  },
  { foreignKeys: ${JSON.stringify(foreignKeys)} },
);
`;
}

function writeLines(file: string, rows: object[]): string {
  writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return file;
}

describe("validateSeedData", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seed-validate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reports a line that is not valid JSON as invalid, located at its physical line", async () => {
    const file = join(dir, "User.jsonl");
    writeFileSync(file, '{"id":1}\n\nnot-json\n');

    const result = await validateSeedData({ path: file });

    expect(result).toMatchObject({ valid: false, location: { file, line: 3 } });
  });

  describe("datasets", () => {
    let cogs: string;

    beforeEach(() => {
      writeFileSync(join(dir, "Item.schema.ts"), schemaSource());
      writeFileSync(
        join(dir, "ItemValuation.schema.ts"),
        schemaSource([{ column: "itemId", references: { table: "Item", column: "id" } }]),
      );
      writeLines(join(dir, "Item.jsonl"), [{ id: "i1", name: "base item" }]);
      writeLines(join(dir, "ItemValuation.jsonl"), []);
      cogs = join(dir, "cogs");
      mkdirSync(cogs);
    });

    test("resolves foreign keys from a dataset to the base data", async () => {
      writeLines(join(cogs, "Item.jsonl"), [{ id: "i2", name: "cogs item" }]);
      writeLines(join(cogs, "ItemValuation.jsonl"), [
        { id: "v1", name: "base", itemId: "i1" },
        { id: "v2", name: "cogs", itemId: "i2" },
      ]);

      const result = await validateSeedData({ path: dir, datasetDirs: [cogs] });

      expect(result).toMatchObject({ valid: true });
    });

    test("reports an id the base data and a dataset both define, at the dataset's line", async () => {
      const file = writeLines(join(cogs, "Item.jsonl"), [
        { id: "i2", name: "cogs item" },
        { id: "i1", name: "duplicate" },
      ]);

      const result = await validateSeedData({ path: dir, datasetDirs: [cogs] });

      expect(result).toMatchObject({ valid: false, location: { file, line: 2 } });
    });

    test("reports a foreign key to a row no selected dataset holds", async () => {
      const file = writeLines(join(cogs, "ItemValuation.jsonl"), [
        { id: "v1", name: "missing", itemId: "i9" },
      ]);

      const result = await validateSeedData({ path: dir, datasetDirs: [cogs] });

      expect(result).toMatchObject({ valid: false, location: { file, line: 1 } });
    });

    test("leaves the base rows out with excludeBase", async () => {
      writeLines(join(cogs, "Item.jsonl"), [{ id: "i2", name: "cogs item" }]);
      const file = writeLines(join(cogs, "ItemValuation.jsonl"), [
        { id: "v1", name: "base", itemId: "i1" },
      ]);

      await expect(validateSeedData({ path: dir, datasetDirs: [cogs] })).resolves.toMatchObject({
        valid: true,
      });
      await expect(
        validateSeedData({ path: dir, datasetDirs: [cogs], excludeBase: true }),
      ).resolves.toMatchObject({ valid: false, location: { file, line: 1 } });
    });

    test("names the table a dataset's foreign key needs with excludeBase", async () => {
      writeLines(join(cogs, "ItemValuation.jsonl"), [{ id: "v1", name: "v", itemId: "i1" }]);

      await expect(
        validateSeedData({ path: dir, datasetDirs: [cogs], excludeBase: true }),
      ).rejects.toThrow(
        "ItemValuation has a foreign key to Item, but none of the selected datasets has Item.jsonl.",
      );
    });

    test("warns about a dataset file without a schema file", async () => {
      writeLines(join(cogs, "Itme.jsonl"), [{ id: "i2" }]);

      const result = await validateSeedData({ path: dir, datasetDirs: [cogs] });

      expect(result.output).toContain(
        `${join(cogs, "Itme.jsonl")} has no schema file in ${dir}, so its rows are not checked`,
      );
    });

    test("validates a dataset directory or file named on its own as before, pointing at --dataset", async () => {
      const file = writeLines(join(cogs, "Item.jsonl"), [{ id: "i2" }]);

      for (const path of [cogs, file]) {
        const result = await validateSeedData({ path });

        expect(result).toMatchObject({ valid: true });
        expect(result.output).toContain("run `tailor seed validate --dataset cogs`");
      }
    });

    test("does not point the data directory itself at --dataset", async () => {
      const result = await validateSeedData({ path: dir });

      expect(result.output).not.toContain("--dataset");
    });

    test("rejects datasets combined with a single file", async () => {
      await expect(
        validateSeedData({ path: join(dir, "Item.jsonl"), datasetDirs: [cogs] }),
      ).rejects.toThrow(/must be a directory/);
    });
  });
});
