/**
 * Score the R2 grand-app sweep against the per-surface canonical / attractor
 * substrings declared in `problems/r2-grand-app/meta.json`.
 *
 * For each `results/artifacts/<session>/iter-N/r2-grand-app/attempt-0/work/`,
 * read each surface's designated `file` and substring-match its canonical[]
 * and attractors[] needles. Output per-(surface, profile) totals and a
 * surface ranking by attractor%, mirroring `recall-sheet-audit.ts` so R1 and
 * R2 reports are directly comparable.
 *
 *   tsx llm-challenge/scripts/r2-grand-app-audit.ts
 *   tsx llm-challenge/scripts/r2-grand-app-audit.ts --csv r2.csv
 */

import fs from "node:fs";
import path from "node:path";

const LLM_CHALLENGE_ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(LLM_CHALLENGE_ROOT, "results");
const PROBLEMS_DIR = path.join(LLM_CHALLENGE_ROOT, "problems");
const DEFAULT_PROBLEM_ID = "r2-grand-app";
let PROBLEM_ID = DEFAULT_PROBLEM_ID;

type Surface = {
  key: string;
  file: string;
  canonical: string[];
  attractors: string[];
};

type Meta = {
  id: string;
  surfaces: Surface[];
};

type IterRow = {
  sessionDir: string;
  iter: number;
  profile: string;
  sdkBranch: string;
  surface: string;
  fileStatus: "ok" | "missing" | "empty";
  canonicalHit: boolean;
  attractorHit: boolean;
  hitCanonicals: string[];
  hitAttractors: string[];
};

function loadMeta(): Meta | undefined {
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
    const m = /-xhigh-(full|no-docs)(?:-sdkbranch-([^-]+))?-\d/.exec(sessionName);
    const profile = m?.[1] ?? "unknown";
    const sdkBranch = m?.[2] ?? "<baseline>";
    yield { sessionDir, profile, sdkBranch };
  }
}

