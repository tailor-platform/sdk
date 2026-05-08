#!/usr/bin/env node
/**
 * Reads matrix.json from the L3/L4 placement experiment and tabulates which
 * symbol family (create* vs define*) the LLM produced per (variant, condition).
 *
 * Usage: tsx scripts/analyze-naming.mjs reports/naming-l3l4/matrix.json
 */
import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/analyze-naming.mjs <matrix.json>");
  process.exit(1);
}

const data = JSON.parse(await readFile(path, "utf8"));

const PAIRS = [
  ["createWorkflow", "defineWorkflow"],
  ["createWorkflowJob", "defineJob"],
  ["createResolver", "defineResolver"],
  ["createExecutor", "defineExecutor"],
  ["recordCreatedTrigger", "defineRecordTrigger"], // both possible inventions
  ["createWaitPoints", "defineWaitPoints"],
];

function countOccurrences(code, sym) {
  const re = new RegExp("\\b" + sym + "\\b", "g");
  const m = (code || "").match(re);
  return m ? m.length : 0;
}

// Group cells by variant|preset
const groups = new Map();
for (const cell of data.cells) {
  const key = `${cell.variant}|${cell.condition.preset}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(cell);
}

// For each (variant, preset), aggregate symbol counts across all cells in that bucket.
const variants = [...new Set(data.cells.map((c) => c.variant))].sort();
const presets = [...new Set(data.cells.map((c) => c.condition.preset))];
const presetOrder = ["bare", "jsdoc", "docsOnly", "skillsOnly", "inPackage", "full", "predicted"];
presets.sort((a, b) => presetOrder.indexOf(a) - presetOrder.indexOf(b));

console.log(`Cells loaded: ${data.cells.length}`);
console.log(`Variants: ${variants.join(", ")}`);
console.log(`Presets:  ${presets.join(", ")}\n`);

for (const [createSym, defineSym] of PAIRS) {
  console.log(`\n## ${createSym} vs ${defineSym}`);
  console.log("| variant | " + presets.map((p) => p.padEnd(10)).join(" | ") + " |");
  console.log("| --- | " + presets.map(() => "---".padEnd(10)).join(" | ") + " |");
  for (const variant of variants) {
    const cells = ` | ${variant.padEnd(18)}`;
    const row = [];
    for (const preset of presets) {
      const bucket = groups.get(`${variant}|${preset}`) ?? [];
      let cCount = 0;
      let dCount = 0;
      for (const cell of bucket) {
        cCount += countOccurrences(cell.generatedCode, createSym);
        dCount += countOccurrences(cell.generatedCode, defineSym);
      }
      row.push(`${cCount}/${dCount}`.padEnd(10));
    }
    console.log(`| ${variant.padEnd(18)} | ${row.join(" | ")} |`);
  }
  console.log(`(format: ${createSym}_count/${defineSym}_count, summed across probes×repeats)`);
}

// Pass/fail summary per (variant, preset)
console.log("\n\n## Signals (median across repeats per probe, summed)");
console.log("| variant | " + presets.map((p) => p.padEnd(10)).join(" | ") + " |");
console.log("| --- | " + presets.map(() => "---".padEnd(10)).join(" | ") + " |");

for (const variant of variants) {
  const row = [];
  for (const preset of presets) {
    const bucket = groups.get(`${variant}|${preset}`) ?? [];
    // Group by probe within the bucket
    const probeGroups = new Map();
    for (const cell of bucket) {
      if (!probeGroups.has(cell.probe)) probeGroups.set(cell.probe, []);
      probeGroups.get(cell.probe).push(cell);
    }
    let totalMedian = 0;
    for (const [, repeats] of probeGroups) {
      const counts = repeats.map((c) => c.signals.length).sort((a, b) => a - b);
      const mid = Math.floor(counts.length / 2);
      const m = counts.length % 2 === 0 ? (counts[mid - 1] + counts[mid]) / 2 : counts[mid];
      totalMedian += m;
    }
    row.push(`${totalMedian}`.padEnd(10));
  }
  console.log(`| ${variant.padEnd(18)} | ${row.join(" | ")} |`);
}
