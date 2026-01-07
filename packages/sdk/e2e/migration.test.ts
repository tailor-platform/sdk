/**
 * E2E tests for TailorDB migrations
 *
 * These tests verify the complete migration workflow:
 * - Initial migration generation from type definitions
 * - Schema changes and diff detection
 * - Breaking change detection
 * - Apply with migrations
 *
 * Prerequisites:
 * - TAILOR_PLATFORM_TOKEN environment variable must be set
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { initOperatorClient, type OperatorClient } from "../src/cli/client";
import { loadAccessToken } from "../src/cli/context";
import {
  getMigrationFiles,
  reconstructSnapshotFromMigrations,
  loadDiff,
} from "../src/cli/tailordb/migrate/snapshot";
import { INITIAL_SCHEMA_NUMBER, getMigrationFilePath } from "../src/cli/tailordb/migrate/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// E2E workspace prefix - used for identification and cleanup
const E2E_WORKSPACE_PREFIX = "e2e-ws-";

// Fixture directory path
const FIXTURE_DIR = path.join(__dirname, "fixtures", "migration");

// Generate unique test identifiers
const testRunId = Date.now().toString(36);
const testAppName = `migration-e2e-${testRunId}`;
const testWorkspaceName = `${E2E_WORKSPACE_PREFIX}${testRunId}`;
const tailordbName = `testdb-${testRunId}`;

/**
 * Run the generate CLI command via subprocess
 * @param {string} configPath - Path to the config file
 * @param {string} cwd - Working directory
 */
function runGenerateCli(configPath: string, cwd: string): void {
  const sdkRoot = path.resolve(__dirname, "..");
  const cliPath = path.join(sdkRoot, "dist", "cli", "index.mjs");

  execSync(`node ${cliPath} tailordb migrate generate --config ${configPath} --yes`, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-vm-modules",
    },
  });
}

/**
 * Run the generate CLI command and expect it to fail
 * @param {string} configPath - Path to the config file
 * @param {string} cwd - Working directory
 * @returns {boolean} True if the command failed as expected
 */
function runGenerateCliExpectError(configPath: string, cwd: string): boolean {
  const sdkRoot = path.resolve(__dirname, "..");
  const cliPath = path.join(sdkRoot, "dist", "cli", "index.mjs");

  try {
    execSync(`node ${cliPath} tailordb migrate generate --config ${configPath} --yes`, {
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
    });
    return false; // Should have thrown
  } catch {
    return true; // Expected error
  }
}

/**
 * Run the apply CLI command via subprocess
 * @param {string} configPath - Path to the config file
 * @param {string} workspaceId - Workspace ID
 * @param {string} cwd - Working directory
 */
function runApplyCli(configPath: string, workspaceId: string, cwd: string): void {
  const sdkRoot = path.resolve(__dirname, "..");
  const cliPath = path.join(sdkRoot, "dist", "cli", "index.mjs");

  execSync(`node ${cliPath} apply --config ${configPath} --workspace-id ${workspaceId} --yes`, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-vm-modules",
    },
  });
}