/**
 * Same algorithm as recall-sheet-audit's findSubstring: longer needles
 * suppress overlapping shorter ones, claimed mask carries across calls so
 * canonical hits block attractor false-positives.
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

/**
 * Strip TS/JS comments so an `// outdated` scaffold line doesn't trigger a
 * false attractor hit on agent code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function gradeIteration(
  sessionDir: string,
  iter: number,
  profile: string,
  sdkBranch: string,
  workDir: string,
  meta: Meta,
): IterRow[] {
  const rows: IterRow[] = [];
  for (const surface of meta.surfaces) {
    const filePath = path.join(workDir, surface.file);
    let haystack = "";
    let fileStatus: "ok" | "missing" | "empty" = "ok";
    if (!fs.existsSync(filePath)) {
      fileStatus = "missing";
    } else {
      const raw = fs.readFileSync(filePath, "utf-8");
      const stripped = stripComments(raw);
      if (!stripped.trim()) {
        fileStatus = "empty";
      } else {
        haystack = stripped;
      }
    }
    const claimed: boolean[] = new Array(haystack.length).fill(false);
    const hitCanonicals = haystack ? findSubstring(haystack, surface.canonical, claimed) : [];
    const hitAttractors = haystack ? findSubstring(haystack, surface.attractors, claimed) : [];
    rows.push({
      sessionDir,
      iter,
      profile,
      sdkBranch,
      surface: surface.key,
      fileStatus,
      canonicalHit: hitCanonicals.length > 0,
      attractorHit: hitAttractors.length > 0,
      hitCanonicals,
      hitAttractors,
    });
  }
  return rows;
}

function readAttemptWorkDir(attemptDir: string): string | undefined {
  const workDir = path.join(attemptDir, "work");
  if (!fs.existsSync(workDir)) return undefined;
  // Skip attempts that recorded an infra failure — those are not useful signal.
  const resultPath = path.join(attemptDir, "result.json");
  if (fs.existsSync(resultPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as { infraFailure?: boolean };
      if (raw.infraFailure) return undefined;
    } catch {
      // ignore; treat as available
    }
  }
  return workDir;
}

function collectRows(meta: Meta): IterRow[] {
  const rows: IterRow[] = [];
  for (const { sessionDir, profile, sdkBranch } of iterArtifactSessions()) {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    const iterDirs = entries.filter((d) => d.isDirectory() && /^iter-\d+$/.test(d.name));
    if (iterDirs.length > 0) {
      for (const iterDir of iterDirs) {
        const iterNum = Number.parseInt(iterDir.name.slice("iter-".length), 10);
        const attemptDir = path.join(sessionDir, iterDir.name, PROBLEM_ID, "attempt-0");
        const workDir = readAttemptWorkDir(attemptDir);
        if (workDir) {
          rows.push(...gradeIteration(sessionDir, iterNum, profile, sdkBranch, workDir, meta));
        }
      }
      continue;
    }
    const attemptDir = path.join(sessionDir, PROBLEM_ID, "attempt-0");
    const workDir = readAttemptWorkDir(attemptDir);
    if (workDir) {
      rows.push(...gradeIteration(sessionDir, 0, profile, sdkBranch, workDir, meta));
    }
  }
  return rows;
}

type Agg = {
  total: number;
  canonical: number;
  attractor: number;
  neither: number;
  missing: number;
};

function aggregate(rows: IterRow[], keyOf: (r: IterRow) => string): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyOf(r);
    let agg = out.get(key);
    if (!agg) {
      agg = { total: 0, canonical: 0, attractor: 0, neither: 0, missing: 0 };
      out.set(key, agg);
    }
    agg.total++;
    if (r.fileStatus !== "ok") {
      agg.missing++;
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
  return `canonical=${pct(agg.canonical, agg.total)} (${agg.canonical}/${agg.total})  attractor=${pct(agg.attractor, agg.total)}  neither=${pct(agg.neither, agg.total)}  missing=${agg.missing}`;
}

function renderMarkdown(rows: IterRow[], meta: Meta): string {
  const out: string[] = [];
  out.push("# R2 grand-app audit — corpus aggregate");
  out.push("");
  out.push(`- problem: ${PROBLEM_ID}`);
  out.push(`- surfaces declared: ${meta.surfaces.length}`);
  out.push(`- iterations × surfaces audited: ${rows.length}`);
  const okRows = rows.filter((r) => r.fileStatus === "ok").length;
  const missingRows = rows.filter((r) => r.fileStatus !== "ok").length;
  out.push(`- rows with readable file: ${okRows} (missing/empty=${missingRows})`);
  out.push("");

  out.push("## Per-surface canonical / attractor distribution");
  out.push("");
  out.push(
    "| Surface | Profile | Total | Canonical | Attractor | Neither | Missing | TopAttractors |",
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
        `| ${surface} | ${profile} | ${agg.total} | ${pct(agg.canonical, agg.total)} (${agg.canonical}) | ${pct(agg.attractor, agg.total)} | ${pct(agg.neither, agg.total)} | ${agg.missing} | ${topAttrs || "-"} |`,
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
    "fileStatus",
    "canonicalHit",
    "attractorHit",
    "hitCanonicals",
    "hitAttractors",
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
        r.fileStatus,
        r.canonicalHit ? "1" : "0",
        r.attractorHit ? "1" : "0",
        escape(r.hitCanonicals.join("|")),
        escape(r.hitAttractors.join("|")),
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
    } else if (args[i] === "--problem-id") {
      const id = args[i + 1];
      if (!id) {
        console.error("Error: --problem-id requires a value");
        process.exit(1);
      }
      PROBLEM_ID = id;
      i++;
    }
  }

  const meta = loadMeta();
  if (!meta) {
    console.error(`No meta.json found for ${PROBLEM_ID}; nothing to audit.`);
    process.exit(1);
  }

  const rows = collectRows(meta);
  if (rows.length === 0) {
    console.error(`No ${PROBLEM_ID} artifacts found under results/artifacts/.`);
    process.exit(0);
  }

  if (csvPath) {
    fs.writeFileSync(csvPath, renderCsv(rows));
    console.error(`Wrote ${rows.length} rows to ${csvPath}`);
  }
  process.stdout.write(renderMarkdown(rows, meta));
}

main();
