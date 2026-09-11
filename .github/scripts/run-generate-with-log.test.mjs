import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-generate-with-log.mjs", import.meta.url));

for (const stream of ["stdout", "stderr"]) {
  test(`decodes split UTF-8 from ${stream} in the summary`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "generate-log-"));
    t.after(() => rmSync(dir, { recursive: true }));
    const fixture = join(dir, "split.mjs");
    const summary = join(dir, "summary.md");
    writeFileSync(
      fixture,
      `
      const bytes = Buffer.from(["診断", process.pid].join(":"));
      process.${stream}.write(bytes.subarray(0, 1));
      setTimeout(() => {
        process.${stream}.write(bytes.subarray(1));
        process.exitCode = 7;
      }, 100);
    `,
    );
    const result = spawnSync(process.execPath, [script, process.execPath, fixture], {
      encoding: "utf8",
      env: {
        ...process.env,
        GENERATE_LOG_DIR: dir,
        GENERATE_LOG_ARTIFACT: "generate-test",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.match(result[stream], /^診断:\d+$/);
    assert.equal(readFileSync(join(dir, "generate.log"), "utf8"), result[stream]);
    assert.ok(readFileSync(summary, "utf8").includes(result[stream]));
  });
}

test("records exact command argument boundaries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "generate-log-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const summary = join(dir, "summary.md");
  const argv = ["bash", "-c", "exit 7"];
  const result = spawnSync(process.execPath, [script, ...argv], {
    encoding: "utf8",
    env: {
      ...process.env,
      GENERATE_LOG_DIR: dir,
      GENERATE_LOG_ARTIFACT: "generate-test",
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  assert.equal(result.status, 7, result.stderr);
  const field = readFileSync(summary, "utf8").match(
    /Command argv \(JSON\):\n\n<pre>([^<]+)<\/pre>/,
  );
  assert.ok(field, "summary must label its JSON argv field");
  const recorded = JSON.parse(field[1]);
  assert.deepEqual(recorded, argv);
  assert.equal(spawnSync(recorded[0], recorded.slice(1)).status, 7);
});

for (const exitCode of [0, 7]) {
  test(`captures a single invocation and preserves exit ${exitCode}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "generate-log-"));
    t.after(() => rmSync(dir, { recursive: true }));
    const fixture = join(dir, "child.mjs");
    const summary = join(dir, "summary.md");
    writeFileSync(join(dir, "generate.log"), "stale evidence");
    writeFileSync(
      fixture,
      `
      import { appendFileSync } from "node:fs";
      appendFileSync(${JSON.stringify(join(dir, "invocations"))}, "executed\\n");
      process.stdout.write(["out", process.pid].join(":") + "\\n");
      process.stderr.write(["err", process.pid].join(":") + " <details>\\n");
      process.exitCode = ${exitCode};
    `,
    );
    const result = spawnSync(process.execPath, [script, process.execPath, fixture], {
      encoding: "utf8",
      env: {
        ...process.env,
        GENERATE_LOG_DIR: dir,
        GENERATE_LOG_ARTIFACT: "generate-test",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.equal(result.status, exitCode, result.stderr);
    assert.match(result.stdout, /^out:\d+\n$/);
    assert.match(result.stderr, /^err:\d+ <details>\n$/);
    assert.equal(readFileSync(join(dir, "invocations"), "utf8"), "executed\n");
    const log = readFileSync(join(dir, "generate.log"), "utf8");
    assert.ok(log.includes(result.stdout));
    assert.ok(log.includes(result.stderr));
    assert.ok(!log.includes("stale evidence"));
    const report = readFileSync(summary, "utf8");
    assert.ok(report.includes(`Exit code: ${exitCode}`));
    assert.ok(report.includes("generate-test"));
    if (exitCode !== 0) assert.ok(report.includes("&lt;details&gt;"));
  });
}

test("reports a command that could not start", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "generate-log-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const summary = join(dir, "summary.md");
  const result = spawnSync(process.execPath, [script, join(dir, "missing-command")], {
    encoding: "utf8",
    env: {
      ...process.env,
      GENERATE_LOG_DIR: dir,
      GENERATE_LOG_ARTIFACT: "generate-test",
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(readFileSync(join(dir, "generate.log"), "utf8"), /Failed to start command:/);
  assert.match(readFileSync(summary, "utf8"), /Exit code: 1/);
});
