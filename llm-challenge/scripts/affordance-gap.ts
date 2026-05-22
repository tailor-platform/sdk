/**
 * One-off analysis: cross-tabulate test pass + first-hit (canonical) and
 * bias-attractor first-hit across every (problem, context profile, iteration)
 * already on disk under `llm-challenge/results/`.
 *
 * Output goes to stdout as Markdown. Pipe to a file when needed.
 *
 *   tsx llm-challenge/scripts/affordance-gap.ts
 *   tsx llm-challenge/scripts/affordance-gap.ts --csv rows.csv
 *
 * Reports use the `full` (unfiltered) and `no-docs` (JSDoc + README/docs/skills
 * stripped) profile labels. Legacy profile names (`code-only`, `code-and-docs`,
 * `bare-types`, `types-only`, `full-package`) are quarantined under
 * `results/_quarantine-legacy-profiles/` and not aggregated.
 */

import fs from "node:fs";
import path from "node:path";
import {
  classifyFirstBiasMiss,
  classifyFirstHit,
  type FirstBiasMissResult,
  type FirstHitResult,
} from "../core/metrics-first-hit";
import type { TraceEvent } from "../core/trace";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");
const PROBLEMS_DIR = path.join(LLM_CHALLENGE_ROOT, "problems");

type Meta = {
  id: string;
  designNote?: string;
  sdkSurface?: string;
  canonicalSymbols: string[];
  biasAttractors: string[];
};

type Row = {
  sessionDir: string;
  reportFile: string;
  problemId: string;
  profile: string;
  iter: number;
  passed: boolean | undefined;
  firstHit: FirstHitResult;
  biasMiss: FirstBiasMissResult;
  traceExists: boolean;
  /** `undefined` for baseline (current main); the ref name when run with --sdk-branch. */
  sdkBranch: string | undefined;
};

function loadAllMeta(): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const dir of fs.readdirSync(PROBLEMS_DIR)) {
    const metaPath = path.join(PROBLEMS_DIR, dir, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Partial<Meta>;
    if (!raw.id) continue;
    out.set(raw.id, {
      id: raw.id,
      designNote: raw.designNote,
      sdkSurface: raw.sdkSurface,
      canonicalSymbols: Array.isArray(raw.canonicalSymbols) ? raw.canonicalSymbols : [],
      biasAttractors: Array.isArray(raw.biasAttractors) ? raw.biasAttractors : [],
    });
  }
  return out;
}

function readTrace(file: string): TraceEvent[] {
  if (!fs.existsSync(file)) return [];
  const out: TraceEvent[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as TraceEvent);
    } catch {
      // skip
    }
  }
  return out;
}

function resolveArtifactBase(reportFile: string, originalDir: string, problemId: string): string {
  // Rebuild the artifact path against the *current* worktree root, ignoring
  // the absolute prefix baked into the report (the worktree may have moved
  // since the run was recorded).
  const idxArtifacts = originalDir.indexOf("/results/artifacts/");
  if (idxArtifacts === -1) return originalDir;
  const tail = originalDir.slice(idxArtifacts + "/results/artifacts/".length);
  // tail is one of:
  //   <sessionName>/<problemId>
  //   <sessionName>/iter-<N>/<problemId>
  // We always want the path up through <sessionName> (and optional iter-N).
  // Caller wraps with attempt-0 / trace.jsonl on top.
  return path.join(LLM_CHALLENGE_ROOT, "results", "artifacts", tail);
}

