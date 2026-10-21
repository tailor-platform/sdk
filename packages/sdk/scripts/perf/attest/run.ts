import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compareToBase,
  extractBaselines,
  extractBenchSources,
  renderChanges,
  toOctocovMetrics,
} from "./report";

const benchRelativeDir = "scripts/perf/attest";
const benchDir = import.meta.dirname;
const benchFiles = readdirSync(benchDir)
  .filter((file) => file.endsWith(".bench.ts"))
  .toSorted();

const baseRootIndex = process.argv.indexOf("--base-root");
const baseRoot = baseRootIndex === -1 ? undefined : process.argv[baseRootIndex + 1];

const measure = (root: string, formatCmd: string | undefined) => {
  let failed = false;
  const counts: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const file of benchFiles) {
    const benchFile = path.join(root, benchRelativeDir, file);
    const run = spawnSync(process.execPath, ["--experimental-strip-types", benchFile], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        ATTEST_updateSnapshots: "1",
        ...(formatCmd
          ? { ATTEST_formatCmd: JSON.stringify(formatCmd) }
          : { ATTEST_shouldFormat: "false" }),
        ATTEST_benchErrorOnThresholdExceeded: "false",
      },
    });
    if (run.status !== 0) failed = true;
    const source = readFileSync(benchFile, "utf8");
    Object.assign(counts, extractBaselines(source));
    Object.assign(sources, extractBenchSources(source));
  }
  return { failed, counts, sources };
};

const head = measure(process.cwd(), "pnpm exec oxfmt --write");

let changes = "";
if (baseRoot) {
  mkdirSync(path.join(baseRoot, benchRelativeDir), { recursive: true });
  for (const file of benchFiles) {
    copyFileSync(path.join(benchDir, file), path.join(baseRoot, benchRelativeDir, file));
  }
  const base = measure(baseRoot, undefined);
  if (!base.failed) changes = renderChanges(compareToBase(head.counts, base.counts), head.sources);
}

writeFileSync("attest-metrics.json", JSON.stringify(toOctocovMetrics(head.counts), null, 2));
writeFileSync("attest-changes.md", changes);

process.exit(head.failed ? 1 : 0);
