#!/usr/bin/env node
// Finds the erd-schema.yml export run at or before the PR's fork point on
// BASE_REF, searching successful runs newest-first. Bounded to the export
// artifacts' own 90-day retention window (see the export job's Upload
// step) — a run older than that has no artifact left to download
// regardless — and to a maximum candidate count (MAX_CANDIDATE_RUNS,
// default below; configurable since `tailor-sdk setup`-generated workflows
// may want a different limit). Falls back to the latest export on
// BASE_REF if nothing at-or-before the fork point is found among the
// checked candidates.
import { appendFileSync } from "node:fs";

export const DEFAULT_MAX_CANDIDATE_RUNS = 100;
export const RETENTION_DAYS = 90;
const COMPARE_BATCH_SIZE = 10;

/**
 * @param {object} params
 * @param {string} params.forkSha
 * @param {{ id: number, head_sha: string }[]} params.runs - newest-first, already bounded
 * @param {(base: string, head: string) => Promise<string>} params.compareStatus - resolves to a compare `status`, or "diverged" on error
 * @returns {Promise<{ runId: string, reason: string }>}
 */
export async function findBaseRun({ forkSha, runs, compareStatus }) {
  for (let i = 0; i < runs.length; i += COMPARE_BATCH_SIZE) {
    const batch = runs.slice(i, i + COMPARE_BATCH_SIZE);
    // Checked in batches (not all at once) to stay well clear of GitHub's
    // secondary rate limits, and not one at a time so a fork point with no
    // nearby match doesn't serialize hundreds of round trips.
    const statuses = await Promise.all(batch.map((run) => compareStatus(run.head_sha, forkSha)));
    for (let j = 0; j < batch.length; j++) {
      if (statuses[j] === "ahead" || statuses[j] === "identical") {
        return { runId: String(batch[j].id), reason: "Matched at or before the fork point." };
      }
    }
  }

  if (runs.length === 0) {
    return { runId: "", reason: "No successful ERD schema export runs found." };
  }
  return {
    runId: String(runs[0].id),
    reason: `No export found at or before fork point ${forkSha}; falling back to the latest export.`,
  };
}

async function main() {
  const {
    GH_TOKEN,
    REPO,
    FORK_SHA,
    BASE_REF,
    MAX_CANDIDATE_RUNS = String(DEFAULT_MAX_CANDIDATE_RUNS),
    GITHUB_OUTPUT,
  } = process.env;
  const maxCandidateRuns = Number(MAX_CANDIDATE_RUNS);

  function setOutput(name, value) {
    if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${name}=${value}\n`);
  }

  async function githubApi(path) {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async function compareStatus(base, head) {
    try {
      const { status } = await githubApi(`repos/${REPO}/compare/${base}...${head}`);
      return status;
    } catch {
      return "diverged";
    }
  }

  async function listExportRuns() {
    const since = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const runs = [];
    for (let page = 1; runs.length < maxCandidateRuns; page++) {
      const qs = new URLSearchParams({
        branch: BASE_REF,
        status: "success",
        created: `>=${since}`,
        per_page: "100",
        page: String(page),
      });
      const { workflow_runs } = await githubApi(
        `repos/${REPO}/actions/workflows/erd-schema.yml/runs?${qs}`,
      );
      runs.push(...workflow_runs);
      if (workflow_runs.length < 100) break;
    }
    return runs.slice(0, maxCandidateRuns);
  }

  const runs = await listExportRuns();
  const { runId, reason } = await findBaseRun({ forkSha: FORK_SHA, runs, compareStatus });
  console.log(reason);
  setOutput("run_id", runId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
