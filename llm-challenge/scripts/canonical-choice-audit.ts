/**
 * Walk every iteration's `work/` tree and audit which canonical symbols the
 * final solution actually called, vs. which bias attractors it called instead.
 * Complements `call-shape-audit.ts`: that script grades calls to symbols it
 * sees, this one reports calls the agent SHOULD have made but didn't (missing
 * canonicals) and calls it SHOULDN'T have made but did (bias attractors).
 *
 * Output: markdown to stdout; `--csv <file>` also writes a per-(problem, iter)
 * CSV with one row per audited iteration. `--problem <id>` narrows the audit.
 *
 *   tsx llm-challenge/scripts/canonical-choice-audit.ts
 *   tsx llm-challenge/scripts/canonical-choice-audit.ts --csv canonical-choice.csv
 *   tsx llm-challenge/scripts/canonical-choice-audit.ts --problem m19-plugins-define-plugins-rest
 *
 * Reuses the existing `meta.json` `canonicalSymbols` (treated as "expected to
 * appear in the final solution") and `biasAttractors` (treated as "must not
 * appear"). No new meta schema. Method-form attractors like `db.aggregate`
 * are matched on their last `.<member>` segment, so `db.aggregate(...)` and
 * `tailor.db.aggregate(...)` both trigger the attractor. This loses specificity
 * but matches how the v1 author corpus is shaped.
 */

import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");
const PROBLEMS_DIR = path.join(LLM_CHALLENGE_ROOT, "problems");

type Meta = {
  id: string;
  canonicalSymbols: string[];
  biasAttractors: string[];
};

type IterObservation = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string | undefined;
  iter: number;
  /** Canonical symbols from meta.json that were called somewhere in work/. */
  canonicalsHit: string[];
  /** Canonical symbols from meta.json that were NOT called. */
  canonicalsMissed: string[];
  /** Bias attractors that the agent ended up calling. */
  attractorsHit: string[];
  /** Whether the work/ snapshot existed at all. */
  workTreeFound: boolean;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  ".next",
  "generated",
]);

function loadAllMeta(): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const dir of fs.readdirSync(PROBLEMS_DIR)) {
    const metaPath = path.join(PROBLEMS_DIR, dir, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    let raw: Partial<Meta>;
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Partial<Meta>;
    } catch {
      continue;
    }
    if (!raw.id) continue;
    const canonicalSymbols = Array.isArray(raw.canonicalSymbols) ? raw.canonicalSymbols : [];
    const biasAttractors = Array.isArray(raw.biasAttractors) ? raw.biasAttractors : [];
    if (canonicalSymbols.length === 0 && biasAttractors.length === 0) continue;
    out.set(raw.id, { id: raw.id, canonicalSymbols, biasAttractors });
  }
  return out;
}

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(path.join(dir, ent.name));
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name.endsWith(".d.ts")) continue;
      if (!ent.name.endsWith(".ts") && !ent.name.endsWith(".tsx")) continue;
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

type AstNode = { type: string; [k: string]: unknown };

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function walkAst(node: unknown, visit: (n: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  if (!isAstNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "range" || key === "start" || key === "end") {
      continue;
    }
    walkAst((node as Record<string, unknown>)[key], visit);
  }
}

/**
 * Two views of a CallExpression callee:
 *
 * - `identifier`: bare `name(args)` — returns just `"name"`.
 * - `member`: `obj.prop(args)` or deeper — returns `".prop"` (the last segment).
 *
 * The two forms are kept separate so the matcher can decide whether a
 * meta entry like `definePlugins` (bare) or `db.aggregate` (member) is in
 * scope. Optional chaining is treated like a regular member access.
 */
function callShape(call: AstNode): { kind: "identifier" | "member"; name: string } | undefined {
  const callee = call.callee as AstNode | undefined;
  if (!callee) return undefined;
  if (callee.type === "Identifier") {
    const name = (callee as AstNode & { name?: string }).name;
    if (typeof name === "string") return { kind: "identifier", name };
    return undefined;
  }
  if (
    callee.type === "StaticMemberExpression" ||
    callee.type === "MemberExpression" ||
    callee.type === "ChainExpression"
  ) {
    // ChainExpression wraps an optional member; unwrap one level.
    const inner =
      callee.type === "ChainExpression"
        ? ((callee as AstNode & { expression?: AstNode }).expression ?? callee)
        : callee;
    const prop = (inner as AstNode & { property?: AstNode }).property;
    if (prop && prop.type === "Identifier") {
      const name = (prop as AstNode & { name?: string }).name;
      if (typeof name === "string") return { kind: "member", name: `.${name}` };
    }
  }
  return undefined;
}

/**
 * Normalise a meta symbol entry into the form `callShape` returns. Entries
 * without a `.` are identifier matches; entries with a `.` are reduced to the
 * last `.<member>` segment.
 *
 * Some attractor entries carry a trailing `(` (e.g. `"executor("`) to express
 * "called as a factory" — strip non-identifier suffix characters so the lookup
 * key matches the bare identifier name we collect from the AST.
 */
