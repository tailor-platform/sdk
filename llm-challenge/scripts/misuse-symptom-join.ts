/**
 * JOIN the call-shape audit (which canonical was called wrong?) with the
 * failure-mode taxonomy (what TS error / vitest assertion fired?) so the
 * analyst can answer questions like "when agents pass `{ jobName, run }`
 * instead of `{ name, body }` to `createWorkflowJob`, what error do they
 * see?".
 *
 * Both inputs are CSV files pre-computed by sibling scripts:
 *
 *   pnpm exec tsx llm-challenge/scripts/call-shape-audit.ts --csv call.csv
 *   pnpm exec tsx llm-challenge/scripts/failure-modes.ts --csv fail.csv
 *   pnpm exec tsx llm-challenge/scripts/misuse-symptom-join.ts \
 *     --call-shape call.csv --failures fail.csv
 *
 * Pass `--csv out.csv` to additionally emit the joined rows (one per
 * (call-shape observation × failure-mode bucket) match).
 *
 * The JOIN key is (problemId, profile, sdkBranch). sessionDir is intentionally
 * NOT part of the key — analysts comparing misuse patterns across sessions
 * want call-shape observations from one session to find failure-mode hits
 * from any session of the same task. The trade-off is that, for a single
 * (problem, profile, sdkBranch), a call-shape row with N missing keys joins
 * to M failure-mode rows producing N×M joined rows; the bucket histogram is
 * therefore counting call×failure pairs rather than unique iterations.
 *
 * `failure-modes` does not retain per-iter granularity because the runner's
 * `aggregateIterations` collapses iter stages into the best (passing) iter
 * when at least one iter passed. Mixed-pass groups therefore contribute
 * call-shape observations with no failure-mode side to join against; those
 * are tallied separately in the report header as "unmatched call-shape rows".
 * The symmetric counter — failure-mode rows whose problem had no call-shape
 * data — is surfaced as "unmatched failure-mode rows".
 */

import fs from "node:fs";
import path from "node:path";

type CallShapeRow = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string;
  iter: string;
  symbol: string;
  file: string;
  argCount: string;
  configKeysSource: string;
  configKeys: string;
  arityMatch: string;
  missingKeys: string;
};

type FailureRow = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string;
  stage: string;
  bucket: string;
  detail: string;
};

type JoinedRow = {
  sessionDir: string;
  problemId: string;
  profile: string;
  sdkBranch: string;
  symbol: string;
  missingKey: string; // one row per missing key (call-shape rows with multiple missing keys fan out)
  arityMatch: string;
  stage: string;
  bucket: string;
  detail: string;
};

/**
 * Minimal RFC-4180-ish CSV parser. Handles double-quoted cells (with embedded
 * `""` escapes) and trims a trailing CR. Multi-line cell values are NOT
 * supported because both producer scripts (`call-shape-audit.ts`,
 * `failure-modes.ts`) `JSON.stringify` any field that might contain newlines,
 * so the output is always one-line-per-row.
 */
function parseCsv(content: string): string[][] {
  const out: string[][] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;
    const cells: string[] = [];
    let buf = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            buf += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else if (c === "\\" && line[i + 1] === '"') {
          // The two producer scripts emit JSON-stringified cells, so embedded
          // `"` lands as `\"` rather than RFC-4180's `""`. Accept both.
          buf += '"';
          i++;
        } else {
          buf += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(buf);
        buf = "";
      } else {
        buf += c;
      }
    }
    cells.push(buf);
    out.push(cells);
  }
  return out;
}

