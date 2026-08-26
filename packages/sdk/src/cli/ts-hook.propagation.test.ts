import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as path from "pathe";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(cliDir, "__test_fixtures__/nonce-propagation");

test("nonce'd entry imports re-evaluate their static-import children per run", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(fixtureDir, "runner.mjs"),
    path.join(cliDir, "ts-hook.mjs"),
    path.join(fixtureDir, "entry.ts"),
  ]);
  expect(JSON.parse(stdout.trim())).toEqual({ entryEvaluations: 2, childEvaluations: 2 });
}, 30000);
