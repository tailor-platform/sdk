import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const workflowLines = readFileSync(
  new URL("../.github/workflows/migration-model-seeds.yml", import.meta.url),
  "utf8",
).split("\n");

function stepLines(name) {
  const start = workflowLines.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`step "${name}" not found in migration-model-seeds.yml`);
  const end = workflowLines.findIndex(
    (line, i) => i > start && /^( {6}- name:|\S| {0,4}\S)/.test(line),
  );
  return workflowLines.slice(start, end < 0 ? undefined : end);
}

function stepScript(name) {
  const block = stepLines(name);
  const run = block.findIndex((line) => line.startsWith("        run: "));
  if (run < 0) throw new Error(`step "${name}" has no run`);
  if (block[run] !== "        run: |") return block[run].slice("        run: ".length);
  return block
    .slice(run + 1)
    .map((line) => line.slice(10))
    .join("\n");
}

function jobEnv(name) {
  const line = workflowLines.find((entry) => entry.startsWith(`      ${name}: `));
  if (!line) throw new Error(`job env ${name} not found in migration-model-seeds.yml`);
  return line.slice(`      ${name}: `.length);
}

const SEED = "45842673313";
const SHA = "3bfc05dc1dbd10e627719c4038a70af191aff737";
const RUN_URL = "https://github.com/tailor-platform/sdk/actions/runs/45842673313";

describe("migration model seeds workflow", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function notify(outcome) {
    dir = mkdtempSync(join(tmpdir(), "model-seeds-slack-"));
    writeFileSync(join(dir, "curl"), '#!/bin/sh\nprintf "%s\\n" "$*" >&2\ncat\n');
    chmodSync(join(dir, "curl"), 0o755);
    const result = spawnSync("bash", ["-e", "-c", stepScript("Notify Slack on failure")], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        SLACK_WEBHOOK_URL: "https://example.com/webhook",
        RUN_URL,
        COMMIT_SHA: SHA,
        MODEL_SEED: SEED,
        MODEL_TEST: jobEnv("MODEL_TEST"),
        MODEL_OUTCOME: outcome,
      },
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: expect.stringContaining("https://example.com/webhook"),
    });
    return JSON.parse(result.stdout).text;
  }

  test("runs the model test the Slack message names", () => {
    expect(stepScript("Run the model test")).toBe('pnpm exec vitest run "$MODEL_TEST"');
    expect(existsSync(new URL(`../packages/sdk/${jobEnv("MODEL_TEST")}`, import.meta.url))).toBe(
      true,
    );
  });

  test("a failed model test posts its seed, commit, and reproduce command", () => {
    expect(notify("failure")).toBe(
      `:rotating_light: Migration model test <${RUN_URL}|failed> with MODEL_SEED=${SEED} at 3bfc05dc1. ` +
        `Reproduce at that commit in packages/sdk: \`MODEL_SEED=${SEED} pnpm test src/cli/commands/deploy/tailordb/migration-model.test.ts\``,
    );
  });

  test("a failure before the model test says the test did not run", () => {
    expect(notify("skipped")).toBe(
      `:rotating_light: Migration model seeds workflow <${RUN_URL}|failed> before the model test ran`,
    );
  });
});
