/**
 * Score the single-turn SDK API recall sheet (`r1-sdk-recall-sheet`).
 *
 * For each `results/artifacts/<session>/iter-N/r1-sdk-recall-sheet/attempt-0/result.json`,
 * extract the fenced JSON block from `output`, zip its `surfaces[]` entries
 * against the `surfaces[]` declared in `problems/r1-sdk-recall-sheet/meta.json`,
 * and grade per (surface, profile):
 *
 * - canonicalHit:  any `canonical[]` substring appears in `firstCall` (or `firstImport`)
 * - attractorHit:  any `attractors[]` substring appears (mutually exclusive only if canonical missed)
 * - bothMiss:      neither matched
 * - parseError:    the iteration's output did not contain a parseable JSON block
 *
 * Output: markdown summary to stdout; optional `--csv <file>` writes one row
 * per (iter, surface).
 *
 *   tsx llm-challenge/scripts/recall-sheet-audit.ts
 *   tsx llm-challenge/scripts/recall-sheet-audit.ts --csv recall.csv
 */

import fs from "node:fs";
import path from "node:path";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");
const PROBLEMS_DIR = path.join(LLM_CHALLENGE_ROOT, "problems");
const PROBLEM_ID = "r1-sdk-recall-sheet";

type Surface = {
  key: string;
  intent: string;
  canonical: string[];
  attractors: string[];
};

type Meta = {
  id: string;
  surfaces: Surface[];
};

type RawAnswer = {
  key?: string;
  firstImport?: string;
  firstCall?: string;
};

type IterRow = {
  sessionDir: string;
  iter: number;
  profile: string;
  sdkBranch: string;
  surface: string;
  parseStatus: "ok" | "no_json" | "no_entry";
  firstImport: string;
  firstCall: string;
  canonicalHit: boolean;
  attractorHit: boolean;
  hitCanonicals: string[];
  hitAttractors: string[];
};

function loadRecallMeta(): Meta | undefined {
  const metaPath = path.join(PROBLEMS_DIR, PROBLEM_ID, "meta.json");
  if (!fs.existsSync(metaPath)) return undefined;
  const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Partial<Meta>;
  if (!raw.id || !Array.isArray(raw.surfaces)) return undefined;
  return { id: raw.id, surfaces: raw.surfaces };
}

function* iterArtifactSessions(): Iterable<{
  sessionDir: string;
  profile: string;
  sdkBranch: string;
}> {
  const artifactsRoot = path.join(RESULTS_DIR, "artifacts");
  if (!fs.existsSync(artifactsRoot)) return;
  for (const sessionName of fs.readdirSync(artifactsRoot)) {
    if (sessionName.startsWith("_quarantine") || sessionName.startsWith(".")) continue;
    const sessionDir = path.join(artifactsRoot, sessionName);
    if (!fs.statSync(sessionDir).isDirectory()) continue;
    // Session dirs look like `codex-gpt-5.5-xhigh-full-1.46.0-2026-05-22T08-59-25`.
    // Profile is the segment between effort and version.
    const m = /-xhigh-(full|no-docs)(?:-sdkbranch-([^-]+))?-\d/.exec(sessionName);
    const profile = m?.[1] ?? "unknown";
    const sdkBranch = m?.[2] ?? "<baseline>";
    yield { sessionDir, profile, sdkBranch };
  }
}

/**
 * Extract the LAST balanced JSON object from a free-form string. Tries fenced
 * ` ```json ... ``` ` first, then any `{ ... }` block. Returns null if nothing
 * parses as JSON with a `.surfaces` array of objects.
 */
function extractRecallJson(output: string): { surfaces: RawAnswer[] } | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/g);
  const candidates: string[] = [];
  if (fenced) {
    for (const block of fenced) {
      const body = block.replace(/^```(?:json)?\s*/, "").replace(/```$/, "");
      candidates.push(body);
    }
  }
  // Fallback: scan for outermost {...} blocks via brace counting.
  let depth = 0;
  let start = -1;
  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(output.slice(start, i + 1));
        start = -1;
      }
    }
  }
  // Try candidates from last to first.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const text = candidates[i].trim();
    try {
      const parsed = JSON.parse(text) as { surfaces?: unknown };
      if (parsed && Array.isArray(parsed.surfaces)) {
        const surfaces = parsed.surfaces.filter(
          (s): s is RawAnswer => typeof s === "object" && s !== null,
        );
        if (surfaces.length > 0) return { surfaces };
      }
    } catch {
      // not parseable, try next candidate
    }
  }
  return null;
}

