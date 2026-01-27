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
 * - Type Addition (Non-breaking): Adding new types
 * - Field Removal (Non-breaking): Removing fields
 * - Final Schema Reconstruction: Complete migration chain verification (skipped)
 *
 * Note: Tests are executed sequentially and depend on previous test results.
 * Running individual tests in isolation may fail.
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
  INITIAL_SCHEMA_NUMBER,
  getMigrationFilePath,
} from "../src/cli/tailordb/migrate/snapshot";

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

  try {
    execSync(`node ${cliPath} tailordb migration generate --config ${configPath} --yes`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout/stderr piped
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
      encoding: "utf-8",
      timeout: 120000, // 120 second timeout (increased from 60s)
    });
    // Success - output captured but not logged to keep test output clean
  } catch (error: unknown) {
    // Log error details for debugging
    if (error && typeof error === "object" && "stderr" in error) {
      console.error("Generate CLI error:", (error as { stderr?: Buffer }).stderr?.toString());
    }
    throw error;
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

  try {
    execSync(`node ${cliPath} apply --config ${configPath} --workspace-id ${workspaceId} --yes`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout/stderr piped
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
      encoding: "utf-8",
      timeout: 120000, // 120 second timeout for apply operations
    });
    // Success - output captured but not logged to keep test output clean
  } catch (error: unknown) {
    // Log error details for debugging
    if (error && typeof error === "object" && "stderr" in error) {
      console.error("Apply CLI error:", (error as { stderr?: Buffer }).stderr?.toString());
    }
    throw error;
  }
}

