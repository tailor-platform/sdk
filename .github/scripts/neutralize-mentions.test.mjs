import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./neutralize-mentions.mjs", import.meta.url));
const ZWSP = "​";

test("stdin/stdout mode inserts a ZWSP after every '@', including UTF-8 text", () => {
  const input = "fix(deps): update @inquirer for 日本語 @ユーザー and @types/node";
  const result = spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `fix(deps): update @${ZWSP}inquirer for 日本語 @${ZWSP}ユーザー and @${ZWSP}types/node`,
  );
});

test("stdin/stdout mode leaves text without '@' unchanged", () => {
  const input = "chore: update dependency to v1.2.3";
  const result = spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
});

test("file mode rewrites the file in place, preserving UTF-8 content", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "neutralize-mentions-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, "review.md");
  writeFileSync(file, "hello @world and @claude — 日本語も@そのまま\n", "utf8");

  const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(file, "utf8"),
    `hello @${ZWSP}world and @${ZWSP}claude — 日本語も@${ZWSP}そのまま\n`,
  );
});