/**
 * Find which needles appear as substrings of `haystack`, with longer needles
 * suppressing shorter ones that overlap their character range. Each call
 * records each needle at most once.
 *
 * The optional `claimed` mask carries over from a previous call (typically the
 * canonical scan): positions already claimed there are off-limits for the
 * next scan, so a canonical hit like `defineWaitPoints` blocks the attractor
 * `defineWaitPoint` from registering a false-positive.
 *
 * Mutates `claimed` in place when supplied.
 */
function findSubstring(haystack: string, needles: string[], claimed?: boolean[]): string[] {
  const mask = claimed ?? new Array<boolean>(haystack.length).fill(false);
  const out: string[] = [];
  const sorted = [...needles].sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    if (!n) continue;
    const idx = haystack.indexOf(n);
    if (idx < 0) continue;
    let overlap = false;
    for (let i = idx; i < idx + n.length; i++) {
      if (mask[i]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    out.push(n);
    for (let i = idx; i < idx + n.length; i++) mask[i] = true;
  }
  return out;
}

function gradeIteration(
  sessionDir: string,
  iter: number,
  profile: string,
  sdkBranch: string,
  output: string,
  meta: Meta,
): IterRow[] {
  const parsed = extractRecallJson(output);
  const surfaceByKey = new Map<string, RawAnswer>();
  if (parsed) {
    for (const s of parsed.surfaces) {
      if (typeof s.key === "string") surfaceByKey.set(s.key, s);
    }
  }
  const rows: IterRow[] = [];
  for (const surface of meta.surfaces) {
    const ans = surfaceByKey.get(surface.key);
    if (!parsed) {
      rows.push({
        sessionDir,
        iter,
        profile,
        sdkBranch,
        surface: surface.key,
        parseStatus: "no_json",
        firstImport: "",
        firstCall: "",
        canonicalHit: false,
        attractorHit: false,
        hitCanonicals: [],
        hitAttractors: [],
      });
      continue;
    }
    if (!ans) {
      rows.push({
        sessionDir,
        iter,
        profile,
        sdkBranch,
        surface: surface.key,
        parseStatus: "no_entry",
        firstImport: "",
        firstCall: "",
        canonicalHit: false,
        attractorHit: false,
        hitCanonicals: [],
        hitAttractors: [],
      });
      continue;
    }
    const firstImport = typeof ans.firstImport === "string" ? ans.firstImport : "";
    const firstCall = typeof ans.firstCall === "string" ? ans.firstCall : "";
    const haystack = `${firstImport}\n${firstCall}`;
    // Score canonicals first; the shared `claimed` mask makes attractor
    // substrings that overlap a canonical hit (e.g. `defineWaitPoint` inside
    // `defineWaitPoints`) drop out instead of double-registering.
    const claimed: boolean[] = new Array(haystack.length).fill(false);
    const hitCanonicals = findSubstring(haystack, surface.canonical, claimed);
    const hitAttractors = findSubstring(haystack, surface.attractors, claimed);
    rows.push({
      sessionDir,
      iter,
      profile,
      sdkBranch,
      surface: surface.key,
      parseStatus: "ok",
      firstImport,
      firstCall,
      canonicalHit: hitCanonicals.length > 0,
      attractorHit: hitAttractors.length > 0,
      hitCanonicals,
      hitAttractors,
    });
  }
  return rows;
}

function readAttemptResult(attemptDir: string): { output: string } | undefined {
  const resultPath = path.join(attemptDir, "result.json");
  if (!fs.existsSync(resultPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as {
      output?: string;
      infraFailure?: boolean;
    };
    if (raw.infraFailure) return undefined;
    return { output: typeof raw.output === "string" ? raw.output : "" };
  } catch {
    return undefined;
  }
}

function collectRows(meta: Meta): IterRow[] {
  const rows: IterRow[] = [];
  for (const { sessionDir, profile, sdkBranch } of iterArtifactSessions()) {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    const iterDirs = entries.filter((d) => d.isDirectory() && /^iter-\d+$/.test(d.name));
    // Multi-iter layout: <session>/iter-N/<problem>/attempt-0/
    if (iterDirs.length > 0) {
      for (const iterDir of iterDirs) {
        const iterNum = Number.parseInt(iterDir.name.slice("iter-".length), 10);
        const attemptDir = path.join(sessionDir, iterDir.name, PROBLEM_ID, "attempt-0");
        const r = readAttemptResult(attemptDir);
        if (r) {
          rows.push(...gradeIteration(sessionDir, iterNum, profile, sdkBranch, r.output, meta));
        }
      }
      continue;
    }
    // Single-iter layout: <session>/<problem>/attempt-0/
    const attemptDir = path.join(sessionDir, PROBLEM_ID, "attempt-0");
    const r = readAttemptResult(attemptDir);
    if (r) {
      rows.push(...gradeIteration(sessionDir, 0, profile, sdkBranch, r.output, meta));
    }
  }
  return rows;
}

type Agg = {
  total: number;
  canonical: number;
  attractor: number;
  neither: number;
  parseError: number;
};

function aggregate(rows: IterRow[], keyOf: (r: IterRow) => string): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyOf(r);
    let agg = out.get(key);
    if (!agg) {
      agg = { total: 0, canonical: 0, attractor: 0, neither: 0, parseError: 0 };
      out.set(key, agg);
    }
    agg.total++;
    if (r.parseStatus !== "ok") {
      agg.parseError++;
      continue;
    }
    if (r.canonicalHit) agg.canonical++;
    if (r.attractorHit && !r.canonicalHit) agg.attractor++;
    if (!r.canonicalHit && !r.attractorHit) agg.neither++;
  }
  return out;
}