describe.sequential("E2E: TailorDB Migrations", () => {
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
   * Edit migration script to replace null values with test values
   * @param {number} migrationNumber - Migration number
   * @param {Record<string, string>} replacements - Field name to value replacements
   */
  function editMigrationScript(
    migrationNumber: number,
    replacements: Record<string, string>,
  ): void {
    const migratePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");

    if (!fs.existsSync(migratePath)) {
      throw new Error(`Migration script not found: ${migratePath}`);
    }

    let content = fs.readFileSync(migratePath, "utf-8");

    // Replace null values with actual test values
    for (const [fieldName, value] of Object.entries(replacements)) {
      // Replace patterns like: fieldName: null,
      const pattern = new RegExp(`(${fieldName}:\\s*)null(,?)`, "g");
      content = content.replace(pattern, `$1${value}$2`);
    }

    fs.writeFileSync(migratePath, content);
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

    // Unset EDITOR to prevent opening editor during migration generation
    delete process.env.EDITOR;

    // Copy fixture to temp directory
    copyFixture();

    // Create package.json for ESM support
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ type: "module" }, null, 2),
    );

    // Create symlinks for module resolution
    const nodeModulesDir = path.join(tempDir, "node_modules");
    const tailorPlatformDir = path.join(nodeModulesDir, "@tailor-platform");
    fs.mkdirSync(tailorPlatformDir, { recursive: true });

    // Symlink @tailor-platform/sdk
    fs.symlinkSync(sdkRoot, path.join(tailorPlatformDir, "sdk"));

    // Symlink kysely and @tailor-platform/function-kysely-tailordb
    // These are required for migration script bundling
    // In pnpm workspace, these are in the monorepo root node_modules
    const monorepoRoot = path.resolve(sdkRoot, "../..");
    const monorepoNodeModules = path.join(monorepoRoot, "node_modules");
    fs.symlinkSync(path.join(monorepoNodeModules, "kysely"), path.join(nodeModulesDir, "kysely"));
    fs.symlinkSync(
      path.join(monorepoNodeModules, "@tailor-platform", "function-kysely-tailordb"),
      path.join(tailorPlatformDir, "function-kysely-tailordb"),
    );
  }, 120000);

  afterAll(async () => {
    // Cleanup: remove temp directory and workspace
    try {
      // Remove temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log("✅ Cleaned up temp directory:", tempDir);
    } catch (error) {
      console.warn("⚠️  Failed to cleanup temp directory:", error);
    }

    try {
      // Remove workspace
      const accessToken = await loadAccessToken({ useProfile: false });
      const client = await initOperatorClient(accessToken);
      await client.deleteWorkspace({ workspaceId });
      console.log("✅ Cleaned up workspace:", workspaceId);
    } catch (error) {
      console.warn("⚠️  Failed to cleanup workspace:", error);
    }
  }, 120000);

  /**
   * Helper to list all TailorDB service namespaces in the workspace
   * @returns List of TailorDB service namespace names
   */
  async function listTailorDBServiceNames(): Promise<string[]> {
    const services: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTailorDBServices({ workspaceId, pageToken });
      for (const svc of resp.tailordbServices) {
        if (svc.namespace?.name) {
          services.push(svc.namespace.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return services;
  }

  /**
   * Helper to list all TailorDB type names in a namespace
   * @param namespace - TailorDB namespace name
   * @returns List of type names in the namespace
   */
  async function listTailorDBTypeNames(namespace: string): Promise<string[]> {
    const types: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
      });
      for (const t of resp.tailordbTypes) {
        if (t.name) {
          types.push(t.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return types;
  }

  /**
   * Helper to get field names for a TailorDB type
   * @param namespace - TailorDB namespace name
   * @param typeName - Type name
   * @returns List of field names
   */
  async function getTailorDBTypeFields(namespace: string, typeName: string): Promise<string[]> {
    const resp = await client.getTailorDBType({
      workspaceId,
      namespaceName: namespace,
      tailordbTypeName: typeName,
    });
    return Object.keys(resp.tailordbType?.schema?.fields ?? {});
  }

  describe("Initial Setup", () => {
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

      // Verify: TailorDB service should exist
      const services = await listTailorDBServiceNames();
      expect(services).toContain(tailordbName);

      // Verify: User type should exist with expected fields
      const types = await listTailorDBTypeNames(tailordbName);
      expect(types).toContain("User");

      const fields = await getTailorDBTypeFields(tailordbName, "User");
      expect(fields).toContain("name");
      expect(fields).toContain("email");
    }, 120000);
  });

  describe("Optional Field Addition (Non-breaking)", () => {
    /**
     * Scenario 2: Non-breaking change (adding optional field)
     */
    test("detects non-breaking change when adding optional field", async () => {
      // Update type to add optional field
      updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
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

      // Verify: phone field should be added to User type
      const fields = await getTailorDBTypeFields(tailordbName, "User");
      expect(fields).toContain("phone");
    }, 120000);
  });

  describe("Required Field Addition (Breaking)", () => {
    /**
     * Scenario 3: Breaking change (adding required field)
     */
    test("detects breaking change when adding required field", async () => {
      // Update type to add required field (breaking change)
      updateTypeFile(`import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
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

      // Verify requiresMigrationScript is true
      expect(diff.requiresMigrationScript).toBe(true);

      // Verify migration script file was created
      const migratePath = getMigrationFilePath(migrationsDir, 2, "migrate");
      expect(fs.existsSync(migratePath)).toBe(true);
    }, 60000);

    /**
     * Scenario 3b: Apply breaking change migration
     */
    test("applies breaking change migration to workspace", async () => {
      // Edit migration script to set default values for required field
      editMigrationScript(2, {
        requiredField: '"default"', // String value needs quotes
      });

      const configPath = createConfig();

      runApplyCli(configPath, workspaceId, tempDir);

      // Verify: requiredField should be added to User type
      const fields = await getTailorDBTypeFields(tailordbName, "User");
      expect(fields).toContain("requiredField");
    }, 120000);
  });

  describe("Stability and Verification", () => {
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
  });

  describe("Type Addition (Non-breaking)", () => {
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

      // Verify: Post type should be added
      const types = await listTailorDBTypeNames(tailordbName);
      expect(types).toContain("Post");
    }, 120000);
  });

  describe("Field Removal (Non-breaking)", () => {
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
  email: db.string().unique(),
  role: db.string({ optional: true }),
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

      // Verify: requiredField should be removed from User type
      const fields = await getTailorDBTypeFields(tailordbName, "User");
      expect(fields).not.toContain("requiredField");
    }, 120000);
  });
});