function buildRowsForReport(reportFile: string, metaIdx: Map<string, Meta>): Row[] {
  const report = JSON.parse(fs.readFileSync(reportFile, "utf-8")) as {
    contextProfile?: string;
    iterationCount?: number;
    sdkBranch?: string;
    results?: Array<{
      problemId: string;
      passed?: boolean;
      contextProfile?: string;
      artifacts?: { directory?: string };
      iterations?: { count?: number; passedByIteration?: boolean[] };
    }>;
  };
  const profile = report.contextProfile ?? "?";
  const sessionDir = path.basename(path.dirname(reportFile));
  const sdkBranch = report.sdkBranch;
  const rows: Row[] = [];
  for (const r of report.results ?? []) {
    const meta = metaIdx.get(r.problemId);
    if (!meta) continue; // skip problems lacking canonicalSymbols metadata
    const dir = r.artifacts?.directory;
    if (!dir) continue;
    const iterCount = r.iterations?.count ?? 1;
    const passedByIter = r.iterations?.passedByIteration;
    if (iterCount > 1 && passedByIter) {
      // Multi-iter: the recorded `artifacts.directory` ends with
      // `iter-0/<problemId>`. Walk up one level to get the session dir, then
      // synthesize iter-N paths.
      const rebuilt = resolveArtifactBase(reportFile, dir, r.problemId);
      const sessionRoot = path.dirname(path.dirname(rebuilt));
      for (let iter = 0; iter < iterCount; iter++) {
        const traceFile = path.join(
          sessionRoot,
          `iter-${iter}`,
          r.problemId,
          "attempt-0",
          "trace.jsonl",
        );
        const events = readTrace(traceFile);
        rows.push({
          sessionDir,
          reportFile,
          problemId: r.problemId,
          profile,
          iter,
          passed: passedByIter[iter],
          firstHit: classifyFirstHit(events, meta.canonicalSymbols),
          biasMiss: classifyFirstBiasMiss(events, meta.biasAttractors),
          traceExists: events.length > 0,
          sdkBranch,
        });
      }
    } else {
      const rebuilt = resolveArtifactBase(reportFile, dir, r.problemId);
      const traceFile = path.join(rebuilt, "attempt-0", "trace.jsonl");
      const events = readTrace(traceFile);
      rows.push({
        sessionDir,
        reportFile,
        problemId: r.problemId,
        profile,
        iter: 0,
        passed: r.passed,
        firstHit: classifyFirstHit(events, meta.canonicalSymbols),
        biasMiss: classifyFirstBiasMiss(events, meta.biasAttractors),
        traceExists: events.length > 0,
        sdkBranch,
      });
    }
  }
  return rows;
}

function walkReports(): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "artifacts" || entry.name === "experiments") continue;
    // Underscore-prefixed dirs (`_quarantine-*`) are operator-curated archives
    // of legacy / stale reports that must not contaminate aggregations.
    if (entry.name.startsWith("_")) continue;
    const sessionDir = path.join(RESULTS_DIR, entry.name);
    for (const f of fs.readdirSync(sessionDir)) {
      if (f.startsWith("report-") && f.endsWith(".json")) {
        out.push(path.join(sessionDir, f));
      }
    }
  }
  return out;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "  -  ";
  return `${((num / denom) * 100).toFixed(0).padStart(3)}%`;
}

function formatPerProblem(rows: Row[], metaIdx: Map<string, Meta>): string {
  // group by (sdkBranch, profile, problemId)
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.sdkBranch ?? "<baseline>"}|${r.profile}|${r.problemId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const profileOrder = ["no-docs", "full"];
  const profiles = [...new Set(rows.map((r) => r.profile))].sort(
    (a, b) => profileOrder.indexOf(a) - profileOrder.indexOf(b),
  );
  const problemIds = [...new Set(rows.map((r) => r.problemId))].sort();
  const branches = [...new Set(rows.map((r) => r.sdkBranch ?? "<baseline>"))].sort();
  const lines: string[] = [];
  lines.push("## Per-problem outcomes (per sdkBranch × profile)");
  lines.push("");
  lines.push(
    "| Problem | sdkBranch | Profile | Runs | Pass | Hit | Miss | NoGrep | BiasHit | designNote |",
  );
  lines.push("| - | - | - | -: | -: | -: | -: | -: | -: | - |");
  for (const pid of problemIds) {
    const meta = metaIdx.get(pid);
    for (const br of branches) {
      for (const prof of profiles) {
        const list = groups.get(`${br}|${prof}|${pid}`) ?? [];
        if (list.length === 0) continue;
        const passes = list.filter((x) => x.passed === true).length;
        const hits = list.filter((x) => x.firstHit.outcome === "hit").length;
        const misses = list.filter((x) => x.firstHit.outcome === "miss").length;
        const ng = list.filter((x) => x.firstHit.outcome === "no_grep").length;
        const bias = list.filter((x) => x.biasMiss.isBiasMiss).length;
        lines.push(
          `| ${pid} | ${br} | ${prof} | ${list.length} | ${pct(
            passes,
            list.length,
          )} (${passes}/${list.length}) | ${pct(hits, list.length)} | ${pct(
            misses,
            list.length,
          )} | ${pct(ng, list.length)} | ${pct(bias, list.length)} | ${meta?.designNote ?? "-"} |`,
        );
      }
    }
  }
  return lines.join("\n");
}

