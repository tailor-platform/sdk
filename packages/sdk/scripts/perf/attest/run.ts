import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compareToBase,
  extractBenchSources,
  parseBenchOutput,
  renderChanges,
  toOctocovMetrics,
} from "./report";

const benchFile = path.resolve(import.meta.dirname, "type-instantiations.bench.ts");
const baseOutputIndex = process.argv.indexOf("--base-output");
const baseOutputFile = baseOutputIndex === -1 ? undefined : process.argv[baseOutputIndex + 1];

const bench = spawnSync(
  process.execPath,
  ["--experimental-strip-types", benchFile, "--benchErrorOnThresholdExceeded", "false"],
  {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  },
);
process.stdout.write(bench.stdout);

const results = parseBenchOutput(bench.stdout);
const comparedResults = baseOutputFile
  ? compareToBase(results, parseBenchOutput(readFileSync(baseOutputFile, "utf8")))
  : results;
writeFileSync("attest-metrics.json", JSON.stringify(toOctocovMetrics(results), null, 2));
writeFileSync(
  "attest-changes.md",
  renderChanges(comparedResults, extractBenchSources(readFileSync(benchFile, "utf8"))),
);

process.exit(bench.status ?? 1);
