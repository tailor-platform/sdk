/**
 * E2E tests for TailorDB migrations
 *
 * These tests verify the complete migration workflow:
 * - Initial migration generation from table definitions
 * - Schema changes and diff detection
 * - Breaking change detection
 * - Apply with migrations
 *
 * Prerequisites:
 * - Authentication via TAILOR_PLATFORM_TOKEN env var or `tailor login`
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 *
 * Running Tests:
 * - Run specific test groups: `pnpm test -t "Initial Setup"`
 * - Run all E2E tests: `pnpm test e2e/migration.test.ts`
 * - Run only unit tests: `pnpm test --project unit`
 *
 * Test Groups:
 * - Initial Setup: Workspace creation and initial migration
 * - Optional Field Addition (Non-breaking): Adding optional fields
 * - Required Field Addition (Breaking): Adding required fields
 * - Stability and Verification: No changes detection
 * - Table Addition (Non-breaking): Adding new tables
 * - Field Removal (Non-breaking): Removing fields
 * - Final Schema Reconstruction: Complete migration chain verification (skipped)
 *
 * Note: Tests are executed sequentially and depend on previous test results.
 * Running individual tests in isolation may fail.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, test, expect } from "vitest";
import { resourceTrn } from "../src/cli/commands/deploy/label";
import {
  getMigrationFiles,
  reconstructSnapshotFromMigrations,
  loadDiff,
  INITIAL_SCHEMA_NUMBER,
  getMigrationFilePath,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import {
  MIGRATION_LABEL_KEY,
  parseMigrationLabelNumber,
} from "../src/cli/commands/tailordb/migrate/types";
import { trackWorkspace, WORKSPACE_CREATION_ALLOWANCE_MS } from "./globalSetup";
import {
  DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_TEST_TIMEOUT_MS,
  MigrationWorkspace,
} from "./migration-workspace";

describe("E2E: TailorDB Migrations", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("basic");
  ws.register();

  beforeAll(() => {
    const seedDataDir = path.join(ws.tempDir, "seed", "data");
    fs.mkdirSync(seedDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(seedDataDir, "User.jsonl"),
      `${JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Migration Test User",
        email: "migration-test@example.com",
        role: "ADMIN",
      })}\n`,
    );

    fs.writeFileSync(
      path.join(ws.tempDir, "assert-migration.ts"),
      `import type { Kysely } from "kysely";

export async function main(db: Kysely<any>): Promise<void> {
  const user = await db
    .selectFrom("User")
    .select(["name", "email"])
    .where("id", "=", "11111111-1111-4111-8111-111111111111")
    .executeTakeFirst();
  if (user?.name !== "Migration Test User" || user.email !== "migration-test@example.com") {
    throw new Error("Seeded migration fixture was not preserved");
  }
}
`,
    );
  });

  describe("Initial Setup", () => {
    /**
     * Scenario 1: Initial migration generation
     *
     * Creates initial table definition and generates 0000/schema.json
     */
    test(
      "generates initial schema migration",
      async ({ signal }) => {
        // Create config with migrations enabled
        // Generate migration via CLI
        await ws.runGenerate(signal);

        // Verify initial schema was created
        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(1);
        expect(files[0]!.type).toBe("schema");
        expect(files[0]!.number).toBe(INITIAL_SCHEMA_NUMBER);

        // Verify snapshot content
        const snapshot = reconstructSnapshotFromMigrations(ws.migrationsDir);
        expect(snapshot).not.toBeNull();
        expect(snapshot!.tables.User).toBeDefined();
        expect(snapshot!.tables.User!.fields.name).toBeDefined();
        expect(snapshot!.tables.User!.fields.email).toBeDefined();
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 1b: Apply initial migration
     */
    test(
      "applies initial migration to workspace",
      async ({ signal }) => {
        await ws.runDeploy(signal);

        // Verify: TailorDB service should exist
        const services = await ws.listTailorDBServiceNames();
        expect(services).toContain(ws.tailordbName);

        // Verify: User table should exist with expected fields
        const types = await ws.listTailorDBTypeNames();
        expect(types).toContain("User");

        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).toContain("name");
        expect(fields).toContain("email");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Optional Field Addition (Non-breaking)", () => {
    /**
     * Scenario 2: Non-breaking change (adding optional field)
     */
    test(
      "detects non-breaking change when adding optional field",
      async ({ signal }) => {
        // Update table to add optional field
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "phone: db.string({ optional: true })",
        ]);

        // Generate migration via CLI
        await ws.runGenerate(signal);

        // Verify diff was created
        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(2);
        expect(files[1]!.type).toBe("diff");
        expect(files[1]!.number).toBe(1);

        // Verify diff content
        const diffPath = getMigrationFilePath(ws.migrationsDir, 1, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.changes.length).toBe(1);
        expect(diff.changes[0]).toMatchObject({ kind: "field_added", fieldName: "phone" });
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    test(
      "rehearses the pending migration in a designated workspace",
      async ({ signal }) => {
        const sourceWorkspace = (await ws.client.getWorkspace({ workspaceId: ws.workspaceId }))
          .workspace!;
        const targetResponse = await ws.client.createWorkspace({
          workspaceName: `${ws.workspaceName}-migration-target`,
          workspaceRegion: sourceWorkspace.region,
          deleteProtection: false,
          organizationId: sourceWorkspace.organizationId,
          folderId: sourceWorkspace.folderId,
        });
        const targetWorkspaceId = targetResponse.workspace!.id;
        await trackWorkspace(ws.client, targetWorkspaceId);

        await ws.runMigrationTest(
          targetWorkspaceId,
          path.join(ws.tempDir, "assert-migration.ts"),
          signal,
        );

        const targetType = await ws.client.getTailorDBType({
          workspaceId: targetWorkspaceId,
          namespaceName: ws.tailordbName,
          tailordbTypeName: "User",
        });
        expect(Object.keys(targetType.tailordbType?.schema?.fields ?? {})).toContain("phone");

        const { metadata } = await ws.client.getMetadata({
          trn: resourceTrn(targetWorkspaceId, "tailordb", ws.tailordbName),
        });
        expect(parseMigrationLabelNumber(metadata?.labels[MIGRATION_LABEL_KEY] ?? "")).toBe(1);
      },
      WORKSPACE_CREATION_ALLOWANCE_MS + DEPLOY_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 2b: Apply non-breaking change
     */
    test(
      "applies non-breaking migration to workspace",
      async ({ signal }) => {
        await ws.runDeploy(signal);

        // Verify: phone field should be added to User table
        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).toContain("phone");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Required Field Addition (Breaking)", () => {
    /**
     * Scenario 3: Breaking change (adding required field)
     */
    test(
      "detects breaking change when adding required field",
      async ({ signal }) => {
        // Update table to add required field (breaking change)
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "phone: db.string({ optional: true })",
          "requiredField: db.string()",
        ]);

        // Generate migration (with yes flag to skip confirmation)
        await ws.runGenerate(signal);

        // Verify diff was created
        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(3);
        expect(files[2]!.type).toBe("diff");
        expect(files[2]!.number).toBe(2);

        // Verify diff shows breaking change
        const diffPath = getMigrationFilePath(ws.migrationsDir, 2, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges.length).toBeGreaterThan(0);
        expect(diff.breakingChanges[0]!.reason).toBe("Required field added");

        // Verify requiresMigrationScript is true
        expect(diff.requiresMigrationScript).toBe(true);

        // Verify migration script file was created
        const migratePath = getMigrationFilePath(ws.migrationsDir, 2, "migrate");
        expect(fs.existsSync(migratePath)).toBe(true);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 3b: Apply breaking change migration
     */
    test(
      "applies breaking change migration to workspace",
      async ({ signal }) => {
        // Edit migration script to set default values for required field
        ws.editMigrationScript(2, {
          requiredField: '"default"', // String value needs quotes
        });

        await ws.runDeploy(signal);

        // Verify: requiredField should be added to User table
        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).toContain("requiredField");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Stability and Verification", () => {
    /**
     * Scenario 4: No changes detected
     */
    test(
      "reports no changes when schema is unchanged",
      async ({ signal }) => {
        // Get current file count
        const filesBefore = getMigrationFiles(ws.migrationsDir);
        const countBefore = filesBefore.length;

        // Generate migration (should detect no changes)
        await ws.runGenerate(signal);

        // Verify no new file was created
        const filesAfter = getMigrationFiles(ws.migrationsDir);
        expect(filesAfter.length).toBe(countBefore);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );
  });

  describe("Type Addition (Non-breaking)", () => {
    /**
     * Scenario 6: Table addition (non-breaking)
     *
     * Adds a new Post table to the schema
     */
    test(
      "detects table addition as non-breaking change",
      async ({ signal }) => {
        // Copy Post table fixture
        ws.addTableFixture("post.ts");

        // Generate migration
        await ws.runGenerate(signal);

        // Verify diff was created
        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(4);
        expect(files[3]!.type).toBe("diff");
        expect(files[3]!.number).toBe(3);

        // Verify diff content
        const diffPath = getMigrationFilePath(ws.migrationsDir, 3, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(diff.changes.some((c) => c.kind === "table_added" && c.tableName === "Post")).toBe(
          true,
        );
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 6b: Apply table addition
     */
    test(
      "applies table addition to workspace",
      async ({ signal }) => {
        await ws.runDeploy(signal);

        // Verify: Post table should be added
        const types = await ws.listTailorDBTypeNames();
        expect(types).toContain("Post");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Field Removal (Non-breaking)", () => {
    /**
     * Scenario 7: Field removal (non-breaking change)
     *
     * Removes requiredField from User table
     */
    test(
      "detects field removal as non-breaking change",
      async ({ signal }) => {
        // Update User table to remove requiredField
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "phone: db.string({ optional: true })",
        ]);

        await ws.runGenerate(signal);

        // Verify diff was created
        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(5);
        expect(files[4]!.type).toBe("diff");
        expect(files[4]!.number).toBe(4);

        // Verify diff shows field removal as non-breaking change
        const diffPath = getMigrationFilePath(ws.migrationsDir, 4, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(false);
        expect(
          diff.changes.some((c) => c.kind === "field_removed" && c.fieldName === "requiredField"),
        ).toBe(true);
        expect(diff.requiresMigrationScript).toBe(false);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 7b: Apply field removal (non-breaking change)
     */
    test(
      "applies field removal to workspace",
      async ({ signal }) => {
        await ws.runDeploy(signal);

        // Verify: requiredField should be removed from User table
        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).not.toContain("requiredField");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });
});