function pct(n: number, total: number): string {
  if (total === 0) return "n/a";
  return `${((100 * n) / total).toFixed(0)}%`;
}

function fmtAgg(agg: Agg): string {
  return `canonical=${pct(agg.canonical, agg.total)} (${agg.canonical}/${agg.total})  attractor=${pct(agg.attractor, agg.total)}  neither=${pct(agg.neither, agg.total)}  parseErr=${agg.parseError}`;
}

function renderMarkdown(rows: IterRow[], meta: Meta): string {
  const out: string[] = [];
  out.push("# Recall-sheet audit — corpus aggregate");
  out.push("");
  out.push(`- problem: ${PROBLEM_ID}`);
  out.push(`- surfaces declared: ${meta.surfaces.length}`);
  out.push(`- iterations × surfaces audited: ${rows.length}`);
  const okRows = rows.filter((r) => r.parseStatus === "ok").length;
  const parseErrRows = rows.filter((r) => r.parseStatus !== "ok").length;
  out.push(`- rows with parseable JSON entry: ${okRows} (parseErr=${parseErrRows})`);
  out.push("");

  out.push("## Per-surface canonical / attractor distribution");
  out.push("");
  out.push(
    "| Surface | Profile | Total | Canonical | Attractor | Neither | ParseErr | TopAttractors |",
  );
  out.push("| - | - | -: | -: | -: | -: | -: | - |");
  const perSurfaceProfile = aggregate(rows, (r) => `${r.surface}::${r.profile}`);
  const attractorByKey = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.attractorHit || r.canonicalHit) continue;
    const k = `${r.surface}::${r.profile}`;
    let m = attractorByKey.get(k);
    if (!m) {
      m = new Map();
      attractorByKey.set(k, m);
    }
    for (const a of r.hitAttractors) m.set(a, (m.get(a) ?? 0) + 1);
  }
  const surfaceOrder = meta.surfaces.map((s) => s.key);
  const profiles = ["full", "no-docs"];
  for (const surface of surfaceOrder) {
    for (const profile of profiles) {
      const k = `${surface}::${profile}`;
      const agg = perSurfaceProfile.get(k);
      if (!agg) continue;
      const topAttrs = [...(attractorByKey.get(k) ?? new Map())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, c]) => `${s}(${c})`)
        .join(", ");
      out.push(
        `| ${surface} | ${profile} | ${agg.total} | ${pct(agg.canonical, agg.total)} (${agg.canonical}) | ${pct(agg.attractor, agg.total)} | ${pct(agg.neither, agg.total)} | ${agg.parseError} | ${topAttrs || "-"} |`,
      );
    }
  }
  out.push("");

  out.push("## Surface ranking — most attractor-bound (descending)");
  out.push("");
  out.push("| Surface | Attractor% (full / no-docs) | TotalIters | TopAttractors |");
  out.push("| - | - | -: | - |");
  type Rank = { surface: string; pctFull: number; pctNoDocs: number; total: number; top: string };
  const ranking: Rank[] = [];
  for (const surface of surfaceOrder) {
    const f = perSurfaceProfile.get(`${surface}::full`);
    const n = perSurfaceProfile.get(`${surface}::no-docs`);
    const pctFull = f && f.total > 0 ? (100 * f.attractor) / f.total : 0;
    const pctNoDocs = n && n.total > 0 ? (100 * n.attractor) / n.total : 0;
    const total = (f?.total ?? 0) + (n?.total ?? 0);
    const combined = new Map<string, number>();
    for (const m of [
      attractorByKey.get(`${surface}::full`),
      attractorByKey.get(`${surface}::no-docs`),
    ]) {
      if (!m) continue;
      for (const [a, c] of m) combined.set(a, (combined.get(a) ?? 0) + c);
    }
    const top = [...combined]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, c]) => `${s}(${c})`)
      .join(", ");
    ranking.push({ surface, pctFull, pctNoDocs, total, top });
  }
  ranking
    .sort((a, b) => b.pctFull + b.pctNoDocs - (a.pctFull + a.pctNoDocs))
    .filter((r) => r.total > 0)
    .forEach((r) => {
      out.push(
        `| ${r.surface} | ${r.pctFull.toFixed(0)}% / ${r.pctNoDocs.toFixed(0)}% | ${r.total} | ${r.top || "-"} |`,
      );
    });
  out.push("");

  out.push("## Per-profile totals");
  out.push("");
  const perProfile = aggregate(rows, (r) => r.profile);
  for (const [k, agg] of perProfile) {
    out.push(`- **${k}**: ${fmtAgg(agg)}`);
  }
  out.push("");

  return out.join("\n");
}

