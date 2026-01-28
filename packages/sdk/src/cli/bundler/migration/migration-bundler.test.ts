import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { bundleMigrationScript } from "./migration-bundler";

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

describe("migration-bundler", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      TEST_BUNDLER_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    // Set TAILOR_SDK_OUTPUT_DIR to testDir so bundled output goes into test directory
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
  });

  afterAll(() => {
    // Clean up environment variable
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("bundleMigrationScript", () => {
    it("returns correct namespace and migration number", async () => {
      // Create a simple migration script
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  // Migration logic
}
`,
      );

      // Create a minimal db.ts for the import
      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "test-namespace", 5);

      expect(result.namespace).toBe("test-namespace");
      expect(result.migrationNumber).toBe(5);
      expect(typeof result.bundledCode).toBe("string");
    });

    it("bundles migration script with getDB function", async () => {
      // Create a migration script that uses Transaction
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  await trx.selectFrom("User").selectAll().execute();
}
`,
      );

      // Create db.ts
      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "my-namespace", 1);

      // Bundled code should contain getDB function
      expect(result.bundledCode).toContain("getDB");
      expect(result.bundledCode).toContain("Kysely");
      expect(result.bundledCode).toContain("TailordbDialect");
    });

    it("wraps migration in transaction", async () => {
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  // Simple migration
}
`,
      );

      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "tailordb", 2);

      // Bundled code should wrap migration in transaction
      expect(result.bundledCode).toContain("transaction()");
      expect(result.bundledCode).toContain("execute");
    });

    it("exports main function for TestExecScript", async () => {
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  // Migration
}
`,
      );

      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "tailordb", 1);

      // Should have exported main function
      expect(result.bundledCode).toContain("export");
      expect(result.bundledCode).toContain("main");
    });

    it("returns success object from main function", async () => {
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  // Migration
}
`,
      );

      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "tailordb", 1);

      // Should return success object
      expect(result.bundledCode).toContain("success");
    });

    it("uses correct namespace in getDB call", async () => {
      const scriptPath = path.join(testDir, "migrate.ts");
      fs.writeFileSync(
        scriptPath,
        `
import type { Transaction } from "./db";
export async function main(trx: Transaction): Promise<void> {
  // Migration
}
`,
      );

      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "custom-namespace", 1);

      // getDB should be called with the correct namespace
      expect(result.bundledCode).toContain('"custom-namespace"');
    });

    it("handles migration with complex logic", async () => {
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

      fs.writeFileSync(
        path.join(testDir, "db.ts"),
        `
export type Transaction = any;
`,
      );

      const result = await bundleMigrationScript(scriptPath, "tailordb", 3);

      // Should bundle successfully
      expect(result.bundledCode).toBeDefined();
      expect(result.bundledCode.length).toBeGreaterThan(0);
    });
  });
});