function normaliseMetaSymbol(symbol: string): { kind: "identifier" | "member"; name: string } {
  const trimmed = symbol.replace(/[^\w.].*$/, "");
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot === -1) return { kind: "identifier", name: trimmed };
  return { kind: "member", name: `.${trimmed.slice(lastDot + 1)}` };
}

function collectCalledSymbols(workRoot: string): Set<string> {
  const out = new Set<string>();
  const files = walkTsFiles(workRoot);
  for (const file of files) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    let parsed: ReturnType<typeof parseSync>;
    try {
      parsed = parseSync(file, source, { sourceType: "module" });
    } catch {
      continue;
    }
    walkAst(parsed.program, (node) => {
      if (node.type !== "CallExpression") return;
      const shape = callShape(node);
      if (!shape) return;
      // Identifier shapes store the bare name (`definePlugins`); member shapes
      // store `.<lastSegment>` (`.aggregate`). The two ranges are disjoint
      // because identifier names never start with `.`, so a single Set is safe.
      out.add(shape.name);
    });
  }
  return out;
}

function classifyIter(
  workRoot: string,
  meta: Meta,
): Omit<IterObservation, "sessionDir" | "problemId" | "profile" | "sdkBranch" | "iter"> {
  if (!fs.existsSync(workRoot)) {
    // Iter that never produced source (infra failure / cleaned work tree) is
    // not evidence the agent chose a wrong canonical. Leave the per-symbol
    // arrays empty so it does not pollute TopMissed / TopAttractors counters
    // downstream; `workTreeFound: false` keeps the row available for filtering.
    return {
      canonicalsHit: [],
      canonicalsMissed: [],
      attractorsHit: [],
      workTreeFound: false,
    };
  }
  const called = collectCalledSymbols(workRoot);
  const canonicalsHit: string[] = [];
  const canonicalsMissed: string[] = [];
  for (const symbol of meta.canonicalSymbols) {
    const norm = normaliseMetaSymbol(symbol);
    if (called.has(norm.name)) canonicalsHit.push(symbol);
    else canonicalsMissed.push(symbol);
  }
  const attractorsHit: string[] = [];
  for (const symbol of meta.biasAttractors) {
    const norm = normaliseMetaSymbol(symbol);
    if (called.has(norm.name)) attractorsHit.push(symbol);
  }
  return { canonicalsHit, canonicalsMissed, attractorsHit, workTreeFound: true };
}

function resolveArtifactBase(reportFile: string, originalDir: string): string {
  const idxArtifacts = originalDir.indexOf("/results/artifacts/");
  if (idxArtifacts === -1) return originalDir;
  const tail = originalDir.slice(idxArtifacts + "/results/artifacts/".length);
  return path.join(LLM_CHALLENGE_ROOT, "results", "artifacts", tail);
}

function walkReports(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(RESULTS_DIR)) return out;
  for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "artifacts" || entry.name === "experiments") continue;
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

function collectObservations(
  metaIdx: Map<string, Meta>,
  problemFilter: string | undefined,
): IterObservation[] {
  const out: IterObservation[] = [];
  for (const reportFile of walkReports()) {
    let report: {
      contextProfile?: string;
      sdkBranch?: string;
      results?: Array<{
        problemId: string;
        artifacts?: { directory?: string };
        iterations?: { count?: number };
      }>;
    };
    try {
      report = JSON.parse(fs.readFileSync(reportFile, "utf-8"));
    } catch {
      continue;
    }
    const profile = report.contextProfile ?? "?";
    const sessionDir = path.basename(path.dirname(reportFile));
    const sdkBranch = report.sdkBranch;
    for (const r of report.results ?? []) {
      if (problemFilter && r.problemId !== problemFilter) continue;
      const meta = metaIdx.get(r.problemId);
      if (!meta) continue;
      const dir = r.artifacts?.directory;
      if (!dir) continue;
      const rebuilt = resolveArtifactBase(reportFile, dir);
      const iterCount = r.iterations?.count ?? 1;
      if (iterCount > 1) {
        const sessionRoot = path.dirname(path.dirname(rebuilt));
        for (let iter = 0; iter < iterCount; iter++) {
          const workRoot = path.join(sessionRoot, `iter-${iter}`, r.problemId, "attempt-0", "work");
          out.push({
            sessionDir,
            problemId: r.problemId,
            profile,
            sdkBranch,
            iter,
            ...classifyIter(workRoot, meta),
          });
        }
      } else {
        const workRoot = path.join(rebuilt, "attempt-0", "work");
        out.push({
          sessionDir,
          problemId: r.problemId,
          profile,
          sdkBranch,
          iter: 0,
          ...classifyIter(workRoot, meta),
        });
      }
    }
  }
  return out;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "  -  ";
  return `${((num / denom) * 100).toFixed(0).padStart(3)}%`;
}