describe("E2E: TailorDB Migrations", () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;

  /**
   * Copy fixture directory to temp directory
   * Only copies user.ts initially; post.ts is added in test scenario 6
   */
  function copyFixture(): void {
    // Copy only user.ts from tailordb directory
    const srcTailordb = path.join(FIXTURE_DIR, "tailordb");
    const destTailordb = path.join(tempDir, "tailordb");
    fs.mkdirSync(destTailordb, { recursive: true });
    fs.copyFileSync(path.join(srcTailordb, "user.ts"), path.join(destTailordb, "user.ts"));

    // Copy generated directory (for migration script execution)
    const srcGenerated = path.join(FIXTURE_DIR, "generated");
    const destGenerated = path.join(tempDir, "generated");
    if (fs.existsSync(srcGenerated)) {
      fs.mkdirSync(destGenerated, { recursive: true });
      fs.copyFileSync(
        path.join(srcGenerated, "tailordb.ts"),
        path.join(destGenerated, "tailordb.ts"),
      );
    }

    // Create migrations directory (empty)
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  /**
   * Create config file from template with placeholders replaced
   * @returns {string} Path to the created config file
   */
  function createConfig(): string {
    const templatePath = path.join(FIXTURE_DIR, "config.template.ts");
    const template = fs.readFileSync(templatePath, "utf-8");
    const config = template
      .replace(/\{\{APP_NAME\}\}/g, testAppName)
      .replace(/\{\{TAILORDB_NAME\}\}/g, tailordbName);

    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, config);
    return configPath;
  }

  /**
   * Update type file with new content
   * @param {string} content - New content for the type file
   */
  function updateTypeFile(content: string): void {
    const typePath = path.join(tempDir, "tailordb", "user.ts");
    fs.writeFileSync(typePath, content);
  }

  /**
   * Cleanup workspace and temp directory
   * @returns {Promise<void>}
   */
  async function cleanup(): Promise<void> {
    // Cleanup environment variable
    delete process.env.TAILOR_PLATFORM_SDK_TYPE_PATH;

    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to cleanup temp directory:", error);
      }
    }

    // Delete workspace
    if (client && workspaceId) {
      console.log(`Deleting workspace "${testWorkspaceName}" (${workspaceId})...`);
      try {
        await client.deleteWorkspace({ workspaceId });
        console.log("Workspace deleted successfully.");
      } catch (error) {
        console.error("Failed to delete workspace:", error);
      }
    }
  }

  beforeAll(async () => {
    // Check for required environment variable
    if (!process.env.TAILOR_PLATFORM_TOKEN) {
      throw new Error("TAILOR_PLATFORM_TOKEN environment variable must be set to run E2E tests");
    }

    // Initialize client
    const accessToken = await loadAccessToken({ useProfile: false });
    client = await initOperatorClient(accessToken);

    // Get available regions and use the first one
    const regionsResp = await client.listAvailableWorkspaceRegions({});
    const region = regionsResp.regions[0];
    if (!region) {
      throw new Error("No available regions found");
    }

    // Create workspace dynamically
    console.log(`Creating workspace "${testWorkspaceName}" in region "${region}"...`);
    const createResp = await client.createWorkspace({
      workspaceName: testWorkspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id!;
    console.log(`Workspace created: ${workspaceId}`);

    // Set workspace ID for apply operations
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    // Create temp directory
    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-e2e-"));
    migrationsDir = path.join(tempDir, "migrations");

    // Set TAILOR_PLATFORM_SDK_TYPE_PATH to prevent writing to packages/sdk
    process.env.TAILOR_PLATFORM_SDK_TYPE_PATH = path.join(tempDir, "user-defined.d.ts");

    // Copy fixture to temp directory
    copyFixture();

    // Create package.json for ESM support
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ type: "module" }, null, 2),
    );

    // Create symlink for @tailor-platform/sdk module resolution
    const nodeModulesDir = path.join(tempDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(nodeModulesDir, "sdk"));
  }, 120000);

  afterAll(async () => {
    await cleanup();
  }, 120000);

  /**
   * Scenario 1: Initial migration generation
   *
   * Creates initial type definition and generates 0000/schema.json
   */
  test("generates initial schema migration", async () => {
    // Create config with migrations enabled
    const configPath = createConfig();

    // Generate migration via CLI
    runGenerateCli(configPath, tempDir);

    // Verify initial schema was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(1);
    expect(files[0].type).toBe("schema");
    expect(files[0].number).toBe(INITIAL_SCHEMA_NUMBER);

    // Verify snapshot content
    const snapshot = reconstructSnapshotFromMigrations(migrationsDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.types.User).toBeDefined();
    expect(snapshot!.types.User.fields.name).toBeDefined();
    expect(snapshot!.types.User.fields.email).toBeDefined();
  }, 60000);

  /**
   * Scenario 1b: Apply initial migration
   */
  test("applies initial migration to workspace", async () => {
    const configPath = createConfig();

    runApplyCli(configPath, workspaceId, tempDir);
  }, 120000);

  /**
   * Scenario 2: Non-breaking change (adding optional field)
   */
  test("detects non-breaking change when adding optional field", async () => {
    // Update type to add optional field
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.string({ optional: true }),
});

