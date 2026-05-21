/**
 * Walk every iteration's `work/` tree and audit each call to a canonical
 * SDK symbol against the per-problem `expectedCallShapes` declared in
 * `meta.json`. Output goes to stdout as Markdown; pass `--csv <file>` to
 * also emit the per-call CSV.
 *
 *   tsx llm-challenge/scripts/call-shape-audit.ts
 *   tsx llm-challenge/scripts/call-shape-audit.ts --csv call-shape-rows.csv
 *
 * The audit only grades calls whose callee is a bare identifier matching
 * a canonical symbol; method-call canonicals (entries starting with `.`)
 * are not graded yet because their receiver shape carries information
 * the audit does not currently model.
 */

import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");
const PROBLEMS_DIR = path.join(LLM_CHALLENGE_ROOT, "problems");

type ExpectedCallShape = {
  positionalArity: number | "rest";
  configArgIndex?: number;
  configKeys?: string[];
};

type Meta = {
  id: string;
  canonicalSymbols: string[];
  expectedCallShapes: Record<string, ExpectedCallShape>;
};

type CallObservation = {
  sessionDir: string;
  problemId: string;
  profile: string;
  iter: number;
  sdkBranch: string | undefined;
  symbol: string;
  file: string;
  argCount: number;
  configKeys: string[] | undefined;
  configKeysSource: "object_literal" | "non_object" | "missing";
  arityMatch: boolean;
  missingKeys: string[];
};

function loadAllMeta(): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const dir of fs.readdirSync(PROBLEMS_DIR)) {
    const metaPath = path.join(PROBLEMS_DIR, dir, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
      id?: string;
      canonicalSymbols?: string[];
      expectedCallShapes?: Record<string, ExpectedCallShape>;
    };
    if (!raw.id) continue;
    if (!raw.expectedCallShapes) continue;
    out.set(raw.id, {
      id: raw.id,
      canonicalSymbols: raw.canonicalSymbols ?? [],
      expectedCallShapes: raw.expectedCallShapes,
    });
  }
  return out;
}

function normalizeProfile(p: string): string {
  if (p === "types-only") return "code-only";
  if (p === "full-package") return "code-and-docs";
  return p;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  ".next",
  "generated",
]);

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

function getCalleeName(call: AstNode): { kind: "identifier" | "member"; name: string } | undefined {
  const callee = call.callee as AstNode | undefined;
  if (!callee) return undefined;
  if (callee.type === "Identifier") {
    const name = (callee as AstNode & { name?: string }).name;
    if (typeof name === "string") return { kind: "identifier", name };
  }
  if (callee.type === "StaticMemberExpression" || callee.type === "MemberExpression") {
    const prop = (callee as AstNode & { property?: AstNode }).property;
    if (prop && prop.type === "Identifier") {
      const name = (prop as AstNode & { name?: string }).name;
      if (typeof name === "string") return { kind: "member", name: `.${name}` };
    }
  }
  return undefined;
}

function extractObjectKeys(arg: AstNode | undefined): string[] | undefined {
  if (!arg) return undefined;
  if (arg.type !== "ObjectExpression") return undefined;
  const properties = (arg as AstNode & { properties?: AstNode[] }).properties ?? [];
  const out: string[] = [];
  for (const p of properties) {
    if (p.type !== "Property" && p.type !== "ObjectProperty") continue;
    const key = (p as AstNode & { key?: AstNode }).key;
    if (!key) continue;
    if (key.type === "Identifier") {
      const name = (key as AstNode & { name?: string }).name;
      if (typeof name === "string") out.push(name);
    } else if (key.type === "Literal" || key.type === "StringLiteral") {
      const value = (key as AstNode & { value?: unknown }).value;
      if (typeof value === "string") out.push(value);
    }
  }
  return out;
}

