#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { typecheckCode } from "../src/checks/typecheck.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

const code = readFileSync(process.argv[2], "utf8");
const variantDist = resolveVariantPath("current");

// warmup
await typecheckCode(code, "warmup", variantDist);

const N = Number(process.argv[3] ?? 20);
const start = performance.now();
for (let i = 0; i < N; i++) {
  await typecheckCode(code, `bench-${i}`, variantDist);
}
const elapsed = performance.now() - start;
console.log(
  `typecheck: ${N} runs in ${elapsed.toFixed(0)}ms (avg ${(elapsed / N).toFixed(0)}ms/cell)`,
);
