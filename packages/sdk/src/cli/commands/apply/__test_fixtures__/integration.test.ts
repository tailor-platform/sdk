import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { setupInvokerMock, setupTailordbMock, setupTailorErrorsMock } from "@/utils/test/mock";
import { prepareFixtures } from "./prepare";
import type { BundledScripts } from "@/cli/commands/apply/function-registry";

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Evaluate bundled code string and return its `main` export.
 * Uses data: URL which is supported by Node.js ESM loader.
 * @param code - Bundled JavaScript code string
 * @param name - Name for error messages
 * @returns The `main` function exported by the bundle
 */
async function importFromCode(code: string, name: string): Promise<MainFunction> {
  const encoded = Buffer.from(code).toString("base64");
  const url = `data:text/javascript;base64,${encoded}`;
  const module = await import(/* @vite-ignore */ url);
  const main = module.main;
  if (typeof main !== "function") {
    throw new Error(`Expected "main" to be a function in ${name}, got ${typeof main}`);
  }
  return main;
}

describe("apply command integration tests", () => {
  let outputDir: string;
  let bundledScripts: BundledScripts;

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
    setupTailorErrorsMock();
    setupInvokerMock(null);
    const result = await prepareFixtures();
    outputDir = result.outputDir;
    bundledScripts = result.bundledScripts;
  }, 120000);

  afterAll(() => {
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    vi.useRealTimers();
  });

  test("compare directory structure", () => {
    const actualFiles = collectGeneratedFiles(outputDir).sort();

    // Plugin-generated files should exist on disk
    const pluginFiles = actualFiles.filter((f) => f === "db.ts" || f === "enums.ts");
    expect(pluginFiles.length).toBeGreaterThan(0);

    // Entry files should exist on disk (rolldown input)
    const entryFiles = actualFiles.filter((f) => f.endsWith(".entry.js"));
    expect(entryFiles.length).toBeGreaterThan(0);

    // Bundle output files should NOT exist on disk (in-memory only)
    const bundleOutputFiles = actualFiles.filter(
      (f) => f.endsWith(".js") && !f.endsWith(".entry.js"),
    );
    expect(bundleOutputFiles).toEqual([]);

    // Bundled scripts should be available in memory
    expect(bundledScripts.resolvers.size).toBeGreaterThan(0);
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
    test("resolvers/add validates input correctly - valid values", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: 4, b: 6 } })).resolves.not.toThrow();
    });

    test("resolvers/add validates input correctly - negative value throws TailorErrors", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: -1, b: 5 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toContainEqual({
          message: "Value must be non-negative",
          path: ["a"],
        });
        return true;
      });
    });

    test("resolvers/add validates input correctly - value >= 10 throws TailorErrors", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: 10, b: 5 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toContainEqual({
          message: "Value must be less than 10",
          path: ["a"],
        });
        return true;
      });
    });

    test("resolvers/add validates input correctly - b negative throws TailorErrors", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: 5, b: -2 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toContainEqual({
          message: "Value must be non-negative",
          path: ["b"],
        });
        return true;
      });
    });

    test("resolvers/add validates input correctly - b >= 10 throws TailorErrors", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: 5, b: 15 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toContainEqual({
          message: "Value must be less than 10",
          path: ["b"],
        });
        return true;
      });
    });

    test("resolvers/add validates input correctly - multiple errors", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: -1, b: -2 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toEqual([
          { message: "Value must be non-negative", path: ["a"] },
          { message: "Value must be non-negative", path: ["b"] },
        ]);
        return true;
      });
    });

    test("resolvers/add validates input correctly - both >= 10", async () => {
      const code = bundledScripts.resolvers.get("add");
      expect(code).toBeDefined();
      const main = await importFromCode(code!, "resolvers/add");
      await expect(main({ input: { a: 10, b: 15 } })).rejects.toSatisfy((error: Error) => {
        const parsed = JSON.parse(error.message.replace("TailorErrors: ", ""));
        expect(parsed.errors).toEqual([
          { message: "Value must be less than 10", path: ["a"] },
          { message: "Value must be less than 10", path: ["b"] },
        ]);
        return true;
      });
    });
  });
});
