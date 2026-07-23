import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { clearMigrationScriptSkipped, markMigrationScriptSkipped } from "./script";
import { formatMigrationNumber, loadDiff, DIFF_FILE_NAME, MIGRATE_FILE_NAME } from "./snapshot";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import type { MigrationDiff } from "./diff-calculator";

const TEST_MIGRATIONS_BASE = path.join(__dirname, "__test_migrations_script__");

function makeTestDir(prefix: string): string {
  const dir = path.join(
    TEST_MIGRATIONS_BASE,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeDiffFile(baseDir: string, migrationNumber: number, diff: MigrationDiff): string {
  const migDir = path.join(baseDir, formatMigrationNumber(migrationNumber));
  fs.mkdirSync(migDir, { recursive: true });
  const diffPath = path.join(migDir, DIFF_FILE_NAME);
  fs.writeFileSync(diffPath, JSON.stringify(diff, null, 2));
  return diffPath;
}

function writeMigrateFile(baseDir: string, migrationNumber: number): void {
  const migDir = path.join(baseDir, formatMigrationNumber(migrationNumber));
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(path.join(migDir, MIGRATE_FILE_NAME), "export async function main() {}");
}

describe("markMigrationScriptSkipped", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir("test");
  });

  afterAll(() => {
    try {
      fs.rmSync(TEST_MIGRATIONS_BASE, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  test("writes scriptSkipped with reason and timestamp into diff.json", () => {
    const diffPath = writeDiffFile(
      testDir,
      1,
      createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
    );

    markMigrationScriptSkipped({
      migrationsDir: testDir,
      migrationNumber: 1,
      reason: "no data yet, safe to skip",
    });

    const diff = loadDiff(diffPath);
    expect(diff.scriptSkipped).toBeDefined();
    expect(diff.scriptSkipped!.reason).toBe("no data yet, safe to skip");
    expect(new Date(diff.scriptSkipped!.acknowledgedAt).getTime()).not.toBeNaN();
  });

  test("rejects a whitespace-only skip reason", () => {
    writeDiffFile(
      testDir,
      1,
      createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
    );

    expect(() =>
      markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "   " }),
    ).toThrow(/reason/i);
  });

  test("preserves existing diff contents", () => {
    const original = createMockMigrationDiff({
      hasBreakingChanges: true,
      requiresMigrationScript: true,
      breakingChanges: [{ typeName: "User", fieldName: "email", reason: "Unique constraint" }],
      description: "add unique email",
    });
    const diffPath = writeDiffFile(testDir, 1, original);

    markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "no data" });

    const diff = loadDiff(diffPath);
    expect(diff.breakingChanges).toEqual(original.breakingChanges);
    expect(diff.description).toBe("add unique email");
    expect(diff.requiresMigrationScript).toBe(true);
  });

  test("throws when migrate.ts exists", () => {
    writeDiffFile(
      testDir,
      1,
      createMockMigrationDiff({ hasBreakingChanges: true, requiresMigrationScript: true }),
    );
    writeMigrateFile(testDir, 1);

    expect(() =>
      markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "skip" }),
    ).toThrow(/migrate\.ts/);
  });

  test("throws when the migration does not require a script", () => {
    writeDiffFile(testDir, 1, createMockMigrationDiff());

    expect(() =>
      markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "skip" }),
    ).toThrow(/does not require a migration script/);
  });

  test("throws when a skip is already recorded", () => {
    writeDiffFile(
      testDir,
      1,
      createMockMigrationDiff({
        hasBreakingChanges: true,
        requiresMigrationScript: true,
        scriptSkipped: { reason: "earlier", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
      }),
    );

    expect(() =>
      markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "again" }),
    ).toThrow(/already/);
  });

  test("throws when diff.json does not exist", () => {
    expect(() =>
      markMigrationScriptSkipped({ migrationsDir: testDir, migrationNumber: 1, reason: "skip" }),
    ).toThrow(/not found/);
  });

  test("clears a stale skip acknowledgment while preserving other diff fields", () => {
    const diffPath = writeDiffFile(
      testDir,
      1,
      createMockMigrationDiff({
        hasBreakingChanges: true,
        requiresMigrationScript: true,
        scriptSkipped: { reason: "no data", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
      }),
    );
    const raw = JSON.parse(fs.readFileSync(diffPath, "utf-8")) as Record<string, unknown>;
    raw.futureField = "preserve-me";
    fs.writeFileSync(diffPath, JSON.stringify(raw, null, 2));

    clearMigrationScriptSkipped(diffPath);

    const cleared = JSON.parse(fs.readFileSync(diffPath, "utf-8")) as Record<string, unknown>;
    expect(cleared).not.toHaveProperty("scriptSkipped");
    expect(cleared.futureField).toBe("preserve-me");
  });
});