export type user = typeof user;
`);

    const configPath = createConfig();

    // Generate migration via CLI
    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(2);
    expect(files[1].type).toBe("diff");
    expect(files[1].number).toBe(1);

    // Verify diff content
    const diffPath = getMigrationFilePath(migrationsDir, 1, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(false);
    expect(diff.changes.length).toBe(1);
    expect(diff.changes[0].kind).toBe("field_added");
    expect(diff.changes[0].fieldName).toBe("phone");
  }, 60000);

  /**
   * Scenario 2b: Apply non-breaking change
   */
  test("applies non-breaking migration to workspace", async () => {
    const configPath = createConfig();

    runApplyCli(configPath, workspaceId, tempDir);
  }, 120000);

  /**
   * Scenario 3: Breaking change (adding required field)
   */
  test("detects breaking change when adding required field", async () => {
    // Update type to add required field (breaking change)
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.string({ optional: true }),
  requiredField: db.string(),
});

export type user = typeof user;
`);

    const configPath = createConfig();

    // Generate migration (with yes flag to skip confirmation)
    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(3);
    expect(files[2].type).toBe("diff");
    expect(files[2].number).toBe(2);

    // Verify diff shows breaking change
    const diffPath = getMigrationFilePath(migrationsDir, 2, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(true);
    expect(diff.breakingChanges.length).toBeGreaterThan(0);
    expect(diff.breakingChanges[0].reason).toBe("Required field added");
  }, 60000);

  /**
   * Scenario 4: No changes detected
   */
  test("reports no changes when schema is unchanged", async () => {
    const configPath = createConfig();

    // Get current file count
    const filesBefore = getMigrationFiles(migrationsDir);
    const countBefore = filesBefore.length;

    // Generate migration (should detect no changes)
    runGenerateCli(configPath, tempDir);

    // Verify no new file was created
    const filesAfter = getMigrationFiles(migrationsDir);
    expect(filesAfter.length).toBe(countBefore);
  }, 60000);

  /**
   * Scenario 5: Reconstructing schema from migrations
   */
  test("reconstructs complete schema from migration chain", async () => {
    // Reconstruct schema from all migrations
    const reconstructed = reconstructSnapshotFromMigrations(migrationsDir);

    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.types.User).toBeDefined();

    // Verify all fields are present
    const userFields = reconstructed!.types.User.fields;
    expect(userFields.name).toBeDefined();
    expect(userFields.email).toBeDefined();
    expect(userFields.phone).toBeDefined();
    expect(userFields.requiredField).toBeDefined();

    // Verify field attributes
    expect(userFields.phone.required).toBe(false);
    expect(userFields.requiredField.required).toBe(true);
  }, 30000);

  /**
   * Scenario 6: Type addition (non-breaking)
   *
   * Adds a new Post type to the schema
   */
  test("detects type addition as non-breaking change", async () => {
    // Copy Post type fixture
    const srcPost = path.join(FIXTURE_DIR, "tailordb", "post.ts");
    const destPost = path.join(tempDir, "tailordb", "post.ts");
    fs.copyFileSync(srcPost, destPost);

    const configPath = createConfig();

    // Generate migration
    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(4);
    expect(files[3].type).toBe("diff");
    expect(files[3].number).toBe(3);

    // Verify diff content
    const diffPath = getMigrationFilePath(migrationsDir, 3, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(false);
    expect(diff.changes.some((c) => c.kind === "type_added" && c.typeName === "Post")).toBe(true);
  }, 60000);

  /**
   * Scenario 6b: Apply type addition
   */
  test("applies type addition to workspace", async () => {
    const configPath = createConfig();

    runApplyCli(configPath, workspaceId, tempDir);
  }, 120000);

  /**
   * Scenario 7: Field removal (non-breaking change)
   *
   * Removes requiredField from User type
   */
  test("detects field removal as non-breaking change", async () => {
    // Update User type to remove requiredField
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.string({ optional: true }),
});

export type user = typeof user;
`);

    const configPath = createConfig();

    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(5);
    expect(files[4].type).toBe("diff");
    expect(files[4].number).toBe(4);

    // Verify diff shows field removal as non-breaking change
    const diffPath = getMigrationFilePath(migrationsDir, 4, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(false);
    expect(
      diff.changes.some((c) => c.kind === "field_removed" && c.fieldName === "requiredField"),
    ).toBe(true);
    expect(diff.requiresMigrationScript).toBe(false);
  }, 60000);

  /**
   * Scenario 7b: Apply field removal (non-breaking change)
   */
  test("applies field removal to workspace", async () => {
    const configPath = createConfig();

    runApplyCli(configPath, workspaceId, tempDir);
  }, 120000);

  /**
   * Scenario 8: Field type change (breaking change - should error)
   *
   * Changes phone field from string to integer
   * Field type changes are not supported and should throw an error
   */
  test("detects field type change as breaking change", async () => {
    // Update User type to change phone type from string to integer
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.int({ optional: true }),
});

export type user = typeof user;
`);

    const configPath = createConfig();

    // Field type change should throw an error
    const didError = runGenerateCliExpectError(configPath, tempDir);
    expect(didError).toBe(true);

    // No new migration should be created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(5); // Still 5 from previous migrations

    // Revert schema to previous state for subsequent tests
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.string({ optional: true }),
});

