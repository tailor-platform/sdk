import { mkdtempSync, rmSync } from "node:fs";
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
});
