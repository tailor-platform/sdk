import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { setupTailordbMock, createImportMain } from "@/utils/test/mock";
import { prepareFixtures } from "./prepare";

describe("apply command integration tests", () => {
  let outputDir: string;
  let importMain: ReturnType<typeof createImportMain>;

  const fixedSystemTime = new Date("2025-10-06T12:34:56.000Z");

  const collectGeneratedFiles = (rootDir: string): string[] => {
    const files: string[] = [];
    const traverse = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".DS_Store" || entry.name === "cache") continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else {
          files.push(path.relative(rootDir, fullPath).split(path.sep).join("/"));
        }
      }
    };
    traverse(rootDir);
    return files;
  };

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedSystemTime);
    setupTailordbMock();
    outputDir = await prepareFixtures();
    importMain = createImportMain(outputDir);
  }, 120000);

  afterAll(() => {
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    vi.useRealTimers();
  });

  test("compare directory structure", () => {
    const actualFiles = collectGeneratedFiles(outputDir).sort();

    // Verify expected file categories exist
    const resolverFiles = actualFiles.filter((f) => f.startsWith("resolvers/"));
    const executorFiles = actualFiles.filter((f) => f.startsWith("executors/"));
    const workflowFiles = actualFiles.filter((f) => f.startsWith("workflow-jobs/"));
    const pluginFiles = actualFiles.filter((f) => f === "db.ts" || f === "enums.ts");

    expect(resolverFiles.length).toBeGreaterThan(0);
    expect(executorFiles.length).toBeGreaterThan(0);
    expect(workflowFiles.length).toBeGreaterThan(0);
    expect(pluginFiles.length).toBeGreaterThan(0);

    // Each bundled file should have .js, .js.map, and .entry.js
    for (const prefix of ["resolvers/add", "resolvers/showInfo"]) {
      expect(actualFiles).toContain(`${prefix}.js`);
      expect(actualFiles).toContain(`${prefix}.js.map`);
      expect(actualFiles).toContain(`${prefix}.entry.js`);
    }
  });

  test("generated ts files exist and are non-empty", () => {
    for (const file of ["db.ts", "enums.ts"]) {
      const filePath = path.join(outputDir, file);
      expect(fs.existsSync(filePath), `${file} should exist`).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.length, `${file} should not be empty`).toBeGreaterThan(0);
    }
  });

  describe("validation", () => {
    test("resolvers/add.js validates input correctly - valid values", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: 4, b: 6 } })).resolves.not.toThrow();
    });

    test("resolvers/add.js validates input correctly - negative value throws error", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: -1, b: 5 } })).rejects.toThrow(
        "a: Value must be non-negative",
      );
    });

    test("resolvers/add.js validates input correctly - value >= 10 throws error", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: 10, b: 5 } })).rejects.toThrow(
        "a: Value must be less than 10",
      );
    });

    test("resolvers/add.js validates input correctly - b negative throws error", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: 5, b: -2 } })).rejects.toThrow(
        "b: Value must be non-negative",
      );
    });

    test("resolvers/add.js validates input correctly - b >= 10 throws error", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: 5, b: 15 } })).rejects.toThrow(
        "b: Value must be less than 10",
      );
    });

    test("resolvers/add.js validates input correctly - multiple errors", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: -1, b: -2 } })).rejects.toThrow(
        [
          "Failed to input validation:",
          "  a: Value must be non-negative",
          "  b: Value must be non-negative",
        ].join("\n"),
      );
    });

    test("resolvers/add.js validates input correctly - both >= 10", async () => {
      const main = await importMain("resolvers/add.js");
      await expect(main({ input: { a: 10, b: 15 } })).rejects.toThrow(
        [
          "Failed to input validation:",
          "  a: Value must be less than 10",
          "  b: Value must be less than 10",
        ].join("\n"),
      );
    });
  });
});