export type user = typeof user;
`);
  }, 60000);

  /**
   * Scenario 9: Optional to required change (breaking change)
   *
   * Changes phone field from optional to required (without type change)
   */
  test("detects optional to required change as breaking change", async () => {
    // Update User type to make phone required (keeping the same type)
    updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  phone: db.string(),
});

export type user = typeof user;
`);

    const configPath = createConfig();

    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(6);
    expect(files[5].type).toBe("diff");
    expect(files[5].number).toBe(5);

    // Verify diff shows required change as breaking change
    const diffPath = getMigrationFilePath(migrationsDir, 5, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(true);
    expect(diff.changes.some((c) => c.kind === "field_modified" && c.fieldName === "phone")).toBe(
      true,
    );
    expect(diff.breakingChanges.some((bc) => bc.reason.includes("optional to required"))).toBe(
      true,
    );
  }, 60000);

  /**
   * Scenario 10: Type removal (non-breaking change)
   *
   * Removes Post type from the schema
   */
  test("detects type removal as non-breaking change", async () => {
    // Remove Post type file
    const postPath = path.join(tempDir, "tailordb", "post.ts");
    fs.unlinkSync(postPath);

    const configPath = createConfig();

    runGenerateCli(configPath, tempDir);

    // Verify diff was created
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(7);
    expect(files[6].type).toBe("diff");
    expect(files[6].number).toBe(6);

    // Verify diff shows type removal as non-breaking change
    const diffPath = getMigrationFilePath(migrationsDir, 6, "diff");
    const diff = loadDiff(diffPath);
    expect(diff.hasBreakingChanges).toBe(false);
    expect(diff.changes.some((c) => c.kind === "type_removed" && c.typeName === "Post")).toBe(true);
    expect(diff.requiresMigrationScript).toBe(false);
  }, 60000);

  /**
   * Scenario 10b: Apply type removal and other changes
   */
  test("applies type removal and other changes to workspace", async () => {
    const configPath = createConfig();

    runApplyCli(configPath, workspaceId, tempDir);
  }, 120000);

  /**
   * Scenario 11: Final schema reconstruction
   *
   * Verifies that all 7 migrations can be reconstructed correctly
   * - Migration 0: Initial schema (0000/schema.json)
   * - Migrations 1-6: Diffs (0001/diff.json - 0006/diff.json)
   *
   * Note: Field type change (string -> integer) is not included because
   * field type changes are not supported and throw an error.
   */
  test("reconstructs final schema from all migrations", async () => {
    const reconstructed = reconstructSnapshotFromMigrations(migrationsDir);

    expect(reconstructed).not.toBeNull();

    // Verify User type exists with final fields
    expect(reconstructed!.types.User).toBeDefined();
    const userFields = reconstructed!.types.User.fields;
    expect(userFields.name).toBeDefined();
    expect(userFields.email).toBeDefined();
    expect(userFields.phone).toBeDefined();

    // Verify phone field has been modified (optional -> required, but still string type)
    expect(userFields.phone.type).toBe("string");
    expect(userFields.phone.required).toBe(true);

    // Verify requiredField was removed
    expect(userFields.requiredField).toBeUndefined();

    // Verify Post type was removed
    expect(reconstructed!.types.Post).toBeUndefined();

    // Verify migration count (1 schema + 6 diffs)
    const files = getMigrationFiles(migrationsDir);
    expect(files.length).toBe(7);
  }, 30000);
});
