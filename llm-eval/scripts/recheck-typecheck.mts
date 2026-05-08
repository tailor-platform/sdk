#!/usr/bin/env tsx
/**
 * Re-runs the `typecheck` check against the generatedCode of cells in an
 * existing matrix.json, without re-querying the LLM. Used to verify whether
 * enabling typecheck on a probe would have caught hallucinations that the
 * other checks missed.
 *
 * Usage: tsx scripts/recheck-typecheck.mts <matrix.json> [pattern]
 *   pattern: substring filter on cell.probe (default: all)
 */
import { readFile } from "node:fs/promises";
import { typecheckCode } from "../src/checks/typecheck.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

const path = process.argv[2];
const pattern = process.argv[3] ?? "";
if (!path) {
  console.error("usage: tsx scripts/recheck-typecheck.mts <matrix.json> [pattern]");
  process.exit(1);
}

const data = JSON.parse(await readFile(path, "utf8"));
const cells = data.cells.filter((c: { probe: string }) => c.probe.includes(pattern));

console.log(`Cells: ${cells.length} (filter='${pattern}')\n`);

let totalNewFails = 0;
for (const c of cells) {
  if (!c.generatedCode) continue;
  let variantDist: string;
  try {
    variantDist = resolveVariantPath(c.variant);
  } catch {
    console.log(`[skip] missing variant ${c.variant}`);
    continue;
  }
  const id = `recheck__${c.probe}__${c.condition.preset}__${c.variant}__r${c.repeatIndex ?? 0}`;
  const sigs = await typecheckCode(c.generatedCode, id, variantDist);
  if (sigs.length === 0) continue;
  totalNewFails++;
  const codes = (sigs[0] as { tsCodes: string[] }).tsCodes.join(",");
  const msgs = (sigs[0] as { messages: string[] }).messages
    .map((m: string) => m.split("\n")[0])
    .filter((m: string, i: number, a: string[]) => a.indexOf(m) === i)
    .slice(0, 3)
    .join(" | ");
  const wasPass = c.passed ? "PASS" : `FAIL(${c.signals.length})`;
  console.log(
    `[${wasPass}→FAIL+tc] ${c.probe} | ${c.model} | ${c.condition.preset} | ${c.variant}`,
  );
  console.log(`   tsCodes: ${codes}`);
  console.log(`   msgs:    ${msgs.slice(0, 200)}`);
}
console.log(`\nNew typecheck fails: ${totalNewFails}/${cells.length}`);
