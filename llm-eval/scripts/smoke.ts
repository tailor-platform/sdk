/**
 * Offline smoke run: drives the full matrix using MockProvider responses
 * recorded for each preset. Useful to demonstrate the harness without API
 * keys and to keep `reports/` populated for documentation.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_PRESETS, makeCondition } from "../src/conditions/presets.ts";
import { loadProbesFromDir } from "../src/probe/load.ts";
import { MockProvider } from "../src/provider/mock.ts";
import { writeCutoffBacklog } from "../src/report/cutoff.ts";
import { writeDesignBacklog } from "../src/report/design.ts";
import { writeMatrixJson } from "../src/report/matrix-json.ts";
import { writeVibeMap } from "../src/report/vibe.ts";
import { runMatrix } from "../src/runner/matrix.ts";

const here = resolve(fileURLToPath(import.meta.url), "..");
const PKG_ROOT = resolve(here, "..");

async function main(): Promise<void> {
  const probes = await loadProbesFromDir(resolve(PKG_ROOT, "probes"));

  // Two mock models. The fallback responses simulate "what an untrained
  // LLM might write" — wrong factory names, missing await — and the
  // keyed responses simulate "after seeing JSDoc, model self-corrects".
  const claude = new MockProvider({
    id: "mock:claude",
    fallback: `\`\`\`ts
import { db, defineWorkflow } from "@tailor-platform/sdk";

const User = db.defineType({ name: "string", age: "int?", email: "string!" });

defineWorkflow({
  name: "daily",
  schedule: "0 9 * * *",
  run: async () => {
    console.log("Hello, world");
  },
});
\`\`\``,
    responses: {
      "[L2] Type signatures": `\`\`\`ts
import { db, t, createWorkflow, createWorkflowJob, scheduleTrigger } from "@tailor-platform/sdk";

export const User = db.type("User", {
  name: t.string(),
  age: t.int().optional(),
  email: t.string().unique(),
});

export const mainJob = createWorkflowJob({
  name: "main",
  trigger: scheduleTrigger({ cron: "0 9 * * *" }),
  run: async () => {
    console.log("Hello, world");
  },
});

export default createWorkflow({
  name: "daily",
  jobs: [mainJob],
});
\`\`\``,
    },
  });

  const codex = new MockProvider({
    id: "mock:codex",
    fallback: `\`\`\`ts
import { defineWorkflow, db } from "@tailor-platform/sdk";

const User = db.defineType({ name: "string!", age: "int?", email: "string!u" });

defineWorkflow({ schedule: "@daily", main: () => console.log("hi") });
\`\`\``,
    responses: {
      "[L2] Type signatures": `\`\`\`ts
import { db, t, createWorkflow, createWorkflowJob, scheduleTrigger } from "@tailor-platform/sdk";

export const User = db.type("User", {
  name: t.string(),
  age: t.int().optional(),
  email: t.string().unique(),
});

export const mainJob = createWorkflowJob({
  name: "main",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  run: async () => { console.log("Hello, world"); },
});

export default createWorkflow({ name: "daily", jobs: [mainJob] });
\`\`\``,
    },
  });

  const conditions = ALL_PRESETS.map(makeCondition);

  const result = await runMatrix({
    probes,
    providers: [claude, codex],
    conditions,
    variants: ["current"],
    concurrency: 4,
    onCell: (c) => {
      const status = c.passed ? "PASS" : `FAIL(${c.signals.length})`;
      console.log(
        `  [${status}] ${c.probe} | ${c.model} | ${c.condition.preset}` +
          (c.vibe ? ` | vibe=${c.vibe.distance.toFixed(2)}` : ""),
      );
    },
  });

  const outDir = resolve(PKG_ROOT, "reports", "smoke");
  await writeMatrixJson(`${outDir}/matrix.json`, result.cells);
  await writeCutoffBacklog(`${outDir}/cutoff-backlog.md`, result.cells);
  await writeDesignBacklog(`${outDir}/design-backlog.md`, result.cells);
  await writeVibeMap(`${outDir}/vibe-map.md`, result.cells);

  const passed = result.cells.filter((c) => c.passed).length;
  console.log(`\nDone. ${passed}/${result.cells.length} cells passed.`);
  console.log(`Reports written to ${outDir}`);

  // Brief tag summary
  const tagCounts = new Map<string, number>();
  for (const c of result.cells) {
    for (const tag of c.tags) {
      tagCounts.set(tag.kind, (tagCounts.get(tag.kind) ?? 0) + 1);
    }
  }
  console.log("Tag counts:", Object.fromEntries(tagCounts));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
