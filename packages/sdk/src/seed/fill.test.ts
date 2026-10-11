import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@toiroakr/lines-db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fillSeedData } from "./index";
import type * as LinesDb from "@toiroakr/lines-db";

const { fillFields } = vi.hoisted(() => ({ fillFields: vi.fn() }));

vi.mock("@toiroakr/lines-db", async (importOriginal) => ({
  ...(await importOriginal<typeof LinesDb>()),
  fillFields,
}));

describe("fillSeedData", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seed-fill-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reports forward-slash paths when the filled files come back with backslashes", async () => {
    fillFields.mockResolvedValue(
      ok({
        filled: [
          { table: "Widget", file: "C:\\seed\\data\\Widget.jsonl", fields: ["id"], count: 1 },
        ],
        tablesWithoutSchema: [],
        unreadableLines: [{ file: "C:\\seed\\data\\Gadget.jsonl", lines: [2] }],
        unproducedFields: [],
      }),
    );

    const result = await fillSeedData({ path: dir });

    expect(result.filled.map((entry) => entry.file)).toEqual(["C:/seed/data/Widget.jsonl"]);
    expect(result.output).toContain("C:/seed/data/Widget.jsonl: filled id in 1 row(s)");
    expect(result.output).toContain(
      "C:/seed/data/Gadget.jsonl: line(s) 2 are not JSON objects, so nothing was filled in there",
    );
    expect(result.output).not.toContain("\\");
  });

  describe("schema directory", () => {
    const emptyResult = ok({
      filled: [],
      tablesWithoutSchema: [],
      unreadableLines: [],
      unproducedFields: [],
    });

    test("looks schemas up in the directory it is given", async () => {
      fillFields.mockResolvedValue(emptyResult);
      const cogs = join(dir, "cogs");
      mkdirSync(cogs);

      await fillSeedData({ path: cogs, schemaDir: dir });

      expect(fillFields).toHaveBeenCalledWith(
        expect.objectContaining({ path: cogs, schemaDir: dir }),
      );
    });

    test("looks schemas up in the data directory above a dataset directory", async () => {
      fillFields.mockResolvedValue(emptyResult);
      writeFileSync(join(dir, "Item.schema.ts"), "");
      const cogs = join(dir, "cogs");
      mkdirSync(cogs);
      const file = join(cogs, "Item.jsonl");
      writeFileSync(file, "");

      await fillSeedData({ path: cogs });
      await fillSeedData({ path: file });

      expect(fillFields).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ path: cogs, schemaDir: dir }),
      );
      expect(fillFields).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ path: file, schemaDir: dir }),
      );
    });

    test("keeps looking schemas up next to the data of a data directory", async () => {
      fillFields.mockResolvedValue(emptyResult);
      writeFileSync(join(dir, "Item.schema.ts"), "");

      await fillSeedData({ path: dir });

      expect(fillFields).toHaveBeenCalledWith(
        expect.objectContaining({ path: dir, schemaDir: undefined }),
      );
    });
  });
});
