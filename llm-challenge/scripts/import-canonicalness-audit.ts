/**
 * Walk every iteration's `work/` tree and audit each `@tailor-platform/*`
 * import for shape compliance. Complements `core/metrics-canonicalness.ts`
 * (regex-based, aggregate-only) by emitting per-import detail with AST-level
 * accuracy — aliased re-exports (`import { createExecutor as defineExecutor }`)
 * and internal-path reach-throughs (`@tailor-platform/sdk/dist/...`) are
 * surfaced explicitly per iteration.
 *
 * Output: markdown to stdout; `--csv <file>` also writes one row per import
 * statement. `--problem <id>` narrows the audit.
 *
 *   tsx llm-challenge/scripts/import-canonicalness-audit.ts
 *   tsx llm-challenge/scripts/import-canonicalness-audit.ts --csv import-canon.csv
 *   tsx llm-challenge/scripts/import-canonicalness-audit.ts --problem m19-plugins-define-plugins-rest
 *
 * Classification (first match wins):
 * - `canonical`: `@tailor-platform/sdk` or `@tailor-platform/sdk/<sub-path>` where
 *   `<sub-path>` does not begin with `dist/`, `src/`, or `internal/`.
 * - `dist-leak`: `@tailor-platform/sdk/dist/...` — bypasses the package exports
 *   map.
 * - `src-leak`: `@tailor-platform/sdk/src/...` or `@tailor-platform/sdk/internal/...`.
 * - `peer-fake`: `@tailor-platform/<other>` (anything in the org scope but not
 *   the `sdk` package — agents sometimes invent peer packages).
 *
 * Aliased imports are tracked independently — every `import { X as Y }` from a
 * `@tailor-platform/*` specifier emits one alias row regardless of which
 * bucket the specifier landed in.
 */

import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");

const CANONICAL_PREFIX = "@tailor-platform/sdk";
const ORG_PREFIX = "@tailor-platform/";

type ImportBucket = "canonical" | "dist-leak" | "src-leak" | "peer-fake";

type ImportObservation = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string | undefined;
  iter: number;
  file: string;
  specifier: string;
  bucket: ImportBucket;
  /** `imported -> local` pairs for `import { X as Y }`. Empty when no alias. */
  aliases: string[];
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  ".next",
  "generated",
  ".sdk",
]);

function classifySpecifier(specifier: string): ImportBucket | undefined {
  if (!specifier.startsWith(ORG_PREFIX)) return undefined;
  if (!specifier.startsWith(CANONICAL_PREFIX)) return "peer-fake";
  const rest = specifier.slice(CANONICAL_PREFIX.length);
  // Bare `@tailor-platform/sdk` or sub-path under the package
  if (rest === "" || rest === "/" || rest.startsWith("/")) {
    const tail = rest.startsWith("/") ? rest.slice(1) : "";
    if (tail.startsWith("dist/") || tail === "dist") return "dist-leak";
    if (tail.startsWith("src/") || tail === "src") return "src-leak";
    if (tail.startsWith("internal/") || tail === "internal") return "src-leak";
    return "canonical";
  }
  // Trailing characters without `/` separator (e.g. `@tailor-platform/sdkX`)
  // is a peer-fake — the scope matches but the package boundary does not.
  return "peer-fake";
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
      if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

type AstNode = { type: string; [k: string]: unknown };

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function extractStringLiteral(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" || node.type === "StringLiteral") {
    const value = (node as AstNode & { value?: unknown }).value;
    if (typeof value === "string") return value;
  }
  return undefined;
}

type ImportSite = {
  specifier: string;
  /** Each entry is `imported -> local` if and only if the names differ. */
  aliases: string[];
};

/**
 * Pull ImportDeclaration sites out of the top-level program body. Only direct
 * `import ... from "x"` and `import "x"` forms are considered; dynamic
 * `import()` and `require()` are ignored because TypeScript scaffolds in this
 * benchmark use static imports exclusively.
 */
