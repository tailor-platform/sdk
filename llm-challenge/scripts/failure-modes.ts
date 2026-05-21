/**
 * For every failed `ProblemResult` in `results/<session>/report-*.json`,
 * inspect each failing `stages[]` entry and bucket the failure into a
 * coarse "mode" so we can answer "when this problem fails, how does it
 * fail?". Output goes to stdout as Markdown. Pass `--csv <file>` to
 * also emit the per-failure CSV.
 *
 *   tsx llm-challenge/scripts/failure-modes.ts
 *   tsx llm-challenge/scripts/failure-modes.ts --csv failure-modes.csv
 *
 * The stage outputs we read are aggregated across iterations by the
 * runner, so per-iteration granularity is best-effort: a (problem,
 * profile, sdkBranch) entry surfaces all failure modes seen in *any*
 * iteration of that group, not per-iter. When a problem passed in some
 * iterations and failed in others ("mixed-pass"), the runner's
 * `aggregateIterations` keeps only the best (passing) iter's stages, so
 * the per-iter failure detail is lost from the report; the script counts
 * those skipped iters separately and flags the gap in its header.
 */

import fs from "node:fs";
import path from "node:path";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");

type RawReport = {
  contextProfile?: string;
  sdkBranch?: string;
  results?: Array<{
    problemId: string;
    passed?: boolean;
    iterations?: { count?: number; passedByIteration?: boolean[] };
    stages?: Array<{
      stage: string;
      passed: boolean;
      output?: string;
      testDetails?: Array<{ name?: string; status?: string }>;
    }>;
  }>;
};

type Failure = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string | undefined;
  stage: string;
  bucket: string;
  detail: string;
};

function normalizeProfile(p: string): string {
  if (p === "types-only") return "code-only";
  if (p === "full-package") return "code-and-docs";
  return p;
}

function walkReports(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(RESULTS_DIR)) return out;
  for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "artifacts" || entry.name === "experiments") continue;
    const sessionDir = path.join(RESULTS_DIR, entry.name);
    for (const f of fs.readdirSync(sessionDir)) {
      if (f.startsWith("report-") && f.endsWith(".json")) {
        out.push(path.join(sessionDir, f));
      }
    }
  }
  return out;
}

