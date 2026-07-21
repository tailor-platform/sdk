import { readFileSync } from "node:fs";
import * as path from "pathe";
import type { SeedData } from "@tailor-platform/sdk/cli";

/**
 * Load seed rows from `<dataDir>/<typeName>.jsonl` for each type. Missing
 * files load as empty lists.
 * @param dataDir - Directory containing the JSONL files
 * @param typeNames - Type names to load
 * @returns Seed rows per type
 */
export function loadSeedData(dataDir: string, typeNames: string[]): SeedData {
  const data: SeedData = {};
  for (const typeName of typeNames) {
    const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
    let content: string;
    try {
      content = readFileSync(jsonlPath, "utf-8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        data[typeName] = [];
        continue;
      }
      throw error;
    }
    data[typeName] = content
      ? content.split("\n").map((line, index) => {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid JSON in ${jsonlPath} at line ${index + 1}: ${message}`, {
              cause: error,
            });
          }
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(
              `Invalid seed row in ${jsonlPath} at line ${index + 1}: expected a JSON object`,
            );
          }
          return value as SeedData[string][number];
        })
      : [];
  }
  return data;
}