function renderCsv(rows: IterRow[]): string {
  const header = [
    "sessionDir",
    "iter",
    "profile",
    "sdkBranch",
    "surface",
    "parseStatus",
    "canonicalHit",
    "attractorHit",
    "hitCanonicals",
    "hitAttractors",
    "firstImport",
    "firstCall",
  ].join(",");
  const escape = (s: string): string => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [
        escape(path.basename(r.sessionDir)),
        String(r.iter),
        r.profile,
        r.sdkBranch,
        r.surface,
        r.parseStatus,
        r.canonicalHit ? "1" : "0",
        r.attractorHit ? "1" : "0",
        escape(r.hitCanonicals.join("|")),
        escape(r.hitAttractors.join("|")),
        escape(r.firstImport),
        escape(r.firstCall),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  let csvPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--csv") {
      csvPath = args[i + 1];
      i++;
    }
  }

  const meta = loadRecallMeta();
  if (!meta) {
    console.error(`No meta.json found for ${PROBLEM_ID}; nothing to audit.`);
    process.exit(1);
  }

  const rows = collectRows(meta);
  if (rows.length === 0) {
    console.error("No recall-sheet artifacts found under results/artifacts/.");
    process.exit(0);
  }

  if (csvPath) {
    fs.writeFileSync(csvPath, renderCsv(rows));
    console.error(`Wrote ${rows.length} rows to ${csvPath}`);
  }
  process.stdout.write(renderMarkdown(rows, meta));
}

main();