const TS_ERROR_REGEX = /\berror TS(\d+):\s*([^\n]+)/i;
const TSC_FILE_LOCATION = /([^\s(]+\.tsx?)\((\d+),(\d+)\):/;

function classifyTypecheck(output: string): { bucket: string; detail: string } {
  if (/^Skipped \(generate failed\)/.test(output.trim())) {
    return { bucket: "typecheck:upstream_skip", detail: "skipped because generate failed" };
  }
  if (/^Skipped/.test(output.trim())) {
    return { bucket: "typecheck:skipped_other", detail: output.trim().slice(0, 200) };
  }
  const match = output.match(TS_ERROR_REGEX);
  if (match) {
    const code = `TS${match[1]}`;
    const msg = (match[2] ?? "").trim().slice(0, 200);
    return { bucket: `typecheck:${code}`, detail: msg };
  }
  const fileMatch = output.match(TSC_FILE_LOCATION);
  if (fileMatch) {
    return { bucket: "typecheck:other", detail: `at ${fileMatch[0]}` };
  }
  return { bucket: "typecheck:other", detail: firstSignalLine(output).slice(0, 200) };
}

function classifyTests(output: string): { bucket: string; detail: string } {
  if (/^Skipped \(generate failed\)/.test(output.trim())) {
    return { bucket: "tests:upstream_skip", detail: "skipped because generate failed" };
  }
  if (/^Skipped \(typecheck failed\)/.test(output.trim())) {
    return { bucket: "tests:upstream_skip", detail: "skipped because typecheck failed" };
  }
  if (/^Skipped/.test(output.trim())) {
    return { bucket: "tests:skipped_other", detail: output.trim().slice(0, 200) };
  }
  let parsed: {
    testResults?: Array<{
      assertionResults?: Array<{
        status?: string;
        fullName?: string;
        title?: string;
        failureMessages?: string[];
      }>;
    }>;
  };
  try {
    parsed = JSON.parse(output);
  } catch {
    const head = firstSignalLine(output);
    return { bucket: "tests:unparseable", detail: head.slice(0, 200) };
  }
  const failedNames: string[] = [];
  const failureSnippets: string[] = [];
  for (const tr of parsed.testResults ?? []) {
    for (const ar of tr.assertionResults ?? []) {
      if (ar.status !== "failed") continue;
      if (ar.fullName) failedNames.push(ar.fullName);
      else if (ar.title) failedNames.push(ar.title);
      const msg = ar.failureMessages?.[0];
      if (msg) failureSnippets.push(msg.split("\n")[0]!.slice(0, 160));
    }
  }
  if (failedNames.length === 0) {
    return { bucket: "tests:unknown", detail: "no failed assertions extracted" };
  }
  const first = failedNames[0]!;
  const bucket = `tests:${first.split(/\s+/).slice(0, 8).join(" ")}`.slice(0, 90);
  const detail = failureSnippets[0] ?? first;
  return { bucket, detail: detail.slice(0, 200) };
}

const GENERATE_KNOWN_PATTERNS: Array<{ pattern: RegExp; bucket: string }> = [
  { pattern: /^Skipped \(infrastructure failure\)/, bucket: "generate:infra_failure" },
  { pattern: /^Skipped \(runner error/, bucket: "generate:runner_error" },
  { pattern: /^Skipped \(generate failed\)/, bucket: "generate:upstream_skip" },
  { pattern: /^Skipped /, bucket: "generate:skipped_other" },
  { pattern: /failed to parse config/i, bucket: "generate:config_parse" },
  {
    pattern: /TypeError: Cannot read properties of undefined/,
    bucket: "generate:undefined_access",
  },
  { pattern: /Failed to load type from /, bucket: "generate:type_load_fail" },
  { pattern: /unknown export/i, bucket: "generate:unknown_export" },
  { pattern: /plugin.+(?:missing|not found|cannot resolve)/i, bucket: "generate:plugin_missing" },
  { pattern: /codegen.+(?:crashed|panic|error)/i, bucket: "generate:codegen_crash" },
  { pattern: /An unexpected error occurred/i, bucket: "generate:unexpected_error" },
  { pattern: /timeout/i, bucket: "generate:timeout" },
];

const NOISE_LINE_PATTERNS: RegExp[] = [/^\(node:\d+\) \[DEP\d+\]/, /^\(Use `node --trace/, /^$/];

function isNoiseLine(line: string): boolean {
  return NOISE_LINE_PATTERNS.some((p) => p.test(line.trim()));
}

function firstSignalLine(output: string): string {
  for (const line of output.split("\n")) {
    if (!isNoiseLine(line)) return line.trim();
  }
  return output.trim().split("\n")[0] ?? "";
}

function classifyGenerate(output: string): { bucket: string; detail: string } {
  const signalLine = firstSignalLine(output);
  for (const { pattern, bucket } of GENERATE_KNOWN_PATTERNS) {
    if (pattern.test(signalLine) || pattern.test(output)) {
      const match =
        output.split("\n").find((l) => pattern.test(l) && !isNoiseLine(l)) ?? signalLine;
      return { bucket, detail: match.trim().slice(0, 200) };
    }
  }
  return { bucket: "generate:other", detail: signalLine.slice(0, 200) };
}

function classifyStage(
  stage: string,
  output: string,
): { bucket: string; detail: string } | undefined {
  if (!output) return undefined;
  switch (stage) {
    case "typecheck":
      return classifyTypecheck(output);
    case "tests":
      return classifyTests(output);
    case "generate":
      return classifyGenerate(output);
    default: {
      const head = output.trim().split("\n")[0] ?? "";
      return { bucket: `${stage}:other`, detail: head.slice(0, 200) };
    }
  }
}

function collectFailures(): { failures: Failure[]; mixedPassSkipped: number } {
  const out: Failure[] = [];
  let mixedPassSkipped = 0;
  for (const file of walkReports()) {
    let report: RawReport;
    try {
      report = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    const profile = normalizeProfile(report.contextProfile ?? "?");
    const sessionDir = path.basename(path.dirname(file));
    const sdkBranch = report.sdkBranch;
    for (const r of report.results ?? []) {
      const iters = r.iterations;
      const allItersPassed =
        iters?.passedByIteration && iters.passedByIteration.every(Boolean) === true;
      const hasItersWithFailure =
        iters?.passedByIteration && iters.passedByIteration.some((v) => v === false);
      // Skip groups where every iteration genuinely passed.
      if (allItersPassed) continue;
      // Single-iteration runs (no iterations aggregate): use top-level passed.
      if (!iters && r.passed === true) continue;
      // Mixed-pass groups (some iters failed): the runner's
      // `aggregateIterations` keeps only the "best" (passing) iter's stages,
      // so the per-iter failure detail is no longer in the report. Count
      // these so we know the taxonomy under-reports them and they need a
      // per-iter artifact walk to recover. The aggregate stages on these
      // groups all show passed=true so the inner loop emits nothing.
      if (hasItersWithFailure && r.passed === true) {
        mixedPassSkipped += iters!.passedByIteration!.filter((v) => v === false).length;
      }
      for (const stage of r.stages ?? []) {
        if (stage.passed) continue;
        const classified = classifyStage(stage.stage, stage.output ?? "");
        if (!classified) continue;
        out.push({
          sessionDir,
          problemId: r.problemId,
          profile,
          sdkBranch,
          stage: stage.stage,
          bucket: classified.bucket,
          detail: classified.detail,
        });
      }
    }
  }
  return { failures: out, mixedPassSkipped };
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "  -  ";
  return `${((num / denom) * 100).toFixed(0).padStart(3)}%`;
}

function formatTopModesPerProblem(failures: Failure[]): string {
  // group by (problem, profile, sdkBranch); within each, count buckets and show top 5
  type Key = string;
  const groups = new Map<Key, Failure[]>();
  for (const f of failures) {
    const k = `${f.problemId}|${f.profile}|${f.sdkBranch ?? "<baseline>"}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const lines: string[] = [];
  lines.push("## Top failure modes per (problem, profile, sdkBranch)");
  lines.push("");
  lines.push("| Problem | Profile | sdkBranch | Total | Top bucket (count) | Sample detail |");
  lines.push("| - | - | - | -: | - | - |");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const list = groups.get(k)!;
    const [pid, prof, br] = k.split("|");
    const counter = new Map<string, { count: number; sample: string }>();
    for (const f of list) {
      const cur = counter.get(f.bucket) ?? { count: 0, sample: f.detail };
      cur.count += 1;
      counter.set(f.bucket, cur);
    }
    const top = [...counter.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 1);
    for (const [bucket, { count, sample }] of top) {
      const safeDetail = sample.replace(/\|/g, "\\|").slice(0, 100);
      lines.push(
        `| ${pid} | ${prof} | ${br} | ${list.length} | \`${bucket}\` (${count}) | ${safeDetail} |`,
      );
    }
  }
  return lines.join("\n");
}

function formatBucketHistogram(failures: Failure[]): string {
  const counter = new Map<string, number>();
  for (const f of failures) counter.set(f.bucket, (counter.get(f.bucket) ?? 0) + 1);
  const lines: string[] = [];
  lines.push("## Failure-mode histogram (across all reports)");
  lines.push("");
  lines.push("| Bucket | Count | Share |");
  lines.push("| - | -: | -: |");
  const total = failures.length;
  for (const [k, n] of [...counter.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${n} | ${pct(n, total)} |`);
  }
  return lines.join("\n");
}

function writeCsv(failures: Failure[], outFile: string): void {
  const header = ["sessionDir", "problemId", "profile", "sdkBranch", "stage", "bucket", "detail"];
  const lines = [header.join(",")];
  for (const f of failures) {
    lines.push(
      [
        f.sessionDir,
        f.problemId,
        f.profile,
        f.sdkBranch ?? "",
        f.stage,
        f.bucket,
        JSON.stringify(f.detail),
      ].join(","),
    );
  }
  fs.writeFileSync(outFile, `${lines.join("\n")}\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  let csvOut: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--csv" && i + 1 < args.length) {
      csvOut = args[++i];
    }
  }
  const { failures, mixedPassSkipped } = collectFailures();
  const out: string[] = [];
  out.push("# Failure-mode taxonomy — corpus aggregate\n");
  out.push(`- failed stage instances classified: ${failures.length}`);
  const sessions = new Set(failures.map((f) => f.sessionDir));
  out.push(`- distinct sessions contributing: ${sessions.size}`);
  if (mixedPassSkipped > 0) {
    out.push(
      `- mixed-pass iters with unrecoverable failure detail: ${mixedPassSkipped} ` +
        "(runner's iteration aggregator keeps only the best iter's stages — " +
        "these need a per-iter artifact walk to bucket)",
    );
  }
  out.push("");
  out.push(formatTopModesPerProblem(failures));
  out.push("");
  out.push(formatBucketHistogram(failures));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (csvOut) {
    writeCsv(failures, csvOut);
    console.error(`# wrote ${failures.length} rows to ${csvOut}`);
  }
}

main();