function formatPerDesignNote(rows: Row[], metaIdx: Map<string, Meta>): string {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const meta = metaIdx.get(r.problemId);
    const note = meta?.designNote ?? "(unset)";
    const key = `${r.profile} ${note}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const lines: string[] = [];
  lines.push("## Aggregate by designNote × profile");
  lines.push("");
  lines.push("| designNote | Profile | Runs | Pass | Hit | Miss | NoGrep | BiasHit |");
  lines.push("| - | - | -: | -: | -: | -: | -: | -: |");
  const sortedKeys = [...groups.keys()].sort();
  for (const k of sortedKeys) {
    const list = groups.get(k)!;
    const [profile, note] = k.split(" ");
    const passes = list.filter((x) => x.passed === true).length;
    const hits = list.filter((x) => x.firstHit.outcome === "hit").length;
    const misses = list.filter((x) => x.firstHit.outcome === "miss").length;
    const ng = list.filter((x) => x.firstHit.outcome === "no_grep").length;
    const bias = list.filter((x) => x.biasMiss.isBiasMiss).length;
    lines.push(
      `| ${note} | ${profile} | ${list.length} | ${pct(
        passes,
        list.length,
      )} | ${pct(hits, list.length)} | ${pct(misses, list.length)} | ${pct(
        ng,
        list.length,
      )} | ${pct(bias, list.length)} |`,
    );
  }
  return lines.join("\n");
}

function formatBiasAttractorHits(rows: Row[]): string {
  // What attractors are agents actually landing on, by problem and sdkBranch?
  // "Strict" hits = the agent typed the attractor's full name (the real
  // affordance signal). "Prefix" hits = a probe like `defineStatic` that
  // matches both the canonical and the attractor and so doesn't tell us
  // which one the agent had in mind.
  type Key = string; // `${problemId}|${sdkBranch}`
  type Stats = {
    strict: number;
    prefix: number;
    strictPassed: number;
    prefixPassed: number;
  };
  const map = new Map<Key, Map<string, Stats>>();
  const totals = new Map<Key, number>();
  for (const r of rows) {
    const k: Key = `${r.problemId}|${r.sdkBranch ?? "<baseline>"}`;
    totals.set(k, (totals.get(k) ?? 0) + 1);
    if (!r.biasMiss.isBiasMiss) continue;
    const a = r.biasMiss.matchedAttractor ?? "?";
    if (!map.has(k)) map.set(k, new Map());
    const inner = map.get(k)!;
    const cur = inner.get(a) ?? {
      strict: 0,
      prefix: 0,
      strictPassed: 0,
      prefixPassed: 0,
    };
    if (r.biasMiss.strictness === "strict") {
      cur.strict += 1;
      if (r.passed === true) cur.strictPassed += 1;
    } else {
      cur.prefix += 1;
      if (r.passed === true) cur.prefixPassed += 1;
    }
    inner.set(a, cur);
  }
  const lines: string[] = [];
  lines.push("## Bias-attractor first-hits (per sdkBranch, strict vs prefix)");
  lines.push("");
  if (map.size === 0) {
    lines.push("_(no bias-attractor hits recorded across the corpus)_");
    return lines.join("\n");
  }
  lines.push(
    "| Problem | sdkBranch | Runs | Attractor | StrictHits | StrictPass | PrefixHits | PrefixPass | TotalShare |",
  );
  lines.push("| - | - | -: | - | -: | -: | -: | -: | -: |");
  const sortedKeys = [...map.keys()].sort();
  for (const k of sortedKeys) {
    const inner = map.get(k)!;
    const [pid, br] = k.split("|");
    const total = totals.get(k) ?? 0;
    const items = [...inner.entries()].sort(
      (a, b) => b[1].strict + b[1].prefix - (a[1].strict + a[1].prefix),
    );
    for (const [att, s] of items) {
      const totalHits = s.strict + s.prefix;
      lines.push(
        `| ${pid} | ${br} | ${total} | \`${att}\` | ${s.strict} | ${
          s.strictPassed
        }/${s.strict || 0} | ${s.prefix} | ${s.prefixPassed}/${
          s.prefix || 0
        } | ${pct(totalHits, total)} |`,
      );
    }
  }
  return lines.join("\n");
}

