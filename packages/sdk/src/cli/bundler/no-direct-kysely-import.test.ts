import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it } from "vitest";

const SDK_ROOT = path.resolve(__dirname, "..", "..", "..");

function findBundlerFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findBundlerFiles(fullPath));
    } else if (/bundl.*\.ts$/.test(entry.name) && !entry.name.includes(".test.")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("bundler templates must not import kysely directly", () => {
  it("should use @tailor-platform/sdk/kysely instead of kysely or function-kysely-tailordb", () => {
    const files = findBundlerFiles(path.join(SDK_ROOT, "src", "cli"));

    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = file.replace(/.*packages\/sdk\//, "");

      if (/from\s+["']kysely["']/.test(content)) {
        violations.push(`${relativePath}: direct import from "kysely" found`);
      }
      if (/from\s+["']@tailor-platform\/function-kysely-tailordb["']/.test(content)) {
        violations.push(
          `${relativePath}: direct import from "@tailor-platform/function-kysely-tailordb" found`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
