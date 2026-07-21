import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { describe, expect, test, aroundEach, aroundAll, vi } from "vitest";
import { bundleMigrationScript } from "./bundler";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");
const DB_TS = `export type Transaction = any;\n`;
const DB_TS_WITH_CONTEXT = `${DB_TS}export type MigrationContext = { env: Record<string, string | number | boolean> };\n`;

describe("migration-bundler", () => {
  let testDir: string;

  aroundAll(async (runSuite) => {
    await runSuite();
    // Clean up environment variable
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  aroundEach(async (runTest) => {
    testDir = path.join(
      TEST_BUNDLER_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    // Set TAILOR_SDK_OUTPUT_DIR to testDir so bundled output goes into test directory
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
    await runTest();
  });

  function writeMigration(
    body: string,
    { withContext = false }: { withContext?: boolean } = {},
  ): string {
    const scriptPath = path.join(testDir, "migrate.ts");
    const signature = withContext
      ? "main(trx: Transaction, { env }: MigrationContext): Promise<void>"
      : "main(trx: Transaction): Promise<void>";
    fs.writeFileSync(
      scriptPath,
      `import type { Transaction${withContext ? ", MigrationContext" : ""} } from "./db";\nexport async function ${signature} {\n${body}\n}\n`,
    );
    fs.writeFileSync(path.join(testDir, "db.ts"), withContext ? DB_TS_WITH_CONTEXT : DB_TS);
    return scriptPath;
  }

  describe("bundleMigrationScript", () => {
    test("returns correct namespace and migration number", async () => {
      const scriptPath = writeMigration("  // Migration logic");
      const result = await bundleMigrationScript(scriptPath, "test-namespace", 5);

      expect(result.namespace).toBe("test-namespace");
      expect(result.migrationNumber).toBe(5);
      expect(typeof result.bundledCode).toBe("string");
    });

    test("resolves tsconfig from baseDir, defaulting to the migration script's directory", async () => {
      vi.mocked(resolveTSConfig).mockClear();
      const scriptPath = writeMigration("  // Migration logic");
      await bundleMigrationScript(scriptPath, "test-namespace", 6);

      expect(resolveTSConfig).toHaveBeenCalledWith(path.dirname(scriptPath));

      vi.mocked(resolveTSConfig).mockClear();
      await bundleMigrationScript(scriptPath, "test-namespace", 7, {}, __dirname);

      expect(resolveTSConfig).toHaveBeenCalledWith(__dirname);
    });

    test("bundles migration script with getDB function", async () => {
      const scriptPath = writeMigration('  await trx.selectFrom("User").selectAll().execute();');
      const result = await bundleMigrationScript(scriptPath, "my-namespace", 1);

      // Bundled code should contain getDB function
      expect(result.bundledCode).toContain("getDB");
      expect(result.bundledCode).toContain("Kysely");
      expect(result.bundledCode).toContain("TailordbDialect");
    });

    test("wraps migration in transaction", async () => {
      const scriptPath = writeMigration("  // Simple migration");
      const result = await bundleMigrationScript(scriptPath, "tailordb", 2);

      // Bundled code should wrap migration in transaction
      expect(result.bundledCode).toContain("transaction()");
      expect(result.bundledCode).toContain("execute");
    });

    test("exports main function for TestExecScript", async () => {
      const scriptPath = writeMigration("  // Migration");
      const result = await bundleMigrationScript(scriptPath, "tailordb", 1);

      // Should have exported main function
      expect(result.bundledCode).toContain("export");
      expect(result.bundledCode).toContain("main");
    });

    test("returns success object from main function", async () => {
      const scriptPath = writeMigration("  // Migration");
      const result = await bundleMigrationScript(scriptPath, "tailordb", 1);

      // Should return success object
      expect(result.bundledCode).toContain("success");
    });

    test("uses correct namespace in getDB call", async () => {
      const scriptPath = writeMigration("  // Migration");
      const result = await bundleMigrationScript(scriptPath, "custom-namespace", 1);

      // getDB should be called with the correct namespace
      expect(result.bundledCode).toContain('"custom-namespace"');
    });

    test("handles migration with complex logic", async () => {
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";

async function helperFunction(trx: Transaction, value: string): Promise<void> {
  await trx.updateTable("User").set({ status: value }).execute();
}

export async function main(trx: Transaction): Promise<void> {
  await helperFunction(trx, "ACTIVE");
  await trx
    .insertInto("Log")
    .values({ message: "Migration completed" })
    .execute();
}
`,
      );
      fs.writeFileSync(path.join(testDir, "db.ts"), DB_TS);

      const result = await bundleMigrationScript(scriptPath, "tailordb", 3);

      // Should bundle successfully
      expect(result.bundledCode).toBeDefined();
      expect(result.bundledCode.length).toBeGreaterThan(0);
    });

    test("injects env into the migration context", async () => {
      const scriptPath = writeMigration(
        '  await trx.updateTable("User").set({ stage: env.ENVIRONMENT }).execute();',
        { withContext: true },
      );
      const result = await bundleMigrationScript(scriptPath, "tailordb", 7, {
        ENVIRONMENT: "staging",
        RETRIES: 3,
      });

      // The serialized env is inlined and forwarded into the migration's main()
      expect(result.bundledCode).toContain("staging");
      expect(result.bundledCode).toContain("ENVIRONMENT");
      expect(result.bundledCode).toContain("env");
    });

    test("injects an empty env object when none is provided", async () => {
      const scriptPath = writeMigration("");
      const result = await bundleMigrationScript(scriptPath, "tailordb", 8);

      // The wrapper always defines and forwards an env binding
      expect(result.bundledCode).toContain("env");
    });
  });
});
