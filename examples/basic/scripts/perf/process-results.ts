import * as readline from "node:readline";
import { counts } from "./generate";

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const tsImplLabel = process.env.BENCHMARK_TS_IMPL_LABEL;
  if (!tsImplLabel) {
    throw new Error("BENCHMARK_TS_IMPL_LABEL must be set");
  }

  const toKebabCase = (str: string): string => {
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .replace(/\//g, "-")
      .toLowerCase();
  };

  const toTitleCase = (str: string): string => {
    return str
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const metrics: {
    key: string;
    name: string;
    value: number;
    unit: string;
  }[] = [];

  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    const [key, value] = line.split(":");
    if (!key || !value) {
      return;
    }

    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    // Extract number and unit from value
    const match = /^(\d+(\.\d+)?)([a-zA-Z]*)$/.exec(trimmedValue);
    if (match) {
      const numValue = parseFloat(match[1]);
      const unit = match[3] || "";
      const kebabKey = toKebabCase(trimmedKey);
      const titleName = toTitleCase(kebabKey);
      metrics.push({ key: kebabKey, name: titleName, value: numValue, unit });
    }
  });

  rl.on("close", () => {
    // Filter metrics to only include specific items
    const allowedKeys = new Set([
      "types",
      "instantiations",
      "check-time",
      "total-time",
    ]);
    const filteredMetrics = metrics.filter((metric) =>
      allowedKeys.has(metric.key),
    );

    // Add numeric prefix for ordering
    const orderMap: Record<string, string> = {
      full: "1-diagnostics-full",
      types: "2-diagnostics-types",
      resolvers: "3-diagnostics-resolvers",
      executors: "4-diagnostics-executors",
    };

    const result = {
      key: orderMap[tsImplLabel] || `diagnostics-${tsImplLabel}`,
      name: `TypeScript Compiler Diagnostics (${tsImplLabel in counts ? `${counts[tsImplLabel].toString()} ` : ""}${tsImplLabel})`,
      metrics: filteredMetrics,
    };
    console.log(JSON.stringify(result, null, 2));
  });
}

main();