function namedImportSource(node: AstNode): string {
  if (node.type === "Identifier") {
    const name = (node as AstNode & { name?: string }).name;
    return typeof name === "string" ? name : "";
  }
  if (node.type === "Literal" || node.type === "StringLiteral") {
    const value = (node as AstNode & { value?: unknown }).value;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function collectImports(file: string): ImportSite[] {
  let fileSource: string;
  try {
    fileSource = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(file, fileSource, { sourceType: "module" });
  } catch {
    return [];
  }
  const body = (parsed.program as unknown as AstNode & { body?: AstNode[] }).body ?? [];
  const out: ImportSite[] = [];
  for (const node of body) {
    if (!isAstNode(node)) continue;
    if (node.type !== "ImportDeclaration") continue;
    const specifier = extractStringLiteral((node as AstNode & { source?: AstNode }).source);
    if (!specifier) continue;
    const specifiers = (node as AstNode & { specifiers?: AstNode[] }).specifiers ?? [];
    const aliases: string[] = [];
    for (const spec of specifiers) {
      if (!isAstNode(spec)) continue;
      if (spec.type !== "ImportSpecifier") continue; // skip default + namespace
      const imported = (spec as AstNode & { imported?: AstNode }).imported;
      const local = (spec as AstNode & { local?: AstNode }).local;
      // `import { X as Y }` and `import { "X" as Y }` (ES2022 string-literal
      // form) both surface here; accept either Identifier or StringLiteral on
      // the `imported` side so the audit catches the renames it exists to flag.
      const importedName = imported ? namedImportSource(imported) : "";
      const localName = local ? namedImportSource(local) : "";
      if (importedName && localName && importedName !== localName) {
        aliases.push(`${importedName} -> ${localName}`);
      }
    }
    out.push({ specifier, aliases });
  }
  return out;
}

function classifyIter(
  workRoot: string,
  meta: {
    sessionDir: string;
    problemId: string;
    profile: string;
    sdkBranch: string | undefined;
    iter: number;
  },
): { rows: ImportObservation[]; workTreeFound: boolean } {
  const rows: ImportObservation[] = [];
  if (!fs.existsSync(workRoot)) return { rows, workTreeFound: false };
  const files = walkTsFiles(workRoot);
  for (const file of files) {
    const relFile = path.relative(workRoot, file) || file;
    for (const site of collectImports(file)) {
      const bucket = classifySpecifier(site.specifier);
      if (!bucket) continue; // not in @tailor-platform/ scope — ignore
      rows.push({
        ...meta,
        file: relFile,
        specifier: site.specifier,
        bucket,
        aliases: site.aliases,
      });
    }
  }
  return { rows, workTreeFound: true };
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

function collectObservations(problemFilter: string | undefined): {
  rows: ImportObservation[];
  iters: { workTreeFound: boolean }[];
} {
  const rows: ImportObservation[] = [];
  const iters: { workTreeFound: boolean }[] = [];
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
      const dir = r.artifacts?.directory;
      if (!dir) continue;
      const rebuilt = resolveArtifactBase(reportFile, dir);
      const iterCount = r.iterations?.count ?? 1;
      const tasks: { workRoot: string; iter: number }[] = [];
      if (iterCount > 1) {
        const sessionRoot = path.dirname(path.dirname(rebuilt));
        for (let iter = 0; iter < iterCount; iter++) {
          tasks.push({
            workRoot: path.join(sessionRoot, `iter-${iter}`, r.problemId, "attempt-0", "work"),
            iter,
          });
        }
      } else {
        tasks.push({ workRoot: path.join(rebuilt, "attempt-0", "work"), iter: 0 });
      }
      for (const task of tasks) {
        const { rows: iterRows, workTreeFound } = classifyIter(task.workRoot, {
          sessionDir,
          problemId: r.problemId,
          profile,
          sdkBranch,
          iter: task.iter,
        });
        rows.push(...iterRows);
        iters.push({ workTreeFound });
      }
    }
  }
  return { rows, iters };
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "  -  ";
  return `${((num / denom) * 100).toFixed(0).padStart(3)}%`;
}

function formatGroupSummary(rows: ImportObservation[]): string {
  type Key = string; // `${problemId}|${profile}|${sdkBranch}`
  const groups = new Map<Key, ImportObservation[]>();
  for (const r of rows) {
    const key = `${r.problemId}|${r.profile}|${r.sdkBranch ?? "<baseline>"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const lines: string[] = [];
  lines.push("## Import canonicalness — per (problem, profile, sdkBranch)");
  lines.push("");
  lines.push(
    "| Problem | Profile | sdkBranch | Imports | Canonical | DistLeak | SrcLeak | PeerFake | AliasedImports |",
  );
  lines.push("| - | - | - | -: | -: | -: | -: | -: | - |");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const list = groups.get(k)!;
    const [pid, prof, br] = k.split("|");
    const total = list.length;
    const canonical = list.filter((r) => r.bucket === "canonical").length;
    const distLeak = list.filter((r) => r.bucket === "dist-leak").length;
    const srcLeak = list.filter((r) => r.bucket === "src-leak").length;
    const peerFake = list.filter((r) => r.bucket === "peer-fake").length;
    const aliasSet = new Set<string>();
    for (const r of list) {
      for (const a of r.aliases) aliasSet.add(a);
    }
    const aliasList = [...aliasSet].sort().join("; ");
    lines.push(
      `| ${pid} | ${prof} | ${br} | ${total} | ${pct(canonical, total)} (${canonical}) | ${pct(
        distLeak,
        total,
      )} (${distLeak}) | ${pct(srcLeak, total)} (${srcLeak}) | ${pct(peerFake, total)} (${peerFake}) | ${aliasList || "-"} |`,
    );
  }
  return lines.join("\n");
}

function formatBadImports(rows: ImportObservation[]): string {
  const bad = rows.filter((r) => r.bucket !== "canonical" || r.aliases.length > 0);
  const lines: string[] = [];
  lines.push("## Non-canonical and aliased imports — per import");
  lines.push("");
  lines.push("| Problem | Profile | Iter | Bucket | Specifier | File | Aliases |");
  lines.push("| - | - | -: | - | - | - | - |");
  const sorted = [...bad].sort(
    (a, b) =>
      a.problemId.localeCompare(b.problemId) ||
      a.profile.localeCompare(b.profile) ||
      a.iter - b.iter ||
      a.specifier.localeCompare(b.specifier),
  );
  for (const r of sorted) {
    lines.push(
      `| ${r.problemId} | ${r.profile} | ${r.iter} | ${r.bucket} | \`${r.specifier}\` | ${r.file} | ${r.aliases.join("; ") || "-"} |`,
    );
  }
  return lines.join("\n");
}

function writeCsv(rows: ImportObservation[], outFile: string): void {
  const header = [
    "sessionDir",
    "problemId",
    "profile",
    "sdkBranch",
    "iter",
    "file",
    "specifier",
    "bucket",
    "aliases",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.sessionDir,
      r.problemId,
      r.profile,
      r.sdkBranch ?? "",
      String(r.iter),
      JSON.stringify(r.file),
      JSON.stringify(r.specifier),
      r.bucket,
      JSON.stringify(r.aliases.join("|")),
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
  const { rows, iters } = collectObservations(problem);
  const out: string[] = [];
  out.push("# Import-canonicalness audit — corpus aggregate\n");
  out.push(`- iterations audited: ${iters.length}`);
  out.push(`- iterations with work tree: ${iters.filter((i) => i.workTreeFound).length}`);
  out.push(`- imports observed: ${rows.length}`);
  if (problem) out.push(`- filtered to problem: ${problem}`);
  out.push("");
  out.push(formatGroupSummary(rows));
  out.push("");
  out.push(formatBadImports(rows));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (csvOut) {
    writeCsv(rows, csvOut);
    console.error(`# wrote ${rows.length} rows to ${csvOut}`);
  }
}

main();
