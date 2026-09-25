#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveNextReleaseUntil,
  resolvePendingBoundaries,
} from "../src/resolve-pending-boundaries";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(scriptDir, "../src/registry.ts");
const sdkPackageJsonPath = resolve(scriptDir, "../../sdk/package.json");

const sdkPackageJson = JSON.parse(await readFile(sdkPackageJsonPath, "utf-8"));
const source = await readFile(registryPath, "utf-8");
const prerelease = resolvePendingBoundaries(source, sdkPackageJson.version);
const stable = resolveNextReleaseUntil(
  prerelease.source,
  sdkPackageJson.version,
  process.env.PREVIOUS_SDK_VERSION,
);

if (!prerelease.changed && !stable.changed) {
  process.stderr.write("No pending codemod boundaries to resolve.\n");
  process.exit(0);
}

await writeFile(registryPath, stable.source, "utf-8");
if (prerelease.changed) {
  process.stderr.write(
    `Resolved V2_NEXT_PENDING to ${prerelease.constantName} (${sdkPackageJson.version}).\n`,
  );
}
if (stable.changed) {
  process.stderr.write(`Resolved until: NEXT_RELEASE to ${sdkPackageJson.version}.\n`);
}
