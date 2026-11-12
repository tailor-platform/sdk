import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function api(path) {
  return JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", path], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

export function findReusableDocsCheck({ event, repository, runId }, request = api) {
  if (event.action !== "ready_for_review") return undefined;

  const headSha = event.pull_request.head.sha;
  const query = new URLSearchParams({ event: "pull_request", head_sha: headSha, per_page: "100" });
  const runs = request(
    `repos/${repository}/actions/workflows/docs-consistency-check.yml/runs?${query}`,
  )
    .flatMap((page) => page.workflow_runs)
    .filter(
      (run) =>
        run.id !== runId &&
        run.event === "pull_request" &&
        run.head_sha === headSha &&
        run.status === "completed" &&
        run.pull_requests.some((pr) => pr.number === event.number),
    )
    .sort((a, b) => Date.parse(b.run_started_at) - Date.parse(a.run_started_at) || b.id - a.id);

  for (const run of runs) {
    const job = request(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`)
      .flatMap((page) => page.jobs)
      .find((entry) => entry.name === "Docs consistency");
    if (job?.conclusion === "skipped") continue;
    return run.conclusion === "success" && job?.conclusion === "success" ? run : undefined;
  }
  return undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const run = findReusableDocsCheck({
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    repository: process.env.GITHUB_REPOSITORY,
    runId: Number(process.env.GITHUB_RUN_ID),
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${Boolean(run)}\n`);
  if (run) console.log(`Reusing Docs consistency: ${run.html_url}`);
}