function auditFile(
  filePath: string,
  rootForRelative: string,
  expected: Record<string, ExpectedCallShape>,
): Omit<CallObservation, "sessionDir" | "problemId" | "profile" | "iter" | "sdkBranch">[] {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(filePath, source, { sourceType: "module" });
  } catch {
    return [];
  }
  const observations: Omit<
    CallObservation,
    "sessionDir" | "problemId" | "profile" | "iter" | "sdkBranch"
  >[] = [];
  const relFile = path.relative(rootForRelative, filePath) || filePath;
  walkAst(parsed.program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = getCalleeName(node);
    if (!callee) return;
    const shape = expected[callee.name];
    if (!shape) return;
    const args = (node as AstNode & { arguments?: AstNode[] }).arguments ?? [];
    const argCount = args.length;
    const arityMatch = shape.positionalArity === "rest" ? true : argCount === shape.positionalArity;
    const configArgIndex = shape.configArgIndex ?? 0;
    let configKeysSource: CallObservation["configKeysSource"] = "missing";
    let configKeys: string[] | undefined;
    let missingKeys: string[] = [];
    if (shape.configKeys && shape.configKeys.length > 0) {
      const arg = args[configArgIndex];
      if (arg && arg.type === "ObjectExpression") {
        configKeysSource = "object_literal";
        configKeys = extractObjectKeys(arg) ?? [];
        const have = new Set(configKeys);
        missingKeys = shape.configKeys.filter((k) => !have.has(k));
      } else if (arg) {
        configKeysSource = "non_object";
        missingKeys = [...shape.configKeys];
      } else {
        configKeysSource = "missing";
        missingKeys = [...shape.configKeys];
      }
    }
    observations.push({
      symbol: callee.name,
      file: relFile,
      argCount,
      configKeys,
      configKeysSource,
      arityMatch,
      missingKeys,
    });
  });
  return observations;
}

function resolveArtifactBase(reportFile: string, originalDir: string): string {
  const idxArtifacts = originalDir.indexOf("/results/artifacts/");
  if (idxArtifacts === -1) return originalDir;
  const tail = originalDir.slice(idxArtifacts + "/results/artifacts/".length);
  return path.join(LLM_CHALLENGE_ROOT, "results", "artifacts", tail);
}

function walkReports(): string[] {
  const out: string[] = [];
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

function collectObservations(metaIdx: Map<string, Meta>): CallObservation[] {
  const out: CallObservation[] = [];
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
    const profile = normalizeProfile(report.contextProfile ?? "?");
    const sessionDir = path.basename(path.dirname(reportFile));
    const sdkBranch = report.sdkBranch;
    for (const r of report.results ?? []) {
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
          out.push(...auditWorkRoot(workRoot, meta, sessionDir, profile, iter, sdkBranch));
        }
      } else {
        const workRoot = path.join(rebuilt, "attempt-0", "work");
        out.push(...auditWorkRoot(workRoot, meta, sessionDir, profile, 0, sdkBranch));
      }
    }
  }
  return out;
}

function auditWorkRoot(
  workRoot: string,
  meta: Meta,
  sessionDir: string,
  profile: string,
  iter: number,
  sdkBranch: string | undefined,
): CallObservation[] {
  const out: CallObservation[] = [];
  if (!fs.existsSync(workRoot)) return out;
  const files = walkTsFiles(workRoot);
  for (const f of files) {
    const obs = auditFile(f, workRoot, meta.expectedCallShapes);
    for (const o of obs) {
      out.push({
        sessionDir,
        problemId: meta.id,
        profile,
        iter,
        sdkBranch,
        ...o,
      });
    }
  }
  return out;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "  -  ";
  return `${((num / denom) * 100).toFixed(0).padStart(3)}%`;
}

