#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.join(__dirname, "../packages/sdk");
const coverageSummaryPath = path.join(sdkDir, "coverage/coverage-summary.json");

async function main() {
  if (!fs.existsSync(coverageSummaryPath)) {
    console.error(
      `Error: coverage summary not found at ${coverageSummaryPath}`,
    );
    console.error("Please run 'pnpm test:coverage' first");
    process.exit(1);
  }

  const summaryRaw = fs.readFileSync(coverageSummaryPath, "utf8");
  const summary = JSON.parse(summaryRaw);

  const total = summary.total;
  if (!total) {
    console.error(
      "Error: coverage summary does not contain a 'total' section.",
    );
    process.exit(1);
  }

  const getPct = (section) =>
    typeof section?.pct === "number" ? section.pct : 0;

  const output = {
    key: "sdk-coverage",
    name: "SDK Test Coverage",
    metrics: [
      {
        key: "statements",
        value: getPct(total.statements),
        unit: "%",
      },
      {
        key: "branches",
        value: getPct(total.branches),
        unit: "%",
      },
      {
        key: "functions",
        value: getPct(total.functions),
        unit: "%",
      },
      {
        key: "lines",
        value: getPct(total.lines),
        unit: "%",
      },
    ],
  };

  const outputPath = path.join(sdkDir, "coverage-metrics.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
}

main();
