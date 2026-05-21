/**
 * Compare two affordance-gap row sets per (problemId, profile).
 * Reads two CSVs (baseline-before, baseline-after), filters out
 * `sdkBranch != ""` rows, and emits a markdown delta table.
 *
 * Usage:
 *   tsx llm-challenge/scripts/baseline-diff.ts --before <csv> --after <csv>
 *
 * Designed for the smoke re-baseline workflow: snapshot the "before" CSV
 * (e.g. `affordance-gap-rows-v10.csv`) before running new iterations,
 * run the new iterations, regenerate the aggregate CSV, then diff.
 *
 * The script does NOT regenerate the CSVs — run `affordance-gap.ts --csv`
 * separately.
 */

import fs from "node:fs";
import path from "node:path";

type Row = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string;
  iter: string;
  passed: string;
  first_hit_outcome: string;
  bias_hit: string;
};

function readCsv(file: string): Row[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(",");
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells: string[] = [];
    let buf = "";
    let inQuotes = false;
    for (const ch of lines[i]!) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(buf);
        buf = "";
        continue;
      }
      buf += ch;
    }
    cells.push(buf);
    const row = {} as Record<string, string>;
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = cells[j] ?? "";
    }
    out.push(row as unknown as Row);
  }
  return out;
}

type Bucket = { n: number; pass: number; hit: number; bias: number };

function bucketize(rows: Row[], filterSession?: string): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const r of rows) {
    if (r.sdkBranch) continue;
    if (filterSession && r.sessionDir !== filterSession) continue;
    const key = `${r.problemId}|${r.profile}`;
    if (!out.has(key)) out.set(key, { n: 0, pass: 0, hit: 0, bias: 0 });
    const b = out.get(key)!;
    b.n += 1;
    if (r.passed === "true") b.pass += 1;
    if (r.first_hit_outcome === "hit") b.hit += 1;
    if (r.bias_hit === "true") b.bias += 1;
  }
  return out;
}

function pct(num: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 100);
}

function deltaCell(after: number | undefined, before: number | undefined): string {
  if (after === undefined && before === undefined) return "n/a";
  if (after === undefined) return `→ (no after data) was ${before}%`;
  if (before === undefined) return `${after}% (new)`;
  const d = after - before;
  const sign = d > 0 ? "+" : d < 0 ? "" : "±";
  return `${after}% (${sign}${d}pp from ${before}%)`;
}

function main(): void {
  const args = process.argv.slice(2);
  let before: string | undefined;
  let after: string | undefined;
  let onlyProblems: string[] | undefined;
  let afterSession: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--before") before = args[++i];
    else if (a === "--after") after = args[++i];
    else if (a === "--only") onlyProblems = (args[++i] ?? "").split(",").map((s) => s.trim());
    else if (a === "--after-session") afterSession = args[++i];
  }
  if (!before || !after) {
    console.error(
      "Usage: tsx scripts/baseline-diff.ts --before <csv> --after <csv> [--only h07,h10,...] [--after-session <sessionDir>]",
    );
    process.exit(2);
  }
  const beforeRows = readCsv(before);
  const afterRows = readCsv(after);
  const beforeBucket = bucketize(beforeRows);
  const afterBucket = bucketize(afterRows, afterSession);
  const keys = new Set<string>([...beforeBucket.keys(), ...afterBucket.keys()]);
  const filtered = onlyProblems
    ? [...keys].filter((k) => onlyProblems!.some((p) => k.startsWith(p)))
    : [...keys];
  filtered.sort();
  console.log("# Baseline diff");
  console.log("");
  console.log(`- before: \`${path.basename(before)}\` (${beforeRows.length} rows)`);
  console.log(`- after: \`${path.basename(after)}\` (${afterRows.length} rows)`);
  if (afterSession) console.log(`- after filtered to sessionDir: \`${afterSession}\``);
  if (onlyProblems) console.log(`- restricted to problems: ${onlyProblems.join(", ")}`);
  console.log("");
  console.log("| Problem | Profile | N before | N after | Pass | Canonical hit | Bias hit |");
  console.log("| - | - | -: | -: | - | - | - |");
  for (const k of filtered) {
    const [pid, prof] = k.split("|");
    const b = beforeBucket.get(k);
    const a = afterBucket.get(k);
    const nB = b?.n;
    const nA = a?.n;
    const passCell = deltaCell(a ? pct(a.pass, a.n) : undefined, b ? pct(b.pass, b.n) : undefined);
    const hitCell = deltaCell(a ? pct(a.hit, a.n) : undefined, b ? pct(b.hit, b.n) : undefined);
    const biasCell = deltaCell(a ? pct(a.bias, a.n) : undefined, b ? pct(b.bias, b.n) : undefined);
    console.log(
      `| ${pid} | ${prof} | ${nB ?? "0"} | ${nA ?? "0"} | ${passCell} | ${hitCell} | ${biasCell} |`,
    );
  }
}

main();
