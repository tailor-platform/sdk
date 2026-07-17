import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { loadSeedData } from "./jsonl";

let tempDir: string | undefined;

function makeDataDir(files: Record<string, string>): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "seed-jsonl-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(tempDir, name), content);
  }
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("loadSeedData", () => {
  test("parses one JSON record per line", () => {
    const dir = makeDataDir({ "User.jsonl": '{"id":1}\n{"id":2}\n' });
    expect(loadSeedData(dir, ["User"])).toEqual({ User: [{ id: 1 }, { id: 2 }] });
  });

  test("loads missing and empty files as empty lists", () => {
    const dir = makeDataDir({ "Empty.jsonl": "\n" });
    expect(loadSeedData(dir, ["Empty", "Missing"])).toEqual({ Empty: [], Missing: [] });
  });

  test("throws on malformed JSON lines", () => {
    const dir = makeDataDir({ "Bad.jsonl": "not-json\n" });
    expect(() => loadSeedData(dir, ["Bad"])).toThrow(SyntaxError);
  });
});
