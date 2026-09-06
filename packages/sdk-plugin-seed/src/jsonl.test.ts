import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertSeedDataDirectory,
  existingSeedDataFiles,
  loadSeedData,
  writeSeedData,
} from "./jsonl";

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

describe("writeSeedData", () => {
  test("writes one JSON object per line, ending with a newline", () => {
    const dir = makeDataDir({});

    const written = writeSeedData(dir, "User", [
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Bob" },
    ]);

    expect(written).toBe(path.join(dir, "User.jsonl"));
    expect(readFileSync(written, "utf-8")).toBe(
      '{"id":"u1","name":"Ada"}\n{"id":"u2","name":"Bob"}\n',
    );
  });

  test("round-trips through loadSeedData", () => {
    const dir = makeDataDir({});
    const rows = [{ id: "u1", name: "Ada", tags: ["a", "b"] }];

    writeSeedData(dir, "User", rows);

    expect(loadSeedData(dir, ["User"])).toEqual({ User: rows });
  });

  test("writes an empty file for an entity with no rows", () => {
    const dir = makeDataDir({});

    writeSeedData(dir, "User", []);

    expect(readFileSync(path.join(dir, "User.jsonl"), "utf-8")).toBe("");
    expect(loadSeedData(dir, ["User"])).toEqual({ User: [] });
  });

  test("creates the output directory when it does not exist", () => {
    const dir = path.join(makeDataDir({}), "nested", "data");

    writeSeedData(dir, "User", [{ id: "u1" }]);

    expect(loadSeedData(dir, ["User"])).toEqual({ User: [{ id: "u1" }] });
  });
});

describe("existingSeedDataFiles", () => {
  test("returns only the entities whose file exists", () => {
    const dir = makeDataDir({ "User.jsonl": "" });

    expect(existingSeedDataFiles(dir, ["User", "Order"])).toEqual(["User"]);
  });
});
