import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test, expect } from "vitest";
import { validateSeedData } from "./index";

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
});
