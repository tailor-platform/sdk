import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { errorToJson } from "@tailor-platform/sdk/cli";
import { JsonlReader } from "lines-db";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  appendSeedDataRows,
  assertSeedDataDirectory,
  beginSeedDataWrite,
  commitSeedDataWrite,
  existingSeedDataFiles,
  loadLocatedSeedRows,
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

function makeDataset(baseDir: string, name: string, files: Record<string, string>): string {
  const dir = path.join(baseDir, name);
  mkdirSync(dir);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function thrownBy(load: () => unknown): Error {
  try {
    load();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  return expect.unreachable("expected the load to throw");
}

function printed(error: Error): unknown {
  return errorToJson(error).error.message;
}

afterEach(() => {
  vi.restoreAllMocks();
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

  test("points at `tailor generate` for a missing data directory by default", () => {
    const dir = makeDataDir({});
    rmSync(dir, { recursive: true });

    expect(() => assertSeedDataDirectory(dir)).toThrow("Run `tailor generate` to create it.");
  });

  test("leaves `tailor generate` out of the error when told not to suggest it", () => {
    const dir = makeDataDir({});
    rmSync(dir, { recursive: true });

    expect(() => assertSeedDataDirectory(dir, { suggestGenerate: false })).toThrow(
      new RegExp(`^Seed data directory not found: ${dir}\\.$`),
    );
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

  test("skips blank and whitespace-only lines between rows", () => {
    const dir = makeDataDir({ "User.jsonl": '{"id":1}\n\n \t \n{"id":2}\n' });
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

  describe("several data directories", () => {
    test("concatenates each table's rows in directory order", () => {
      const base = makeDataDir({ "User.jsonl": '{"id":"u1"}\n', "Order.jsonl": '{"id":"o1"}\n' });
      const cogs = makeDataset(base, "cogs", { "User.jsonl": '{"id":"u2"}\n' });
      const local = makeDataset(base, "local", { "User.jsonl": '{"id":"u3"}\n' });

      expect(loadSeedData([base, cogs, local], ["User", "Order"])).toEqual({
        User: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
        Order: [{ id: "o1" }],
      });
    });

    test.each([
      ["no blank lines", '{"id":"u1"}\n{"id":"u2"}\n', '{"id":"u3"}\n{"id":"u2"}\n', 2, 2],
      ["blank lines", '\n{"id":"u2"}\n', '{"id":"u3"}\n\n{"id":"u2"}\n', 3, 2],
    ])(
      "rejects an id defined in two directories, naming both lines, with %s",
      (_label, baseContent, cogsContent, cogsLine, baseLine) => {
        const base = makeDataDir({ "User.jsonl": baseContent });
        const cogs = makeDataset(base, "cogs", { "User.jsonl": cogsContent });
        vi.spyOn(process, "cwd").mockReturnValue(base);

        const error = thrownBy(() => loadSeedData([base, cogs], ["User"]));

        expect(error.message).toBe(
          `id "u2" is already defined at User.jsonl:${baseLine}. ` +
            "A row can be defined in only one of the data directories applied together.",
        );
        expect(printed(error)).toBe(`cogs/User.jsonl:${cogsLine}: ${error.message}`);
      },
    );

    test("leaves duplicates within a single directory to the database", () => {
      const base = makeDataDir({ "User.jsonl": '{"id":"u1"}\n{"id":"u1"}\n' });

      expect(loadSeedData([base], ["User"])).toEqual({ User: [{ id: "u1" }, { id: "u1" }] });
    });

    test("ignores rows without a key", () => {
      const base = makeDataDir({ "User.jsonl": '{"name":"a"}\n' });
      const cogs = makeDataset(base, "cogs", { "User.jsonl": '{"name":"b"}\n' });

      expect(loadSeedData([base, cogs], ["User"])).toEqual({
        User: [{ name: "a" }, { name: "b" }],
      });
    });
  });

  test.each([
    ["a malformed row", '{"ok":true}\nnot-json\n', 2],
    ["a malformed row after blank lines", '\n\n{"ok":true}\nnot-json\n', 4],
    ["a second byte order mark", '\uFEFF\uFEFF{"id":1}\n{"id":2}\n', 1],
    ["a no-break space before the first row", '\u00A0{"id":1}\n{"id":2}\n', 1],
    ["a no-break space after the last row", '{"id":1}\n{"id":2}\u00A0\n', 2],
  ])("rejects a file with %s at the line the validator rejects", async (_label, content, line) => {
    const dir = makeDataDir({ "User.jsonl": content });
    expect(await JsonlReader.read(path.join(dir, "User.jsonl"))).toMatchObject({
      ok: false,
      error: { line },
    });
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const error = thrownBy(() => loadSeedData(dir, ["User"]));
    expect(error.message).toMatch(/^Invalid JSON: /);
    expect(printed(error)).toBe(`User.jsonl:${line}: ${error.message}`);
  });

  test.each(["null", "[]", '"text"', "42"])("rejects non-object JSON rows: %s", (row) => {
    const dir = makeDataDir({ "Bad.jsonl": `${row}\n` });
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const error = thrownBy(() => loadSeedData(dir, ["Bad"]));
    expect(error.message).toBe("Invalid seed row: expected a JSON object");
    expect(printed(error)).toBe(`Bad.jsonl:1: ${error.message}`);
  });

  test.each([
    ["missing", '{"name":"Alice"}\n', 1],
    ["null", '{"id":"customer-1"}\n{"id":null,"name":"Bob"}\n', 2],
    ["missing", '\n\n{"name":"Alice"}\n', 3],
  ])(
    "rejects an %s id in %j with the file and line number when requireId is set",
    (_label, content, line) => {
      const dir = makeDataDir({ "Customer.jsonl": content });
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      const error = thrownBy(() => loadSeedData(dir, ["Customer"], { requireId: true }));
      expect(error.message).toMatch(/^`id` is required with --upsert/);
      expect(printed(error)).toBe(`Customer.jsonl:${line}: ${error.message}`);
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

    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const error = thrownBy(() =>
      loadSeedData(dir, ["Customer"], {
        requireId: true,
        requiredFieldsByType: { Customer: ["name", "email"] },
      }),
    );

    expect(error.message).toBe("field `email` is required with --upsert");
    expect(printed(error)).toBe(`Customer.jsonl:2: ${error.message}`);
  });
});

describe("loadLocatedSeedRows", () => {
  test("locates each row at its file and physical line", () => {
    const base = makeDataDir({ "_User.jsonl": '{"name":"a"}\n\n{"name":"b"}\n' });
    const local = makeDataset(base, "local", { "_User.jsonl": '{"name":"c"}\n' });

    expect(loadLocatedSeedRows([base, local], "_User")).toEqual([
      { row: { name: "a" }, location: { file: path.join(base, "_User.jsonl"), line: 1 } },
      { row: { name: "b" }, location: { file: path.join(base, "_User.jsonl"), line: 3 } },
      { row: { name: "c" }, location: { file: path.join(local, "_User.jsonl"), line: 1 } },
    ]);
  });

  test("identifies rows by the key field it is given", () => {
    const base = makeDataDir({ "_User.jsonl": '{"name":"ada@example.com","password":"a"}\n' });
    const local = makeDataset(base, "local", {
      "_User.jsonl": '{"name":"ada@example.com","password":"b"}\n',
    });

    vi.spyOn(process, "cwd").mockReturnValue(base);

    const error = thrownBy(() => loadLocatedSeedRows([base, local], "_User", { keyField: "name" }));

    expect(error.message).toMatch(
      /^name "ada@example\.com" is already defined at _User\.jsonl:1\./,
    );
    expect(printed(error)).toBe(`local/_User.jsonl:1: ${error.message}`);
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

describe("beginSeedDataWrite / appendSeedDataRows / commitSeedDataWrite", () => {
  test("streams rows through the temp file and commits them on success", () => {
    const dir = makeDataDir({});

    const tmpPath = beginSeedDataWrite(dir, "User");
    appendSeedDataRows(tmpPath, [{ id: "u1" }]);
    appendSeedDataRows(tmpPath, [{ id: "u2" }]);
    const written = commitSeedDataWrite(dir, "User", tmpPath, false);

    expect(written).toBe(path.join(dir, "User.jsonl"));
    expect(loadSeedData(dir, ["User"])).toEqual({ User: [{ id: "u1" }, { id: "u2" }] });
  });

  test("without force, refuses to replace a file that already exists", () => {
    const dir = makeDataDir({ "User.jsonl": '{"id":"stale"}\n' });

    const tmpPath = beginSeedDataWrite(dir, "User");
    appendSeedDataRows(tmpPath, [{ id: "fresh" }]);

    // Guards the commit itself, not just the dump command's upfront check:
    // a second writer that reaches this point after the first one's file
    // already landed must still be rejected without --force.
    expect(() => commitSeedDataWrite(dir, "User", tmpPath, false)).toThrow(/already exists/);
    expect(loadSeedData(dir, ["User"])).toEqual({ User: [{ id: "stale" }] });
  });

  test("with force, replaces a file that already exists", () => {
    const dir = makeDataDir({ "User.jsonl": '{"id":"stale"}\n' });

    const tmpPath = beginSeedDataWrite(dir, "User");
    appendSeedDataRows(tmpPath, [{ id: "fresh" }]);
    commitSeedDataWrite(dir, "User", tmpPath, true);

    expect(loadSeedData(dir, ["User"])).toEqual({ User: [{ id: "fresh" }] });
  });
});
