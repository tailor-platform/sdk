import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createTimestampId, requireArg, sanitizeForFilename } from "../shared/helpers";
import { computeReportDiff, formatDelta } from "./analyze";
import type { ChallengeReport } from "./report";

/**
 * `pnpm challenge:experiment` driver.
 *
 * Runs the benchmark twice (baseline + candidate) over the same micro-problem
 * set, captures both reports, and emits a structured A/B diff. Per Phase 4
 * spec (`/Users/dqn/.claude/plans/ok-llm-challenge-rebuild-piped-curry.md`
 * section "Phase 4: A/B 実験 + 統計化") this is the convenience wrapper around
 *
 *   1. baseline:  tsx core/cli.ts --solve --iterations N <forward-args>
 *   2. candidate: tsx core/cli.ts --solve --iterations N --sdk-branch <ref> <forward-args>
 *   3. analyze:   computeReportDiff(baselineReport, candidateReport)
 *
 * Output layout:
 *
 *   results/experiments/<exp-id>/
 *     baseline.json   # baseline ChallengeReport
 *     candidate.json  # candidate ChallengeReport
 *     delta.json      # computeReportDiff() output
 */

const challengeRoot = path.resolve(import.meta.dirname, "..");

type ParsedArgs = {
  sdkBranch: string;
  iterations: number;
  forward: string[];
  expId?: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let sdkBranch: string | undefined;
  let iterations: number | undefined;
  let expId: string | undefined;
  const forward: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--sdk-branch":
        sdkBranch = requireArg(args, i, "--sdk-branch");
        i++;
        break;
      case "--iterations":
        iterations = Number(requireArg(args, i, "--iterations"));
        i++;
        break;
      case "--exp-id":
        expId = requireArg(args, i, "--exp-id");
        i++;
        break;
      default:
        // Everything else flows to both child cli.ts invocations.
        forward.push(args[i]!);
        break;
    }
  }

  if (!sdkBranch) {
    console.error("Error: --sdk-branch <ref> is required for an A/B experiment.");
    process.exit(1);
  }
  if (iterations === undefined) {
    iterations = 3;
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    console.error("Error: --iterations must be a positive integer");
    process.exit(1);
  }
  // Drop user-supplied --solve / --iterations / --sdk-branch from forward; we
  // own those flags explicitly so child invocations stay consistent.
  const filtered = filterReservedFlags(forward);

  return {
    sdkBranch,
    iterations,
    forward: filtered,
    ...(expId ? { expId } : {}),
  };
}

function filterReservedFlags(args: string[]): string[] {
  const reserved = new Set(["--solve", "--use-solution", "--sdk-branch", "--iterations"]);
  const reservedWithValue = new Set(["--sdk-branch", "--iterations"]);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (reserved.has(a)) {
      if (reservedWithValue.has(a)) i++; // skip its value too
      continue;
    }
    out.push(a);
  }
  return out;
}

async function runChild(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("tsx", [path.join(challengeRoot, "core", "cli.ts"), ...args], {
      cwd: challengeRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cli.ts exited with code ${code}`));
    });
  });
}

/**
 * Locate the freshly-written report.json for a run by finding the latest
 * `report-*.json` under `results/<labelPrefix>*` whose mtime is >= startedAt.
 * We match by directory prefix because the suffix includes contextProfile and
 * (for candidate runs) `-sdk@<branch>`.
 */
export function findLatestReport(
  resultsDir: string,
  labelPrefix: string,
  startedAt: Date,
): string | undefined {
  if (!fs.existsSync(resultsDir)) return undefined;
  const candidates: { path: string; mtimeMs: number }[] = [];
  for (const entry of fs.readdirSync(resultsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(labelPrefix)) continue;
    const subdir = path.join(resultsDir, entry.name);
    for (const f of fs.readdirSync(subdir)) {
      if (!f.startsWith("report-") || !f.endsWith(".json")) continue;
      const full = path.join(subdir, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < startedAt.getTime()) continue;
      candidates.push({ path: full, mtimeMs: stat.mtimeMs });
    }
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]!.path;
}

async function main(): Promise<void> {
  const { sdkBranch, iterations, forward, expId } = parseArgs();
  const resolvedExpId = expId ?? createTimestampId();

  const resultsDir = path.join(challengeRoot, "results");
  const experimentDir = path.join(resultsDir, "experiments", sanitizeForFilename(resolvedExpId));
  fs.mkdirSync(experimentDir, { recursive: true });

  console.log(`Experiment: ${resolvedExpId}`);
  console.log(`  sdkBranch:  ${sdkBranch}`);
  console.log(`  iterations: ${iterations}`);
  console.log(`  forward:    ${forward.join(" ") || "(none)"}`);
  console.log(`  output:     ${path.relative(challengeRoot, experimentDir)}`);
  console.log("");

  // Baseline: current working tree.
  console.log("=== Baseline (current tree) ===");
  const baselineStart = new Date();
  await runChild(["--solve", "--iterations", String(iterations), ...forward]);
  const baselinePath = findLatestReport(resultsDir, "", baselineStart);
  if (!baselinePath) {
    console.error("Could not locate baseline report after run.");
    process.exit(1);
  }
  fs.copyFileSync(baselinePath, path.join(experimentDir, "baseline.json"));
  console.log(`Baseline report: ${baselinePath}`);
  console.log("");

  // Candidate: --sdk-branch <ref>.
  console.log(`=== Candidate (sdk-branch ${sdkBranch}) ===`);
  const candidateStart = new Date();
  await runChild([
    "--solve",
    "--iterations",
    String(iterations),
    "--sdk-branch",
    sdkBranch,
    ...forward,
  ]);
  const candidatePath = findLatestReport(resultsDir, "", candidateStart);
  if (!candidatePath) {
    console.error("Could not locate candidate report after run.");
    process.exit(1);
  }
  fs.copyFileSync(candidatePath, path.join(experimentDir, "candidate.json"));
  console.log(`Candidate report: ${candidatePath}`);
  console.log("");

  // Diff.
  const baselineReport = JSON.parse(
    fs.readFileSync(path.join(experimentDir, "baseline.json"), "utf-8"),
  ) as ChallengeReport;
  const candidateReport = JSON.parse(
    fs.readFileSync(path.join(experimentDir, "candidate.json"), "utf-8"),
  ) as ChallengeReport;
  const delta = computeReportDiff(baselineReport, candidateReport, {
    a: path.relative(experimentDir, baselinePath),
    b: path.relative(experimentDir, candidatePath),
  });
  fs.writeFileSync(path.join(experimentDir, "delta.json"), JSON.stringify(delta, null, 2));
  console.log(`Delta written to: ${path.join(experimentDir, "delta.json")}`);
  console.log("");
  console.log(`Overall ΔpassRate: ${formatDelta(delta.overallPassRateDelta, 3)}`);
  console.log(`Total ΔcostUSD:    ${formatDelta(delta.totalCostDelta, 4)}`);
  for (const w of delta.warnings) {
    console.log(`WARNING: ${w}`);
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
