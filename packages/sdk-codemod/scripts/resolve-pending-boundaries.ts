#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePendingBoundaries } from "../src/resolve-pending-boundaries";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(scriptDir, "../src/registry.ts");
const sdkPackageJsonPath = resolve(scriptDir, "../../sdk/package.json");

const sdkPackageJson = JSON.parse(await readFile(sdkPackageJsonPath, "utf-8"));
const source = await readFile(registryPath, "utf-8");
const result = resolvePendingBoundaries(source, sdkPackageJson.version);

if (!result.changed) {
  process.stderr.write("No pending codemod boundaries to resolve.\n");
  process.exit(0);
}

await writeFile(registryPath, result.source, "utf-8");
process.stderr.write(
  `Resolved V2_NEXT_PENDING to ${result.constantName} (${sdkPackageJson.version}).\n`,
);
