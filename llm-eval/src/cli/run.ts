import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ALL_PRESETS, makeCondition } from "../conditions/presets.ts";
import { loadProbesFromDir, loadProbe } from "../probe/load.ts";
import { ClaudeProvider } from "../provider/claude.ts";
import { ClaudeCliProvider } from "../provider/claude-cli.ts";
import { CodexProvider } from "../provider/codex.ts";
import { CodexCliProvider } from "../provider/codex-cli.ts";
import { GeminiProvider } from "../provider/gemini.ts";
import { GeminiCliProvider } from "../provider/gemini-cli.ts";
import type { Provider } from "../provider/types.ts";
import { writeCutoffBacklog } from "../report/cutoff.ts";
import { writeDesignBacklog } from "../report/design.ts";
import { writeMatrixJson } from "../report/matrix-json.ts";
import { writeVariantsReport } from "../report/variants.ts";
import { writeVibeMap } from "../report/vibe.ts";
import { runMatrix } from "../runner/matrix.ts";
import type { DocsCondition, DocsPreset, Probe } from "../types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "../..");

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Provider spec grammar:
 *   - `claude` / `codex` / `gemini` → local CLI (OAuth, no API key)
 *   - `claude:<model>` etc. → CLI with explicit model override
 *   - `claude-api` / `codex-api` / `gemini-api` → API-key based SDK clients
 *   - `claude-api:<model>` etc. → API-key client with model override
 */
function buildProvider(spec: string): Provider {
  if (spec === "claude") return new ClaudeCliProvider();
  if (spec === "codex") return new CodexCliProvider();
  if (spec === "gemini") return new GeminiCliProvider();
  if (spec.startsWith("claude:"))
    return new ClaudeCliProvider({ model: spec.slice("claude:".length) });
  if (spec.startsWith("codex:"))
    return new CodexCliProvider({ model: spec.slice("codex:".length) });
  if (spec.startsWith("gemini:"))
    return new GeminiCliProvider({ model: spec.slice("gemini:".length) });

  if (spec === "claude-api") return new ClaudeProvider();
  if (spec === "codex-api") return new CodexProvider();
  if (spec === "gemini-api") return new GeminiProvider();
  if (spec.startsWith("claude-api:"))
    return new ClaudeProvider({ model: spec.slice("claude-api:".length) });
  if (spec.startsWith("codex-api:"))
    return new CodexProvider({ model: spec.slice("codex-api:".length) });
  if (spec.startsWith("gemini-api:"))
    return new GeminiProvider({ model: spec.slice("gemini-api:".length) });

  throw new Error(`Unknown provider spec: ${spec}`);
}

async function loadProbes(probeArg: string): Promise<Probe[]> {
  const root = resolve(PKG_ROOT, "probes");
  if (!probeArg || probeArg === "all") {
    return loadProbesFromDir(root);
  }
  if (probeArg.endsWith(".yaml") || probeArg.endsWith(".yml")) {
    return [await loadProbe(resolve(probeArg))];
  }
  // Comma-separated list; each token is either an exact id or a `prefix*` glob.
  const tokens = probeArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const all = await loadProbesFromDir(root);
  const seen = new Set<string>();
  const out: Probe[] = [];
  for (const tok of tokens) {
    const matches = tok.endsWith("*")
      ? all.filter((p) => p.id.startsWith(tok.slice(0, -1)))
      : all.filter((p) => p.id === tok);
    if (matches.length === 0) throw new Error(`No probe matched: ${tok}`);
    for (const p of matches) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      probe: { type: "string", default: "all" },
      models: { type: "string", default: "claude" },
      conditions: { type: "string", default: ALL_PRESETS.join(",") },
      variants: { type: "string", default: "current" },
      concurrency: { type: "string", default: "4" },
      repeats: { type: "string", default: "1" },
      out: { type: "string", default: `reports/${new Date().toISOString().replace(/[:.]/g, "-")}` },
    },
  });

  const probes = await loadProbes(values.probe ?? "all");
  const providers = parseList(values.models, ["claude"]).map(buildProvider);
  const conditionSpecs = parseList(values.conditions, [...ALL_PRESETS]) as DocsPreset[];
  const conditions: DocsCondition[] = conditionSpecs.map(makeCondition);
  const variants = parseList(values.variants, ["current"]);
  const concurrency = Number(values.concurrency ?? 4);
  const repeats = Math.max(1, Number(values.repeats ?? 1));
  const outDir = resolve(PKG_ROOT, values.out!);
  await mkdir(outDir, { recursive: true });

  console.error(
    `eval: ${probes.length} probe(s) × ${providers.length} model(s) × ${conditions.length} cond × ${variants.length} variant(s) × ${repeats} repeat(s) (concurrency=${concurrency})`,
  );

  const result = await runMatrix({
    probes,
    providers,
    conditions,
    variants,
    concurrency,
    repeats,
    onCell: (cell) => {
      const status = cell.error ? "ERROR" : cell.passed ? "PASS" : `FAIL(${cell.signals.length})`;
      const suffix = cell.error
        ? ` | err=${cell.error.split("\n")[0].slice(0, 80)}`
        : cell.vibe
          ? ` | vibe=${cell.vibe.distance.toFixed(2)}`
          : "";
      const repeatTag = repeats > 1 ? ` #${cell.repeatIndex}` : "";
      console.error(
        `  [${status}] ${cell.probe} | ${cell.model} | ${cell.condition.preset} | ${cell.variant}${repeatTag}${suffix}`,
      );
    },
  });

  await writeMatrixJson(join(outDir, "matrix.json"), result.cells);
  await writeCutoffBacklog(join(outDir, "cutoff-backlog.md"), result.cells);
  await writeDesignBacklog(join(outDir, "design-backlog.md"), result.cells);
  await writeVibeMap(join(outDir, "vibe-map.md"), result.cells);
  await writeVariantsReport(join(outDir, "variants.md"), result.cells);

  const passed = result.cells.filter((c) => c.passed).length;
  console.error(`done. ${passed}/${result.cells.length} cells passed. Reports in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
