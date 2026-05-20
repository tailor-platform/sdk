import fs from "node:fs";
import path from "node:path";
import type { ChallengeReport, ProblemResult } from "./report";

/**
 * Number of consecutive most-recent reports inspected by the graduation rule.
 * The current run counts as one of the N; the other N-1 are loaded from disk.
 */
export const GRADUATION_HISTORY_WINDOW = 5;

/**
 * Variance threshold for the graduation rule. The latest report's
 * `iterations.metricsStdev.turns / iterations.metricsMedian.turns` must be
 * strictly below this value. 0.1 mirrors the SKILL.md spec.
 */
export const GRADUATION_STDEV_RATIO = 0.1;

export type GraduationContext = {
  /** Path returned by getRunResultsDir() — contains `report-*.json` for this group. */
  runResultsDir: string;
  /** Repo root where `problems/<id>` lives. */
  challengeRoot: string;
  /** The just-finished report (already written to disk). */
  latestReport: ChallengeReport;
};

export type GraduationOutcome = {
  /** Directory names (under `problems/`) that were moved into `archived/`. */
  graduated: string[];
};

/**
 * Read the most-recent `n` report JSON files from `runResultsDir`, sorted
 * newest-first. Filenames embed the runId timestamp so lexical sort is the
 * correct chronological order. Malformed JSON files are silently skipped so a
 * single corrupt artifact never blocks graduation.
 */
export function loadRecentReports(runResultsDir: string, n: number): ChallengeReport[] {
  if (!fs.existsSync(runResultsDir)) return [];
  const files = fs
    .readdirSync(runResultsDir)
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .sort((a, b) => b.localeCompare(a));
  const out: ChallengeReport[] = [];
  for (const f of files) {
    if (out.length >= n) break;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(runResultsDir, f), "utf-8"));
      out.push(parsed as ChallengeReport);
    } catch {
      // tolerate; one bad file should not block the graduation decision
    }
  }
  return out;
}

function findProblemResult(report: ChallengeReport, problemId: string): ProblemResult | undefined {
  return report.results.find((r) => r.problemId === problemId);
}

/**
 * Decide whether the supplied reports (newest-first) qualify the problem for
 * graduation.
 *
 * Rule (mirrors SKILL.md):
 * - the most-recent `window` reports must all contain the problem with
 *   `passRate === 1.0` (uses `iterations.passRate` when present, otherwise
 *   the binary `passed` field as a fallback for single-iteration runs);
 * - the **latest** report must carry iteration data and the per-iteration
 *   `metricsStdev.turns / metricsMedian.turns` ratio for the problem must be
 *   strictly below `stdevRatio`. A degenerate `median.turns === 0` returns
 *   false — an empty trace is not evidence of stability.
 */
export function isGraduationCandidate(
  reports: ChallengeReport[],
  problemId: string,
  options: { windowSize?: number; stdevRatio?: number } = {},
): boolean {
  const window = options.windowSize ?? GRADUATION_HISTORY_WINDOW;
  const ratio = options.stdevRatio ?? GRADUATION_STDEV_RATIO;
  if (reports.length < window) return false;
  for (let i = 0; i < window; i++) {
    const r = findProblemResult(reports[i]!, problemId);
    if (!r) return false;
    const passRate = r.iterations?.passRate ?? (r.passed ? 1 : 0);
    if (passRate < 1) return false;
  }
  const latest = findProblemResult(reports[0]!, problemId);
  const median = latest?.iterations?.metricsMedian.turns ?? 0;
  const stdev = latest?.iterations?.metricsStdev.turns ?? 0;
  if (median <= 0) return false;
  return stdev / median < ratio;
}

/**
 * Resolve a problem id back to its on-disk directory name under `problems/`.
 * Returns `undefined` for ids that no longer have an active directory (e.g.
 * already archived, renamed-and-removed). Only walks the active subtree —
 * graduation never touches the archived subtree.
 */
function findActiveProblemDir(challengeRoot: string, problemId: string): string | undefined {
  const problemsDir = path.join(challengeRoot, "problems");
  if (!fs.existsSync(problemsDir)) return undefined;
  for (const ent of fs.readdirSync(problemsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "archived" || ent.name.startsWith("_")) continue;
    const metaPath = path.join(problemsDir, ent.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { id?: string };
      if (meta.id === problemId) return ent.name;
    } catch {
      // tolerate; a malformed meta.json should not block scanning siblings
    }
  }
  return undefined;
}

/**
 * Move `problems/<dirName>` to `problems/archived/<dirName>`. Returns `false`
 * when the source is missing or the destination already exists; the caller
 * can treat both cases as no-ops (e.g. concurrent runs racing to archive the
 * same problem).
 */
export function archiveProblemDir(challengeRoot: string, dirName: string): boolean {
  const src = path.join(challengeRoot, "problems", dirName);
  const archivedRoot = path.join(challengeRoot, "problems", "archived");
  const dest = path.join(archivedRoot, dirName);
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(archivedRoot, { recursive: true });
  fs.renameSync(src, dest);
  return true;
}

/**
 * Apply the graduation rule across every problem in `context.latestReport`.
 * Only solver runs on the `types-only` profile are eligible — the rule is
 * defined for the stricter profile, and verify / non-types-only runs do not
 * carry the right signal.
 */
export function graduateProblems(context: GraduationContext): GraduationOutcome {
  const report = context.latestReport;
  if (report.contextProfile !== "types-only") return { graduated: [] };
  if (!report.model) return { graduated: [] };
  if (report.sdkBranch) return { graduated: [] };

  const reports = loadRecentReports(context.runResultsDir, GRADUATION_HISTORY_WINDOW);
  const graduated: string[] = [];
  for (const r of report.results) {
    if (!isGraduationCandidate(reports, r.problemId)) continue;
    const dirName = findActiveProblemDir(context.challengeRoot, r.problemId);
    if (!dirName) continue;
    if (archiveProblemDir(context.challengeRoot, dirName)) {
      graduated.push(dirName);
    }
  }
  return { graduated };
}
