import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hookSeedRows } from "./index";

describe("hookSeedRows", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hook-seed-rows-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("applies the schema hook to each row", async () => {
    writeFileSync(
      join(dir, "_User.schema.ts"),
      "export const hook = (row: Record<string, unknown>) => ({ ...row, password: 'x' });\n",
    );
    expect(await hookSeedRows({ schemaDir: dir, table: "_User", rows: [{ name: "a" }] })).toEqual([
      { name: "a", password: "x" },
    ]);
  });

  test("returns the rows unchanged when there is no schema file", async () => {
    expect(await hookSeedRows({ schemaDir: dir, table: "_User", rows: [{ name: "a" }] })).toEqual([
      { name: "a" },
    ]);
  });
});
