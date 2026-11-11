import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findReusableDocsCheck } from "./docs-consistency-reuse.mjs";

const repository = "tailor-platform/sdk";
const headSha = "abc123";
const event = {
  action: "ready_for_review",
  number: 42,
  pull_request: { head: { sha: headSha } },
};
const runsPath = `repos/${repository}/actions/workflows/docs-consistency-check.yml/runs?event=pull_request&head_sha=${headSha}&per_page=100`;
const jobsPath = (id) => `repos/${repository}/actions/runs/${id}/jobs?per_page=100`;
const successfulRun = {
  id: 10,
  head_sha: headSha,
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  run_started_at: "2026-11-11T12:00:00Z",
  pull_requests: [{ number: 42 }],
  html_url: "https://github.com/tailor-platform/sdk/actions/runs/10",
};
const successfulJob = { name: "Docs consistency", conclusion: "success" };

function requestFor(runs, jobs = { 10: [successfulJob] }) {
  return (path) => {
    if (path === runsPath) return [{ workflow_runs: runs }];
    const id = Object.keys(jobs).find((id) => jobsPath(id) === path);
    assert.ok(id, `Unexpected API call: ${path}`);
    return [{ jobs: jobs[id] }];
  };
}

test("a manual check followed by ready runs the review only once", () => {
  let invocations = 0;
  const runs = [];
  const api = (path) => {
    if (path === runsPath) return [{ workflow_runs: runs }];
    assert.equal(path, jobsPath(10));
    return [{ jobs: [successfulJob] }];
  };

  for (const action of ["labeled", "ready_for_review"]) {
    const reused = findReusableDocsCheck(
      { event: { ...event, action }, repository, runId: 20 },
      api,
    );
    if (!reused) {
      invocations++;
      runs.push(successfulRun);
    }
  }

  console.log(`Review invocations for manual then ready: ${invocations}`);
  assert.equal(invocations, 1);
});

test("manual requests always run, without reading prior results", () => {
  assert.equal(
    findReusableDocsCheck({ event: { ...event, action: "labeled" }, repository, runId: 20 }, () =>
      assert.fail("A manual request must not query prior runs"),
    ),
    undefined,
  );
});

test("no earlier result requires a review", () => {
  assert.equal(findReusableDocsCheck({ event, repository, runId: 20 }, requestFor([])), undefined);
});

test("ignores the current run, other PRs, different SHAs, and unfinished runs", () => {
  const runs = [
    { ...successfulRun, id: 20 },
    { ...successfulRun, pull_requests: [{ number: 43 }] },
    { ...successfulRun, head_sha: "other-sha" },
    { ...successfulRun, status: "in_progress" },
    { ...successfulRun, event: "push" },
  ];
  assert.equal(
    findReusableDocsCheck({ event, repository, runId: 20 }, requestFor(runs, {})),
    undefined,
  );
});

for (const conclusion of ["failure", "cancelled", "timed_out"]) {
  test(`the latest ${conclusion} prevents reusing an older success`, () => {
    const latest = {
      ...successfulRun,
      id: 11,
      conclusion,
      run_started_at: "2026-11-11T12:01:00Z",
    };
    assert.equal(
      findReusableDocsCheck(
        { event, repository, runId: 20 },
        requestFor([successfulRun, latest], { 11: [{ ...successfulJob, conclusion }] }),
      ),
      undefined,
    );
  });
}

test("a cancelled run without a job prevents reusing an older success", () => {
  const latest = { ...successfulRun, id: 11, conclusion: "cancelled" };
  assert.equal(
    findReusableDocsCheck(
      { event, repository, runId: 20 },
      requestFor([successfulRun, latest], { 11: [] }),
    ),
    undefined,
  );
});

test("a skipped docs job from an unrelated label does not hide an earlier review", () => {
  const skipped = { ...successfulRun, id: 11 };
  assert.equal(
    findReusableDocsCheck(
      { event, repository, runId: 20 },
      requestFor([successfulRun, skipped], {
        10: [successfulJob],
        11: [{ ...successfulJob, conclusion: "skipped" }],
      }),
    ),
    successfulRun,
  );
});

