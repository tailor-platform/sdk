import assert from "node:assert/strict";
import { test } from "node:test";
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

test("reuses only a successful check for the same PR and head", () => {
  const cases = [
    ["success", [successfulRun], [successfulJob], successfulRun],
    ["no runs", [], [successfulJob], undefined],
    [
      "other PR",
      [{ ...successfulRun, pull_requests: [{ number: 43 }] }],
      [successfulJob],
      undefined,
    ],
    ["other head", [{ ...successfulRun, head_sha: "other" }], [successfulJob], undefined],
    ["current run", [{ ...successfulRun, id: 20 }], [successfulJob], undefined],
    ["unfinished", [{ ...successfulRun, status: "in_progress" }], [successfulJob], undefined],
    ["other event", [{ ...successfulRun, event: "push" }], [successfulJob], undefined],
    ["failed run", [{ ...successfulRun, conclusion: "failure" }], [successfulJob], undefined],
    ["failed job", [successfulRun], [{ ...successfulJob, conclusion: "failure" }], undefined],
    ["missing job", [successfulRun], [], undefined],
  ];
  for (const [name, runs, jobs, expected] of cases) {
    assert.equal(
      findReusableDocsCheck(
        { event, repository, runId: 20 },
        requestFor(runs, { 10: jobs, 20: jobs }),
      ),
      expected,
      name,
    );
  }
});

test("a latest unsuccessful check prevents reusing an older success", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const latest = { ...successfulRun, id: 11, conclusion, run_started_at: "2026-11-11T12:01:00Z" };
    assert.equal(
      findReusableDocsCheck(
        { event, repository, runId: 20 },
        requestFor([successfulRun, latest], {
          10: [successfulJob],
          11: [{ ...successfulJob, conclusion }],
        }),
      ),
      undefined,
      conclusion,
    );
  }
});

test("manual requests always run without reading prior results", () => {
  assert.equal(
    findReusableDocsCheck({ event: { ...event, action: "labeled" }, repository, runId: 20 }, () =>
      assert.fail("A manual request must not query prior runs"),
    ),
    undefined,
  );
});