function topN(counter: Map<string, number>, n: number): string {
  const entries = [...counter.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "-";
  return entries
    .slice(0, n)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
}

function formatGroupSummary(rows: IterObservation[], metaIdx: Map<string, Meta>): string {
  type Key = string; // `${problemId}|${profile}|${sdkBranch}`
  const groups = new Map<Key, IterObservation[]>();
  for (const r of rows) {
    const key = `${r.problemId}|${r.profile}|${r.sdkBranch ?? "<baseline>"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const lines: string[] = [];
  lines.push("## Canonical choice — per (problem, profile, sdkBranch)");
  lines.push("");
  lines.push(
    "| Problem | Profile | sdkBranch | ItersWithWork | AllCanonicalsHit | AnyAttractorHit | TopMissed | TopAttractors |",
  );
  lines.push("| - | - | - | -: | -: | -: | - | - |");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const list = groups.get(k)!;
    const [pid, prof, br] = k.split("|");
    const meta = metaIdx.get(pid!);
    const totalCanon = meta?.canonicalSymbols.length ?? 0;
    // Denominator is iters whose `work/` snapshot survived — infra failures
    // carry no canonical-choice signal and would otherwise drag every column
    // toward zero.
    const validIters = list.filter((x) => x.workTreeFound);
    const denom = validIters.length;
    const allHit = validIters.filter(
      (x) => x.canonicalsMissed.length === 0 && totalCanon > 0,
    ).length;
    const anyAttractor = validIters.filter((x) => x.attractorsHit.length > 0).length;
    const missedCounter = new Map<string, number>();
    const attractorCounter = new Map<string, number>();
    for (const x of validIters) {
      for (const m of x.canonicalsMissed) missedCounter.set(m, (missedCounter.get(m) ?? 0) + 1);
      for (const a of x.attractorsHit) attractorCounter.set(a, (attractorCounter.get(a) ?? 0) + 1);
    }
    lines.push(
      `| ${pid} | ${prof} | ${br} | ${denom} | ${pct(allHit, denom)} (${allHit}/${denom}) | ${pct(
        anyAttractor,
        denom,
      )} (${anyAttractor}/${denom}) | ${topN(missedCounter, 3)} | ${topN(attractorCounter, 3)} |`,
    );
  }
  return lines.join("\n");
}

function formatPerIter(rows: IterObservation[]): string {
  const lines: string[] = [];
  lines.push("## Per-iteration detail (only iters with miss/attractor)");
  lines.push("");
  lines.push("| Problem | Profile | sdkBranch | Iter | Missed canonicals | Bias hits |");
  lines.push("| - | - | - | -: | - | - |");
  const interesting = rows
    .filter((r) => r.canonicalsMissed.length > 0 || r.attractorsHit.length > 0)
    .sort(
      (a, b) =>
        a.problemId.localeCompare(b.problemId) ||
        a.profile.localeCompare(b.profile) ||
        a.iter - b.iter,
    );
  for (const r of interesting) {
    lines.push(
      `| ${r.problemId} | ${r.profile} | ${r.sdkBranch ?? "<baseline>"} | ${r.iter} | ${
        r.canonicalsMissed.join(", ") || "-"
      } | ${r.attractorsHit.join(", ") || "-"} |`,
    );
  }
  return lines.join("\n");
}

function writeCsv(rows: IterObservation[], outFile: string): void {
  const header = [
    "sessionDir",
    "problemId",
    "profile",
    "sdkBranch",
    "iter",
    "workTreeFound",
    "canonicalsHit",
    "canonicalsMissed",
    "attractorsHit",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.sessionDir,
      r.problemId,
      r.profile,
      r.sdkBranch ?? "",
      String(r.iter),
      String(r.workTreeFound),
      JSON.stringify(r.canonicalsHit.join("|")),
      JSON.stringify(r.canonicalsMissed.join("|")),
      JSON.stringify(r.attractorsHit.join("|")),
    ];
    lines.push(cells.join(","));
  }
  fs.writeFileSync(outFile, `${lines.join("\n")}\n`);
}

function parseArgs(): { csvOut: string | undefined; problem: string | undefined } {
  const args = process.argv.slice(2);
  let csvOut: string | undefined;
  let problem: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--csv" && i + 1 < args.length) {
      csvOut = args[++i];
    } else if (args[i] === "--problem" && i + 1 < args.length) {
      problem = args[++i];
    }
  }
  return { csvOut, problem };
}

function main(): void {
  const { csvOut, problem } = parseArgs();
  const metaIdx = loadAllMeta();
  if (metaIdx.size === 0) {
    console.error(
      "No problems with canonicalSymbols/biasAttractors found. Populate meta.json first.",
    );
    process.exit(2);
  }
  const observations = collectObservations(metaIdx, problem);
  const out: string[] = [];
  out.push("# Canonical-choice audit — corpus aggregate\n");
  out.push(`- problems with canonical/attractor metadata: ${metaIdx.size}`);
  out.push(`- iterations audited: ${observations.length}`);
  if (problem) out.push(`- filtered to problem: ${problem}`);
  out.push("");
  out.push(formatGroupSummary(observations, metaIdx));
  out.push("");
  out.push(formatPerIter(observations));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (csvOut) {
    writeCsv(observations, csvOut);
    console.error(`# wrote ${observations.length} rows to ${csvOut}`);
  }
}

main();