test("a successful workflow without a successful docs job cannot be reused", () => {
  for (const jobs of [[], [{ ...successfulJob, conclusion: "failure" }]]) {
    assert.equal(
      findReusableDocsCheck(
        { event, repository, runId: 20 },
        requestFor([successfulRun], { 10: jobs }),
      ),
      undefined,
    );
  }
});

test("uses the latest start time when an older run has been rerun", () => {
  const rerun = {
    ...successfulRun,
    id: 9,
    conclusion: "failure",
    run_started_at: "2026-11-11T12:01:00Z",
  };
  assert.equal(
    findReusableDocsCheck(
      { event, repository, runId: 20 },
      requestFor([successfulRun, rerun], { 9: [{ ...successfulJob, conclusion: "failure" }] }),
    ),
    undefined,
  );
});

test("reads all pages of runs and jobs", () => {
  const request = (path) => {
    if (path === runsPath) return [{ workflow_runs: [] }, { workflow_runs: [successfulRun] }];
    assert.equal(path, jobsPath(10));
    return [{ jobs: [] }, { jobs: [successfulJob] }];
  };
  assert.equal(findReusableDocsCheck({ event, repository, runId: 20 }, request), successfulRun);
});

test("propagates errors from either API request", () => {
  for (const failingPath of [runsPath, jobsPath(10)]) {
    const request = (path) => {
      if (path === failingPath) throw new Error("API unavailable");
      return requestFor([successfulRun])(path);
    };
    assert.throws(
      () => findReusableDocsCheck({ event, repository, runId: 20 }, request),
      /API unavailable/,
    );
  }
});

function runCli(t, action, failure = false) {
  const dir = mkdtempSync(join(tmpdir(), "docs-consistency-reuse-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const eventFile = join(dir, "event.json");
  const outputFile = join(dir, "output");
  const fixtureFile = join(dir, "fixture.json");
  writeFileSync(eventFile, JSON.stringify({ ...event, action }));
  writeFileSync(outputFile, "");
  writeFileSync(
    fixtureFile,
    JSON.stringify({
      [runsPath]: [{ workflow_runs: [successfulRun] }],
      [jobsPath(10)]: [{ jobs: [successfulJob] }],
    }),
  );
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.env.FAIL_API === "true") process.exit(1);
const responses = JSON.parse(fs.readFileSync(process.env.FIXTURE_FILE, "utf8"));
process.stdout.write(JSON.stringify(responses[process.argv.at(-1)]));
`,
  );
  chmodSync(gh, 0o755);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./docs-consistency-reuse.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        GITHUB_EVENT_PATH: eventFile,
        GITHUB_REPOSITORY: repository,
        GITHUB_RUN_ID: "20",
        GITHUB_SHA: "merge-sha",
        GITHUB_OUTPUT: outputFile,
        FIXTURE_FILE: fixtureFile,
        FAIL_API: String(failure),
      },
    },
  );
  return { ...result, output: readFileSync(outputFile, "utf8") };
}

test("CLI uses the PR head SHA and writes the reuse decision", (t) => {
  const result = runCli(t, "ready_for_review");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "reuse=true\n");
  assert.match(result.stdout, /Reusing Docs consistency: https:\/\/github.com\//);
});

test("CLI emits false for a manual request even if the API is unavailable", (t) => {
  const result = runCli(t, "labeled", true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "reuse=false\n");
});

test("CLI fails without a decision if the API fails", (t) => {
  const result = runCli(t, "ready_for_review", true);
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

test("posting a fresh review fails when no review body was produced", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "docs-consistency-post-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workflow = readFileSync(
    new URL("../workflows/docs-consistency-check.yml", import.meta.url),
    "utf8",
  );
  const step = workflow
    .split("      - name: Post docs consistency review\n")[1]
    .split("\n      - name:")[0];
  const script = step
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    env: { ...process.env, REVIEW_BODY_FILE: join(dir, "missing.md") },
  });
  assert.notEqual(result.status, 0, result.stdout);
});