function formatPerSymbol(rows: CallObservation[], metaIdx: Map<string, Meta>): string {
  type Key = string; // `${problemId}|${profile}|${sdkBranch}|${symbol}`
  const groups = new Map<Key, CallObservation[]>();
  for (const r of rows) {
    const key = `${r.problemId}|${r.profile}|${r.sdkBranch ?? "<baseline>"}|${r.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const lines: string[] = [];
  lines.push("## Use-correctness per (problem, profile, symbol)");
  lines.push("");
  lines.push(
    "| Problem | Profile | sdkBranch | Symbol | Calls | ArityOK | ConfigKeysOK | TopMissingKeys |",
  );
  lines.push("| - | - | - | - | -: | -: | -: | - |");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const list = groups.get(k)!;
    const [pid, prof, br, sym] = k.split("|");
    const arityOk = list.filter((x) => x.arityMatch).length;
    const expectedShape = metaIdx.get(pid!)?.expectedCallShapes[sym!];
    const hasConfigKeys = !!expectedShape?.configKeys && expectedShape.configKeys.length > 0;
    const configOk = hasConfigKeys
      ? list.filter((x) => x.missingKeys.length === 0).length
      : list.length;
    const missingCounter = new Map<string, number>();
    for (const x of list) {
      for (const m of x.missingKeys) missingCounter.set(m, (missingCounter.get(m) ?? 0) + 1);
    }
    const topMissing = [...missingCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    lines.push(
      `| ${pid} | ${prof} | ${br} | ${sym} | ${list.length} | ${pct(arityOk, list.length)} (${arityOk}/${list.length}) | ${hasConfigKeys ? `${pct(configOk, list.length)} (${configOk}/${list.length})` : "n/a"} | ${topMissing || "-"} |`,
    );
  }
  return lines.join("\n");
}

function formatPerProblemIterSummary(rows: CallObservation[], metaIdx: Map<string, Meta>): string {
  // For each (problem, profile, sdkBranch, iter): did the iter make all
  // canonical calls correctly?
  type IterKey = string; // `${problemId}|${profile}|${sdkBranch}|${iter}`
  type IterAgg = {
    iters: Set<number>;
    itersAllCorrect: Set<number>;
    itersWithAnyCall: Set<number>;
  };
  type GroupKey = string; // `${problemId}|${profile}|${sdkBranch}`
  const seen = new Map<IterKey, { allCorrect: boolean; sawCall: boolean }>();
  for (const r of rows) {
    const ikey = `${r.problemId}|${r.profile}|${r.sdkBranch ?? "<baseline>"}|${r.iter}`;
    const cur = seen.get(ikey) ?? { allCorrect: true, sawCall: false };
    cur.sawCall = true;
    if (!r.arityMatch || r.missingKeys.length > 0) cur.allCorrect = false;
    seen.set(ikey, cur);
  }
  const groups = new Map<GroupKey, IterAgg>();
  for (const [ikey, v] of seen) {
    const parts = ikey.split("|");
    const iter = Number(parts[parts.length - 1]);
    const gkey = parts.slice(0, -1).join("|");
    const cur = groups.get(gkey) ?? {
      iters: new Set(),
      itersAllCorrect: new Set(),
      itersWithAnyCall: new Set(),
    };
    cur.iters.add(iter);
    if (v.sawCall) cur.itersWithAnyCall.add(iter);
    if (v.allCorrect && v.sawCall) cur.itersAllCorrect.add(iter);
    groups.set(gkey, cur);
  }
  const lines: string[] = [];
  lines.push("## Per-iteration roll-up (all canonical calls correct?)");
  lines.push("");
  lines.push("| Problem | Profile | sdkBranch | ItersWithCalls | AllCorrect | Pct |");
  lines.push("| - | - | - | -: | -: | -: |");
  for (const gkey of [...groups.keys()].sort()) {
    const agg = groups.get(gkey)!;
    const [pid, prof, br] = gkey.split("|");
    const total = agg.itersWithAnyCall.size;
    const ok = agg.itersAllCorrect.size;
    lines.push(`| ${pid} | ${prof} | ${br} | ${total} | ${ok} | ${pct(ok, total)} |`);
  }
  // touch metaIdx to keep the symbol available for future extension
  void metaIdx;
  return lines.join("\n");
}

function writeCsv(rows: CallObservation[], outFile: string): void {
  const header = [
    "sessionDir",
    "problemId",
    "profile",
    "sdkBranch",
    "iter",
    "symbol",
    "file",
    "argCount",
    "configKeysSource",
    "configKeys",
    "arityMatch",
    "missingKeys",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.sessionDir,
      r.problemId,
      r.profile,
      r.sdkBranch ?? "",
      String(r.iter),
      r.symbol,
      JSON.stringify(r.file),
      String(r.argCount),
      r.configKeysSource,
      JSON.stringify((r.configKeys ?? []).join("|")),
      String(r.arityMatch),
      JSON.stringify(r.missingKeys.join("|")),
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
  if (metaIdx.size === 0) {
    console.error("No problems with expectedCallShapes found. Add the field to meta.json first.");
    process.exit(2);
  }
  const observations = collectObservations(metaIdx);
  const out: string[] = [];
  out.push("# Call-shape audit — corpus aggregate\n");
  out.push(`- problems audited: ${metaIdx.size}`);
  out.push(`- canonical-symbol calls observed: ${observations.length}`);
  out.push("");
  out.push(formatPerSymbol(observations, metaIdx));
  out.push("");
  out.push(formatPerProblemIterSummary(observations, metaIdx));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (csvOut) {
    writeCsv(observations, csvOut);
    console.error(`# wrote ${observations.length} rows to ${csvOut}`);
  }
}

main();
