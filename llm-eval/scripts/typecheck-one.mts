#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { typecheckCode } from "../src/checks/typecheck.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

const path = process.argv[2];
const variant = process.argv[3] ?? "current";
if (!path) {
  console.error("usage: tsx scripts/typecheck-one.mts <file.ts> [variant]");
  process.exit(1);
}

const code = readFileSync(path, "utf8");
const sigs = await typecheckCode(code, "manual", resolveVariantPath(variant));
const s = sigs[0];
if (!s || s.type !== "typecheck_failure") {
  console.log("no diagnostics");
  process.exit(0);
}
for (let i = 0; i < s.tsCodes.length; i++) {
  console.log(s.tsCodes[i], "|", s.messages[i].split("\n")[0].slice(0, 240));
}