function formatMissPatterns(rows: Row[]): string {
  // What patterns did agents type when they missed canonical? (top by frequency)
  const counter = new Map<string, number>();
  for (const r of rows) {
    if (r.firstHit.outcome !== "miss") continue;
    const p = r.firstHit.pattern ?? "?";
    counter.set(p, (counter.get(p) ?? 0) + 1);
  }
  const top = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const lines: string[] = [];
  lines.push("## Top first-grep patterns that missed canonical");
  lines.push("");
  if (top.length === 0) {
    lines.push("_(no misses)_");
    return lines.join("\n");
  }
  lines.push("| Pattern | Hits |");
  lines.push("| - | -: |");
  for (const [p, n] of top) lines.push(`| \`${p.replace(/\|/g, "\\|")}\` | ${n} |`);
  return lines.join("\n");
}

function formatHeader(rows: Row[]): string {
  const traceless = rows.filter((r) => !r.traceExists).length;
  const total = rows.length;
  const lines: string[] = [];
  lines.push("# Affordance Gap — corpus aggregate");
  lines.push("");
  lines.push(`- rows: ${total}`);
  lines.push(`- with trace: ${total - traceless}`);
  lines.push(`- without trace (older runs): ${traceless}`);
  lines.push("");
  return lines.join("\n");
}

function writeCsv(rows: Row[], outFile: string): void {
  const header = [
    "sessionDir",
    "problemId",
    "profile",
    "sdkBranch",
    "iter",
    "passed",
    "first_hit_outcome",
    "first_hit_pattern",
    "first_hit_matched",
    "first_hit_strictness",
    "bias_hit",
    "bias_attractor",
    "bias_strictness",
    "trace_exists",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.sessionDir,
      r.problemId,
      r.profile,
      r.sdkBranch ?? "",
      String(r.iter),
      r.passed === undefined ? "" : String(r.passed),
      r.firstHit.outcome,
      JSON.stringify(r.firstHit.pattern ?? ""),
      r.firstHit.matchedSymbol ?? "",
      r.firstHit.strictness ?? "",
      String(r.biasMiss.isBiasMiss),
      r.biasMiss.matchedAttractor ?? "",
      r.biasMiss.strictness ?? "",
      String(r.traceExists),
    ];
    lines.push(cells.join(","));
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

  const metaIdx = loadAllMeta();
  const reports = walkReports();
  const allRows: Row[] = [];
  for (const reportFile of reports) {
    try {
      allRows.push(...buildRowsForReport(reportFile, metaIdx));
    } catch (err) {
      console.error(`# skip ${reportFile}: ${(err as Error).message}`);
    }
  }

  // Filter to rows for problems that have canonicalSymbols populated.
  const usable = allRows.filter((r) => {
    const m = metaIdx.get(r.problemId);
    return !!m && m.canonicalSymbols.length > 0;
  });

  const out: string[] = [];
  out.push(formatHeader(usable));
  out.push(formatPerProblem(usable, metaIdx));
  out.push("");
  out.push(formatPerDesignNote(usable, metaIdx));
  out.push("");
  out.push(formatBiasAttractorHits(usable));
  out.push("");
  out.push(formatMissPatterns(usable));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);

  if (csvOut) {
    writeCsv(usable, csvOut);
    console.error(`# wrote ${usable.length} rows to ${csvOut}`);
  }
}

main();