function readCsv<T extends Record<string, string>>(file: string, expected: readonly string[]): T[] {
  const content = fs.readFileSync(file, "utf-8");
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  for (const key of expected) {
    if (!header.includes(key)) {
      throw new Error(`CSV ${file} missing expected column "${key}". Got: [${header.join(", ")}]`);
    }
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const out: T[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const obj: Record<string, string> = {};
    for (const key of expected) {
      obj[key] = row[idx[key]!] ?? "";
    }
    out.push(obj as T);
  }
  return out;
}

const CALL_SHAPE_COLUMNS = [
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
] as const;

const FAILURE_COLUMNS = [
  "sessionDir",
  "problemId",
  "profile",
  "sdkBranch",
  "stage",
  "bucket",
  "detail",
] as const;

function groupKey(row: { problemId: string; profile: string; sdkBranch: string }): string {
  return `${row.problemId}|${row.profile}|${row.sdkBranch}`;
}

function joinRows(
  calls: CallShapeRow[],
  failures: FailureRow[],
): {
  joined: JoinedRow[];
  unmatchedCalls: number;
  unmatchedFailures: number;
} {
  // Group failures by (problemId, profile, sdkBranch). One key may map to
  // many bucket rows when multiple stages failed.
  const failuresByGroup = new Map<string, FailureRow[]>();
  for (const f of failures) {
    const k = groupKey(f);
    if (!failuresByGroup.has(k)) failuresByGroup.set(k, []);
    failuresByGroup.get(k)!.push(f);
  }
  const joined: JoinedRow[] = [];
  let unmatchedCalls = 0;
  const seenFailureGroups = new Set<string>();
  for (const call of calls) {
    // Only call-shape rows with missing config keys are interesting for the
    // misuse JOIN — arity-only mismatches are caught elsewhere.
    const missing = call.missingKeys
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (missing.length === 0 && call.arityMatch === "true") continue;
    const k = groupKey(call);
    const matched = failuresByGroup.get(k);
    if (!matched || matched.length === 0) {
      unmatchedCalls += 1;
      continue;
    }
    seenFailureGroups.add(k);
    for (const f of matched) {
      if (missing.length === 0) {
        joined.push({
          sessionDir: call.sessionDir,
          problemId: call.problemId,
          profile: call.profile,
          sdkBranch: call.sdkBranch,
          symbol: call.symbol,
          missingKey: "<arity_mismatch>",
          arityMatch: call.arityMatch,
          stage: f.stage,
          bucket: f.bucket,
          detail: f.detail,
        });
      } else {
        for (const mk of missing) {
          joined.push({
            sessionDir: call.sessionDir,
            problemId: call.problemId,
            profile: call.profile,
            sdkBranch: call.sdkBranch,
            symbol: call.symbol,
            missingKey: mk,
            arityMatch: call.arityMatch,
            stage: f.stage,
            bucket: f.bucket,
            detail: f.detail,
          });
        }
      }
    }
  }
  const unmatchedFailures =
    failures.length -
    [...seenFailureGroups].reduce((n, k) => n + (failuresByGroup.get(k)?.length ?? 0), 0);
  return { joined, unmatchedCalls, unmatchedFailures };
}

function formatSymbolMissingByBucket(rows: JoinedRow[]): string {
  // For each (symbol, missingKey): tally bucket counts. Output one row per
  // (symbol, missingKey) with the top-3 buckets and their counts.
  type Key = string;
  const groups = new Map<Key, JoinedRow[]>();
  for (const r of rows) {
    const k = `${r.symbol}|${r.missingKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const lines: string[] = [];
  lines.push("## Misuse-symptom JOIN — per (symbol, missing-key)");
  lines.push("");
  lines.push("| Symbol | MissingKey | Joined rows | Top failure buckets | Sample detail |");
  lines.push("| - | - | -: | - | - |");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const list = groups.get(k)!;
    const [sym, mk] = k.split("|");
    const bucketCounter = new Map<string, number>();
    for (const r of list) bucketCounter.set(r.bucket, (bucketCounter.get(r.bucket) ?? 0) + 1);
    const top = [...bucketCounter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([b, n]) => `\`${b}\` (${n})`)
      .join(", ");
    const sample = list[0]!.detail.replace(/\|/g, "\\|").slice(0, 100);
    lines.push(`| ${sym} | ${mk} | ${list.length} | ${top || "-"} | ${sample} |`);
  }
  return lines.join("\n");
}

