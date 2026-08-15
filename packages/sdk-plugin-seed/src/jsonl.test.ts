import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { assertSeedDataDirectory, loadSeedData } from "./jsonl";

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

describe("assertSeedDataDirectory", () => {
  test("rejects a missing data directory", () => {
    const dir = makeDataDir({});
    rmSync(dir, { recursive: true });

    expect(() => assertSeedDataDirectory(dir)).toThrow(`Seed data directory not found: ${dir}`);
  });

  test("rejects a data directory below a file path with an actionable error", () => {
    const root = makeDataDir({ dist: "not a directory" });
    const dir = path.join(root, "dist", "data");

    expect(() => assertSeedDataDirectory(dir)).toThrow(`Seed data directory not found: ${dir}`);
  });
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

  test("does not revalidate the data directory", () => {
    const dir = makeDataDir({});
    rmSync(dir, { recursive: true });

    expect(loadSeedData(dir, ["User"])).toEqual({ User: [] });
  });

  test("loads no requested entities without requiring a data directory", () => {
    expect(loadSeedData("/missing", [])).toEqual({});
  });

  test("names the file and line for malformed JSON lines", () => {
    const dir = makeDataDir({ "Bad.jsonl": '{"ok":true}\nnot-json\n' });
    expect(() => loadSeedData(dir, ["Bad"])).toThrow(/Bad\.jsonl at line 2/);
  });

  test.each(["null", "[]", '"text"', "42"])("rejects non-object JSON rows: %s", (row) => {
    const dir = makeDataDir({ "Bad.jsonl": `${row}\n` });
    expect(() => loadSeedData(dir, ["Bad"])).toThrow(
      /Invalid seed row in .*Bad\.jsonl at line 1: expected a JSON object/,
    );
  });

  test.each([
    ["missing", '{"name":"Alice"}\n', 1],
    ["null", '{"id":"customer-1"}\n{"id":null,"name":"Bob"}\n', 2],
  ])(
    "rejects an %s id with the file and line number when requireId is set",
    (_label, content, line) => {
      const dir = makeDataDir({ "Customer.jsonl": content });
      expect(() => loadSeedData(dir, ["Customer"], { requireId: true })).toThrow(
        new RegExp(`Customer\\.jsonl:${line}: \`id\` is required with --upsert`),
      );
    },
  );

  test("points at `tailor seed fill` when an id is missing", () => {
    const dir = makeDataDir({ "Customer.jsonl": '{"name":"Alice"}\n' });
    expect(() => loadSeedData(dir, ["Customer"], { requireId: true })).toThrow(
      /Run `tailor seed fill` to write an id/,
    );
  });

  test("allows a missing id when requireId is not set", () => {
    const dir = makeDataDir({ "Customer.jsonl": '{"name":"Alice"}\n' });
    expect(loadSeedData(dir, ["Customer"])).toEqual({ Customer: [{ name: "Alice" }] });
  });

  test("rejects a missing required field before an upsert", () => {
    const dir = makeDataDir({
      "Customer.jsonl":
        '{"id":"customer-1","name":"Alice","email":"alice@example.com"}\n' +
        '{"id":"customer-2","name":"Bob"}\n',
    });

    expect(() =>
      loadSeedData(dir, ["Customer"], {
        requireId: true,
        requiredFieldsByType: { Customer: ["name", "email"] },
      }),
    ).toThrow(/Customer\.jsonl:2: field `email` is required with --upsert/);
  });
});
