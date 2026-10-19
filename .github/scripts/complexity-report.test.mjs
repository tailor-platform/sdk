import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./complexity-report.mjs", import.meta.url));

function fn(name, cognitive, cyclomatic, { line = 1, children } = {}) {
  return { name, kind: "function", line, cognitive, cyclomatic, ...(children && { children }) };
}

function flatten(functions) {
  return functions.flatMap((f) => [f, ...flatten(f.children ?? [])]);
}

function report(files, { parseErrorFiles = [] } = {}) {
  const all = Object.values(files).flatMap(flatten);
  const sum = (metric) => all.reduce((total, f) => total + f[metric], 0);
  return {
    files: Object.entries(files).map(([path, functions]) => ({ path, functions })),
    summary: {
      file_count: Object.keys(files).length,
      function_count: all.length,
      parse_error_count: parseErrorFiles.length,
      parse_error_file_count: parseErrorFiles.length,
      ...(parseErrorFiles.length > 0 && { parse_error_files: parseErrorFiles }),
      cognitive: { sum: sum("cognitive") },
      cyclomatic: { sum: sum("cyclomatic") },
    },
  };
}

function run(t, { base, head, renames }) {
  const dir = mkdtempSync(join(tmpdir(), "complexity-report-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = (name) => join(dir, name);
  writeFileSync(path("base.json"), JSON.stringify(base));
  writeFileSync(path("head.json"), JSON.stringify(head));
  const args = ["--base", path("base.json"), "--head", path("head.json"), "--out", path("out.md")];
  if (renames !== undefined) {
    writeFileSync(path("renames.txt"), renames);
    args.push("--renames", path("renames.txt"));
  }
  execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return readFileSync(path("out.md"), "utf8");
}

function tableRows(markdown) {
  return markdown.split("\n").filter((line) => line.startsWith("| <code>"));
}

test("lists changed, added, and removed functions by the size of their change", (t) => {
  const base = report({
    "src/a.ts": [fn("grew", 5, 4, { line: 3 }), fn("same", 1, 2), fn("gone", 2, 2, { line: 9 })],
  });
  const head = report({
    "src/a.ts": [
      fn("grew", 8, 6, { line: 4 }),
      fn("same", 1, 2),
      fn("added", 7, 3, { line: 20 }),
      fn("trivial", 0, 1),
    ],
  });

  const changes = run(t, { base, head });

  assert.deepEqual(tableRows(changes), [
    "| <code>added</code> (new) | <code>src/a.ts:20</code> | – → 7 (+7) | – → 3 (+3) |",
    "| <code>grew</code> | <code>src/a.ts:4</code> | 5 → 8 (+3) | 4 → 6 (+2) |",
    "| <code>gone</code> (removed) | <code>src/a.ts:9</code> | 2 → – (-2) | 2 → – (-2) |",
  ]);
  assert.match(
    changes,
    /<summary>Complexity change of this pull request: cognitive \+8, cyclomatic \+4<\/summary>/,
  );
});

test("compares same-named functions as one group so an inserted callback does not shift the others", (t) => {
  const callbacks = [fn("<anonymous>", 2, 2, { line: 2 }), fn("<anonymous>", 1, 2, { line: 3 })];
  const base = report({ "src/a.ts": [fn("parent", 1, 1, { children: callbacks })] });
  const head = report({
    "src/a.ts": [
      fn("parent", 1, 1, { children: [fn("<anonymous>", 0, 1, { line: 2 }), ...callbacks] }),
    ],
  });

  const changes = run(t, { base, head });

  assert.deepEqual(tableRows(changes), [
    "| <code>parent &gt; &lt;anonymous&gt;</code> ×3 | <code>src/a.ts:2</code> | 3 → 3 (0) | 4 → 5 (+1) |",
  ]);
});

test("follows renamed files instead of reporting their functions as removed and added", (t) => {
  const base = report({ "src/old.ts": [fn("moved", 12, 7)] });
  const head = report({ "src/new.ts": [fn("moved", 12, 7)] });

  const changes = run(t, {
    base,
    head,
    renames: "R100\tsrc/old.ts\tsrc/new.ts\nM\tsrc/x.ts\n",
  });

  assert.equal(changes, "");
});

test("escapes markup in function names and paths", (t) => {
  const base = report({ "src/a|b.ts": [fn("key|<b>", 1, 1)] });
  const head = report({ "src/a|b.ts": [fn("key|<b>", 2, 2)] });

  const changes = run(t, { base, head });

  assert.deepEqual(tableRows(changes), [
    "| <code>key&#124;&lt;b&gt;</code> | <code>src/a&#124;b.ts:1</code> | 1 → 2 (+1) | 1 → 2 (+1) |",
  ]);
});

test("lists at most 30 functions while the total change covers all of them", (t) => {
  const names = Array.from({ length: 35 }, (_, i) => `f${i}`);
  const base = report({ "src/a.ts": names.map((name) => fn(name, 1, 1)) });
  const head = report({
    "src/a.ts": [...names.map((name, i) => fn(name, 2 + i, 1)), fn("trivial", 0, 1)],
  });

  const changes = run(t, { base, head });

  assert.equal(tableRows(changes).length, 30);
  assert.match(changes, /^…and 5 more\.$/m);
  const cognitive = head.summary.cognitive.sum - base.summary.cognitive.sum;
  const cyclomatic = head.summary.cyclomatic.sum - base.summary.cyclomatic.sum;
  assert.match(
    changes,
    new RegExp(`cognitive \\+${cognitive}, cyclomatic \\+${cyclomatic}</summary>`),
  );
});

test("writes an empty report when no function changed", (t) => {
  const files = { "src/a.ts": [fn("a", 3, 2)] };

  const changes = run(t, { base: report(files), head: report(files) });

  assert.equal(changes, "");
});

test("fails without an output path", () => {
  assert.throws(
    () => execFileSync(process.execPath, [script, "--base", "b.json", "--head", "h.json"]),
    (error) => error.status !== 0 && /--out are required/.test(error.stderr.toString()),
  );
});

test("warns about files that could not be parsed even when no function changed", (t) => {
  const files = { "src/a.ts": [fn("a", 3, 2)] };

  const changes = run(t, {
    base: report(files),
    head: report(files, { parseErrorFiles: ["src/broken.ts"] }),
  });

  assert.match(changes, /could not fully parse 1 file: <code>src\/broken.ts<\/code>/);
});