function formatBucketHistogram(rows: JoinedRow[]): string {
  const counter = new Map<string, number>();
  for (const r of rows) counter.set(r.bucket, (counter.get(r.bucket) ?? 0) + 1);
  const total = rows.length;
  const lines: string[] = [];
  lines.push("## Failure-bucket distribution across joined rows");
  lines.push("");
  lines.push("| Bucket | Joined rows | Share |");
  lines.push("| - | -: | -: |");
  const sortedBuckets = [...counter.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [bucket, count] of sortedBuckets) {
    const share = total === 0 ? "  -  " : `${((count / total) * 100).toFixed(0).padStart(3)}%`;
    lines.push(`| \`${bucket}\` | ${count} | ${share} |`);
  }
  return lines.join("\n");
}

function writeCsv(rows: JoinedRow[], outFile: string): void {
  const header = [
    "sessionDir",
    "problemId",
    "profile",
    "sdkBranch",
    "symbol",
    "missingKey",
    "arityMatch",
    "stage",
    "bucket",
    "detail",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.sessionDir,
        r.problemId,
        r.profile,
        r.sdkBranch,
        r.symbol,
        JSON.stringify(r.missingKey),
        r.arityMatch,
        r.stage,
        r.bucket,
        JSON.stringify(r.detail),
      ].join(","),
    );
  }
  fs.writeFileSync(outFile, `${lines.join("\n")}\n`);
}

function parseArgs(): { callShape: string; failures: string; csvOut: string | undefined } {
  const args = process.argv.slice(2);
  let callShape: string | undefined;
  let failuresPath: string | undefined;
  let csvOut: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--call-shape" && i + 1 < args.length) {
      callShape = args[++i];
    } else if (args[i] === "--failures" && i + 1 < args.length) {
      failuresPath = args[++i];
    } else if (args[i] === "--csv" && i + 1 < args.length) {
      csvOut = args[++i];
    }
  }
  if (!callShape || !failuresPath) {
    console.error(
      "Usage: tsx misuse-symptom-join.ts --call-shape <call.csv> --failures <fail.csv> [--csv <out.csv>]",
    );
    console.error("Pre-compute the inputs with:");
    console.error("  tsx llm-challenge/scripts/call-shape-audit.ts --csv call.csv");
    console.error("  tsx llm-challenge/scripts/failure-modes.ts --csv fail.csv");
    process.exit(2);
  }
  if (!fs.existsSync(callShape)) {
    console.error(`call-shape CSV not found: ${callShape}`);
    process.exit(2);
  }
  if (!fs.existsSync(failuresPath)) {
    console.error(`failures CSV not found: ${failuresPath}`);
    process.exit(2);
  }
  return { callShape, failures: failuresPath, csvOut };
}

function main(): void {
  const { callShape: callShapePath, failures: failuresPath, csvOut } = parseArgs();
  const calls = readCsv<CallShapeRow>(callShapePath, CALL_SHAPE_COLUMNS);
  const failures = readCsv<FailureRow>(failuresPath, FAILURE_COLUMNS);
  const { joined, unmatchedCalls, unmatchedFailures } = joinRows(calls, failures);
  const out: string[] = [];
  out.push("# Misuse-symptom JOIN — call-shape × failure-mode\n");
  out.push(`- call-shape CSV: ${path.relative(process.cwd(), callShapePath)}`);
  out.push(`- failures CSV: ${path.relative(process.cwd(), failuresPath)}`);
  out.push(`- call-shape observations: ${calls.length}`);
  out.push(`- failure-mode observations: ${failures.length}`);
  out.push(`- joined rows: ${joined.length}`);
  out.push(
    `- unmatched call-shape rows with missing keys (no failure-mode side; usually mixed-pass groups whose per-iter stage detail was collapsed): ${unmatchedCalls}`,
  );
  out.push(
    `- unmatched failure-mode rows (problem had no call-shape data, e.g. generate stage failed before any source emitted): ${unmatchedFailures}`,
  );
  out.push("");
  out.push(formatSymbolMissingByBucket(joined));
  out.push("");
  out.push(formatBucketHistogram(joined));
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (csvOut) {
    writeCsv(joined, csvOut);
    console.error(`# wrote ${joined.length} rows to ${csvOut}`);
  }
}

main();
