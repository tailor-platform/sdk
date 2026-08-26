#!/usr/bin/env tsx
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PENDING_SINCE, SDK_SOURCE_GLOB, resolvePendingSince } from "../src/deprecation-tags";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const sdkRoot = resolve(repoRoot, "packages/sdk");

const sdkPackageJson = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf-8")) as {
  version: string;
};

const resolved: string[] = [];
for (const file of globSync(SDK_SOURCE_GLOB, { cwd: sdkRoot }).toSorted()) {
  const absolute = resolve(sdkRoot, file);
  const result = resolvePendingSince(
    readFileSync(absolute, "utf-8"),
    sdkPackageJson.version,
    absolute,
  );
  if (!result.changed) continue;
  writeFileSync(absolute, result.source, "utf-8");
  resolved.push(relative(repoRoot, absolute));
}

if (resolved.length === 0) {
  process.stderr.write(`No pending @deprecated ${PENDING_SINCE} markers to resolve.\n`);
  process.exit(0);
}

process.stderr.write(
  `Resolved @deprecated ${PENDING_SINCE} to ${sdkPackageJson.version} in ${resolved.length} file(s):\n`,
);
for (const file of resolved) {
  process.stderr.write(`  ${file}\n`);
}
