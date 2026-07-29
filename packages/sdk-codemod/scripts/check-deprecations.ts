#!/usr/bin/env tsx
import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PENDING_SINCE, checkDeprecationTags } from "../src/deprecation-tags";
import { allCodemods } from "../src/registry";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const sdkRoot = resolve(repoRoot, "packages/sdk");

const sdkPackageJson = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf-8")) as {
  version: string;
};
const codemodIds = new Set(allCodemods.map((codemod) => codemod.id));

const isTestFile = (file: string): boolean =>
  file.endsWith(".test.ts") ||
  file.endsWith(".test-d.ts") ||
  file.endsWith(".spec.ts") ||
  file.includes("__test_fixtures__");

const failures: string[] = [];
for (const file of globSync("src/**/*.ts", { cwd: sdkRoot }).toSorted()) {
  if (isTestFile(file)) continue;
  const absolute = resolve(sdkRoot, file);
  const problems = checkDeprecationTags(readFileSync(absolute, "utf-8"), {
    codemodIds,
    currentVersion: sdkPackageJson.version,
  });
  for (const problem of problems) {
    failures.push(`${relative(repoRoot, absolute)}:${problem.line}: ${problem.message}`);
  }
}

if (failures.length === 0) {
  process.exit(0);
}

process.stderr.write(
  `Found ${failures.length} problem(s) with @deprecated tags in packages/sdk/src.\n` +
    "Every deprecation states the version it shipped in and the codemod that migrates callers:\n" +
    `  @deprecated since ${PENDING_SINCE} — use {@link newApi} instead. codemod: v2/old-to-new\n` +
    "See .agents/rules/deprecation.md.\n\n",
);
for (const failure of failures) {
  process.stderr.write(`  ${failure}\n`);
}
process.exit(1);
