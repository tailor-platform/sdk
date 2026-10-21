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
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, aroundAll } from "vitest";
import { resourceTrn } from "../src/cli/commands/deploy/label";
import { migrationWorkflowResourceName } from "../src/cli/commands/deploy/tailordb/migration-workflow";
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
import { initOperatorClient, isNotFoundError, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { CLI_BUDGET_MS, type CliResult, cliTestTimeout, runCli, tryCli } from "./cli";
import {
  resolveE2ERunId,
  resolveE2EWorkspaceRegion,
  trackWorkspace,
  trackTempDir,
  WORKSPACE_CREATION_ALLOWANCE_MS,
} from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// E2E workspace prefix - used for identification and cleanup
const E2E_WORKSPACE_PREFIX = "e2e-ws-";

// Fixture directory path
const FIXTURE_DIR = path.join(__dirname, "fixtures", "migration");

// Generate unique test identifiers (include run id in CI to avoid cross-run cleanup conflicts)
const ciRunId = resolveE2ERunId();
const testRunId = Date.now().toString(36);
const testAppName = `migration-e2e-${testRunId}`;
const testWorkspaceName = `${E2E_WORKSPACE_PREFIX}${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `testdb-${testRunId}`;

// A deploy killed mid data migration cannot roll back, and the leftover remote schema fails
// all later deploys closed, so each test outlasts the CLI calls it makes.
const GENERATE_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.local);
const DEPLOY_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.deploy);
const GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS = cliTestTimeout(
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.deploy,
);

/**
 * Run the generate CLI command via subprocess
 * @param {string} configPath - Path to the config file
 * @param {string} cwd - Working directory
 * @param {AbortSignal} signal - The calling test's signal
 */
async function runGenerateCli(
  configPath: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"], {
    cwd,
    timeoutMs: CLI_BUDGET_MS.local,
    signal,
  });
}

/**
 * Run the deploy CLI command via subprocess
 * @param {string} configPath - Path to the config file
 * @param {string} workspaceId - Workspace ID
 * @param {string} cwd - Working directory
 * @param {AbortSignal} signal - The calling test's signal
 */
async function runDeployCli(
  configPath: string,
  workspaceId: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"], {
    cwd,
    timeoutMs: CLI_BUDGET_MS.deploy,
    signal,
  });
}

/**
 * Run pending migrations against a designated E2E target workspace.
 * @param configPath - Path to the fixture config
 * @param sourceWorkspaceId - Workspace whose migration checkpoint is the baseline
 * @param targetWorkspaceId - Empty throwaway workspace retained for assertions
 * @param assertionPath - Post-migration assertion script
 * @param cwd - Fixture working directory
 * @param signal - The calling test's signal
 */
async function runMigrationTestCli(
  configPath: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  assertionPath: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await runCli(
    [
      "tailordb",
      "migration",
      "test",
      "--config",
      configPath,
      "--workspace-id",
      sourceWorkspaceId,
      "--target-workspace-id",
      targetWorkspaceId,
      "--data",
      "seed",
      "--assert",
      assertionPath,
      "--yes",
    ],
    { cwd, timeoutMs: CLI_BUDGET_MS.deploy, signal },
  );
}

/**
 * Run the deploy CLI command, returning the result instead of throwing so callers
 * can assert on an expected failure. A deploy killed for exceeding its budget still
 * rejects: it did not fail, it was interrupted.
 * @param {string} configPath - Path to the config file
 * @param {string} workspaceId - Workspace ID
 * @param {string} cwd - Working directory
 * @param {AbortSignal} signal - The calling test's signal
 * @returns {Promise<CliResult>} Whether deploy succeeded and its combined output
 */
function tryDeployCli(
  configPath: string,
  workspaceId: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<CliResult> {
  return tryCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"], {
    cwd,
    timeoutMs: CLI_BUDGET_MS.deploy,
    signal,
  });
}

describe("E2E: TailorDB Migrations", { concurrent: false }, () => {
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

    const seedDataDir = path.join(tempDir, "seed", "data");
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
      path.join(tempDir, "assert-migration.ts"),
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
   * Update table file with new content
   * @param {string} content - New content for the table file
   */
  function updateTypeFile(content: string): void {
    const typePath = path.join(tempDir, "tailordb", "user.ts");
    fs.writeFileSync(typePath, content);
  }

  /**
   * Edit migration script to replace its TODO placeholders with test values
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

    // Replace TODO placeholders with actual test values
    for (const [fieldName, value] of Object.entries(replacements)) {
      // Replace patterns like: fieldName: TODO("..."),
      const pattern = new RegExp(`(${fieldName}:\\s*)TODO\\("[^"]*"\\)(,?)`, "g");
      content = content.replace(pattern, `$1${value}$2`);
    }

    fs.writeFileSync(migratePath, content);
  }

  aroundAll(async (runSuite) => {
    // Initialize client (supports both TAILOR_PLATFORM_TOKEN env var and platform config login)
    const accessToken = await loadAccessToken();
    client = await initOperatorClient(accessToken);

    const region = await resolveE2EWorkspaceRegion(client);

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
    await trackWorkspace(client, workspaceId);
    console.log(`Workspace created: ${workspaceId}`);

    // Set workspace ID for apply operations
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    // Create temp directory
    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-e2e-"));
    trackTempDir(tempDir);
    migrationsDir = path.join(tempDir, "migrations");

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

    await runSuite();
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
   * Helper to list all TailorDB table names in a namespace
   * @param namespace - TailorDB namespace name
   * @returns List of table names in the namespace
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
   * Helper to get field names for a TailorDB table
   * @param namespace - TailorDB namespace name
   * @param tableName - Table name
   * @returns List of field names
   */
  async function getTailorDBTypeFields(namespace: string, tableName: string): Promise<string[]> {
    const resp = await client.getTailorDBType({
      workspaceId,
      namespaceName: namespace,
      tailordbTypeName: tableName,
    });
    return Object.keys(resp.tailordbType?.schema?.fields ?? {});
  }

  /**
   * Read the applied migration checkpoint number from the TailorDB service metadata.
   * @param namespace - TailorDB namespace name
   * @returns The applied migration number, or null if no checkpoint label is set
   */
  async function getMigrationCheckpoint(namespace: string): Promise<number | null> {
    const trn = resourceTrn(workspaceId, "tailordb", namespace);
    const { metadata } = await client.getMetadata({ trn });
    const label = metadata?.labels[MIGRATION_LABEL_KEY];
    return label ? parseMigrationLabelNumber(label) : null;
  }

  /**
   * Overwrite a migration's migrate.ts with the given script body.
   * @param migrationNumber - Migration number
   * @param body - Full TypeScript source to write
   */
  function overwriteMigrationScript(migrationNumber: number, body: string): void {
    const migratePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
    fs.writeFileSync(migratePath, body);
  }

  /**
   * Regroup the steps of a generated migrate.ts into two steps, the second depending on the first.
   * Every step is its own platform job, so a migration with many changes takes minutes to deploy;
   * two steps still exercise the step runner.
   * @param script - Generated migrate.ts source that exports `steps`
   * @returns Source whose `steps` holds a `first` and a `second` step running the same functions in order
   */
  function groupStepsIntoTwo(script: string): string {
    const stepsBlock = /export const steps = \{\n([\s\S]*?)\n\} satisfies MigrationSteps;/.exec(
      script,
    );
    if (!stepsBlock) throw new Error("Generated migrate.ts does not export steps");
    const names = [...stepsBlock[1]!.matchAll(/^ {2}(\w+): \{/gm)].map((match) => match[1]!);
    if (names.length < 2) throw new Error(`Expected at least two steps, found ${names.length}`);
    const half = Math.ceil(names.length / 2);
    const run = (group: string[]) =>
      `async (trx: Transaction) => {\n${group.map((name) => `    await ${name}(trx);`).join("\n")}\n  }`;
    return script.replace(
      stepsBlock[0],
      `export const steps = {\n  first: { run: ${run(names.slice(0, half))} },\n  second: { dependsOn: ["first"], run: ${run(names.slice(half))} },\n} satisfies MigrationSteps;`,
    );
  }

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
        const configPath = createConfig();

        // Generate migration via CLI
        await runGenerateCli(configPath, tempDir, signal);

        // Verify initial schema was created
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(1);
        expect(files[0]!.type).toBe("schema");
        expect(files[0]!.number).toBe(INITIAL_SCHEMA_NUMBER);

        // Verify snapshot content
        const snapshot = reconstructSnapshotFromMigrations(migrationsDir);
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
        const configPath = createConfig();

        await runDeployCli(configPath, workspaceId, tempDir, signal);

        // Verify: TailorDB service should exist
        const services = await listTailorDBServiceNames();
        expect(services).toContain(tailordbName);

        // Verify: User table should exist with expected fields
        const types = await listTailorDBTypeNames(tailordbName);
        expect(types).toContain("User");

        const fields = await getTailorDBTypeFields(tailordbName, "User");
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
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();

        // Generate migration via CLI
        await runGenerateCli(configPath, tempDir, signal);

        // Verify diff was created
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(2);
        expect(files[1]!.type).toBe("diff");
        expect(files[1]!.number).toBe(1);

        // Verify diff content
        const diffPath = getMigrationFilePath(migrationsDir, 1, "diff");
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
        const configPath = createConfig();
        const sourceWorkspace = (await client.getWorkspace({ workspaceId })).workspace!;
        const targetResponse = await client.createWorkspace({
          workspaceName: `${testWorkspaceName}-migration-target`,
          workspaceRegion: sourceWorkspace.region,
          deleteProtection: false,
          organizationId: sourceWorkspace.organizationId,
          folderId: sourceWorkspace.folderId,
        });
        const targetWorkspaceId = targetResponse.workspace!.id;
        await trackWorkspace(client, targetWorkspaceId);

        await runMigrationTestCli(
          configPath,
          workspaceId,
          targetWorkspaceId,
          path.join(tempDir, "assert-migration.ts"),
          tempDir,
          signal,
        );

        const targetType = await client.getTailorDBType({
          workspaceId: targetWorkspaceId,
          namespaceName: tailordbName,
          tailordbTypeName: "User",
        });
        expect(Object.keys(targetType.tailordbType?.schema?.fields ?? {})).toContain("phone");

        const { metadata } = await client.getMetadata({
          trn: resourceTrn(targetWorkspaceId, "tailordb", tailordbName),
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
        const configPath = createConfig();

        await runDeployCli(configPath, workspaceId, tempDir, signal);

        // Verify: phone field should be added to User table
        const fields = await getTailorDBTypeFields(tailordbName, "User");
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
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  requiredField: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();

        // Generate migration (with yes flag to skip confirmation)
        await runGenerateCli(configPath, tempDir, signal);

        // Verify diff was created
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(3);
        expect(files[2]!.type).toBe("diff");
        expect(files[2]!.number).toBe(2);

        // Verify diff shows breaking change
        const diffPath = getMigrationFilePath(migrationsDir, 2, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.breakingChanges.length).toBeGreaterThan(0);
        expect(diff.breakingChanges[0]!.reason).toBe("Required field added");

        // Verify requiresMigrationScript is true
        expect(diff.requiresMigrationScript).toBe(true);

        // Verify migration script file was created
        const migratePath = getMigrationFilePath(migrationsDir, 2, "migrate");
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
        editMigrationScript(2, {
          requiredField: '"default"', // String value needs quotes
        });

        const configPath = createConfig();

        await runDeployCli(configPath, workspaceId, tempDir, signal);

        // Verify: requiredField should be added to User table
        const fields = await getTailorDBTypeFields(tailordbName, "User");
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
        const configPath = createConfig();

        // Get current file count
        const filesBefore = getMigrationFiles(migrationsDir);
        const countBefore = filesBefore.length;

        // Generate migration (should detect no changes)
        await runGenerateCli(configPath, tempDir, signal);

        // Verify no new file was created
        const filesAfter = getMigrationFiles(migrationsDir);
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
        const srcPost = path.join(FIXTURE_DIR, "tailordb", "post.ts");
        const destPost = path.join(tempDir, "tailordb", "post.ts");
        fs.copyFileSync(srcPost, destPost);

        const configPath = createConfig();

        // Generate migration
        await runGenerateCli(configPath, tempDir, signal);

        // Verify diff was created
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(4);
        expect(files[3]!.type).toBe("diff");
        expect(files[3]!.number).toBe(3);

        // Verify diff content
        const diffPath = getMigrationFilePath(migrationsDir, 3, "diff");
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
        const configPath = createConfig();

        await runDeployCli(configPath, workspaceId, tempDir, signal);

        // Verify: Post table should be added
        const types = await listTailorDBTypeNames(tailordbName);
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
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();

        await runGenerateCli(configPath, tempDir, signal);

        // Verify diff was created
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(5);
        expect(files[4]!.type).toBe("diff");
        expect(files[4]!.number).toBe(4);

        // Verify diff shows field removal as non-breaking change
        const diffPath = getMigrationFilePath(migrationsDir, 4, "diff");
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
        const configPath = createConfig();

        await runDeployCli(configPath, workspaceId, tempDir, signal);

        // Verify: requiredField should be removed from User table
        const fields = await getTailorDBTypeFields(tailordbName, "User");
        expect(fields).not.toContain("requiredField");
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Migration Rollback on Failure", () => {
    /**
     * Scenario 8: A failing migrate.ts must roll back its Pre-phase DDL, leaving
     * the remote schema and checkpoint at the prior migration so a retry works.
     */
    test(
      "generates the breaking migration whose script will fail",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);

        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(6);
        expect(files[5]!.number).toBe(5);

        const diffPath = getMigrationFilePath(migrationsDir, 5, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.requiresMigrationScript).toBe(true);
        expect(fs.existsSync(getMigrationFilePath(migrationsDir, 5, "migrate"))).toBe(true);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    test(
      "rolls back the pre-migration DDL when migrate.ts fails",
      async ({ signal }) => {
        // Make the data migration deterministically fail.
        overwriteMigrationScript(
          5,
          `export async function main(): Promise<void> {
  throw new Error("simulated migration failure for rollback e2e");
}
`,
        );

        const checkpointBefore = await getMigrationCheckpoint(tailordbName);
        expect(checkpointBefore).toBe(4);

        const configPath = createConfig();
        const result = await tryDeployCli(configPath, workspaceId, tempDir, signal);

        // The deploy must fail for the injected reason, not an unrelated error.
        expect(result.ok).toBe(false);
        expect(result.output).toContain("simulated migration failure for rollback e2e");

        // Rollback restored User to its checkpoint-4 schema: the new field is gone,
        // prior fields remain.
        const fields = await getTailorDBTypeFields(tailordbName, "User");
        expect(fields).not.toContain("loyaltyTier");
        expect(fields).toEqual(expect.arrayContaining(["name", "email", "role", "phone"]));

        const checkpointAfter = await getMigrationCheckpoint(tailordbName);
        expect(checkpointAfter).toBe(4);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );

    test(
      "a retry succeeds once migrate.ts is fixed (workspace was recoverable)",
      async ({ signal }) => {
        // Provide a working data migration that backfills the new required field.
        overwriteMigrationScript(
          5,
          `export async function main(trx: any): Promise<void> {
  await trx
    .updateTable("User")
    .set({ loyaltyTier: "bronze" })
    .execute();
}
`,
        );

        const configPath = createConfig();
        // No drift error: the failed deploy left a consistent baseline at checkpoint 4.
        await runDeployCli(configPath, workspaceId, tempDir, signal);

        const fields = await getTailorDBTypeFields(tailordbName, "User");
        expect(fields).toContain("loyaltyTier");

        const checkpointAfter = await getMigrationCheckpoint(tailordbName);
        expect(checkpointAfter).toBe(5);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("In-place Field Type Changes", () => {
    const firstRowId = "10000000-0000-4000-8000-000000000001";
    const secondRowId = "10000000-0000-4000-8000-000000000002";

    test(
      "seeds representative values under the source field types",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
  sourceUuid: db.uuid(),
  sourceEnum: db.enum(["ACTIVE", "INACTIVE"]),
  sourceDecimal: db.decimal(),
  sourceInteger: db.int(),
  indexedUuid: db.uuid().index(),
  indexedEnum: db.enum(["ACTIVE", "INACTIVE"]).index(),
  indexedDecimal: db.decimal().index(),
  indexedInteger: db.int().index(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);

        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(7);
        expect(files[6]!.number).toBe(6);

        overwriteMigrationScript(
          6,
          `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      {
        id: "${firstRowId}",
        name: "First",
        email: "first@example.com",
        loyaltyTier: "bronze",
        sourceUuid: "20000000-0000-4000-8000-000000000001",
        sourceEnum: "ACTIVE",
        sourceDecimal: "12.34",
        sourceInteger: 42,
        indexedUuid: "30000000-0000-4000-8000-000000000001",
        indexedEnum: "ACTIVE",
        indexedDecimal: "34.56",
        indexedInteger: 84,
      },
      {
        id: "${secondRowId}",
        name: "Second",
        email: "second@example.com",
        loyaltyTier: "silver",
        sourceUuid: "20000000-0000-4000-8000-000000000002",
        sourceEnum: "INACTIVE",
        sourceDecimal: "56.78",
        sourceInteger: -7,
        indexedUuid: "30000000-0000-4000-8000-000000000002",
        indexedEnum: "INACTIVE",
        indexedDecimal: "78.90",
        indexedInteger: -14,
      },
    ])
    .execute();
}
`,
        );

        await runDeployCli(configPath, workspaceId, tempDir, signal);
        expect(await getMigrationCheckpoint(tailordbName)).toBe(6);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );

    test(
      "generates one phased migration for verified type pairs",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
  sourceUuid: db.string(),
  sourceEnum: db.string(),
  sourceDecimal: db.string(),
  sourceInteger: db.float(),
  indexedUuid: db.string().index(),
  indexedEnum: db.string().index(),
  indexedDecimal: db.string().index(),
  indexedInteger: db.float().index(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);

        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(8);
        expect(files[7]!.number).toBe(7);

        const diff = loadDiff(getMigrationFilePath(migrationsDir, 7, "diff"));
        expect(diff.changes).toHaveLength(8);
        expect(diff.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceUuid" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceEnum" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceDecimal" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceInteger" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedUuid" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedEnum" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedDecimal" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedInteger" }),
          ]),
        );
        expect(diff.breakingChanges.every((change) => !change.unsupported)).toBe(true);

        const migratePath = getMigrationFilePath(migrationsDir, 7, "migrate");
        const generatedScript = fs.readFileSync(migratePath, "utf-8");
        const reviewedScript = generatedScript.replaceAll(
          /const normalizedValue = TODO\("[^"]*"\);/g,
          "const normalizedValue = sourceValue;",
        );
        const defaultNormalization = `        const sourceValue = row.sourceUuid;
        if (sourceValue === null) continue;
        const normalizedValue = sourceValue;`;
        const exercisedNormalization = `        const sourceValue = row.sourceUuid;
        if (sourceValue === null) continue;
        const normalizedValue =
          sourceValue === "20000000-0000-4000-8000-000000000001"
            ? "20000000-0000-4000-8000-000000000011"
            : sourceValue;`;
        const editedScript = reviewedScript.replace(defaultNormalization, exercisedNormalization);
        expect(editedScript).not.toBe(reviewedScript);
        expect(editedScript).not.toMatch(/\bTODO\(/);
        fs.writeFileSync(migratePath, groupStepsIntoTwo(editedScript));

        await runDeployCli(configPath, workspaceId, tempDir, signal);
        expect(await getMigrationCheckpoint(tailordbName)).toBe(7);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );

    test(
      "reads, updates, and deletes source rows after the type changes",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
  sourceUuid: db.string(),
  sourceEnum: db.string(),
  sourceDecimal: db.string(),
  sourceInteger: db.float(),
  indexedUuid: db.string().index(),
  indexedEnum: db.string().index(),
  indexedDecimal: db.string().index(),
  indexedInteger: db.float().index(),
  verificationMarker: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);

        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(9);
        expect(files[8]!.number).toBe(8);

        overwriteMigrationScript(
          8,
          `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("User").selectAll().orderBy("id", "asc").execute();
  if (rows.length !== 2) {
    throw new Error(\`Expected two rows after type changes, received \${rows.length}\`);
  }
  for (const row of rows) {
    if (
      typeof row.sourceUuid !== "string" ||
      typeof row.sourceEnum !== "string" ||
      typeof row.sourceDecimal !== "string" ||
      typeof row.sourceInteger !== "number" ||
      typeof row.indexedUuid !== "string" ||
      typeof row.indexedEnum !== "string" ||
      typeof row.indexedDecimal !== "string" ||
      typeof row.indexedInteger !== "number"
    ) {
      throw new Error("Type-changed row did not decode through its target field types");
    }
  }
  const normalized = rows.find((row) => row.id === "${firstRowId}");
  if (normalized?.sourceUuid !== "20000000-0000-4000-8000-000000000011") {
    throw new Error("Generated field-type normalization update did not persist");
  }

  await trx
    .updateTable("User")
    .set({
      sourceUuid: "not-a-uuid",
      sourceEnum: "NOT_ENUM",
      sourceDecimal: "not-a-decimal",
      sourceInteger: 42.5,
      indexedUuid: "not-an-indexed-uuid",
      indexedEnum: "NOT_INDEXED_ENUM",
      indexedDecimal: "not-an-indexed-decimal",
      indexedInteger: 84.5,
      verificationMarker: "verified",
    })
    .where("id", "=", "${firstRowId}")
    .execute();
  await trx.deleteFrom("User").where("id", "=", "${secondRowId}").execute();

  const remaining = await trx.selectFrom("User").selectAll().execute();
  if (
    remaining.length !== 1 ||
    remaining[0]?.id !== "${firstRowId}" ||
    remaining[0]?.sourceUuid !== "not-a-uuid" ||
    remaining[0]?.sourceEnum !== "NOT_ENUM" ||
    remaining[0]?.sourceDecimal !== "not-a-decimal" ||
    remaining[0]?.sourceInteger !== 42.5 ||
    remaining[0]?.indexedUuid !== "not-an-indexed-uuid" ||
    remaining[0]?.indexedEnum !== "NOT_INDEXED_ENUM" ||
    remaining[0]?.indexedDecimal !== "not-an-indexed-decimal" ||
    remaining[0]?.indexedInteger !== 84.5
  ) {
    throw new Error("Target-type update or delete verification failed");
  }
}
`,
        );

        await runDeployCli(configPath, workspaceId, tempDir, signal);
        expect(await getMigrationCheckpoint(tailordbName)).toBe(8);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("Multi-step Migration Resume", () => {
    async function namespaceLabels(): Promise<Record<string, string>> {
      const { metadata } = await client.getMetadata({
        trn: resourceTrn(workspaceId, "tailordb", tailordbName),
      });
      return metadata?.labels ?? {};
    }

    async function migrationWorkflowExists(migrationNumber: number): Promise<boolean> {
      try {
        await client.getWorkflowByName({
          workspaceId,
          workflowName: migrationWorkflowResourceName(tailordbName, migrationNumber),
        });
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    }

    /**
     * Scenario 10: a step that fails after another step committed leaves the
     * migration in progress, keeping its Pre-phase schema for the next deploy.
     */
    test(
      "leaves a multi-step migration in progress when a later step fails",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
  sourceUuid: db.string(),
  sourceEnum: db.string(),
  sourceDecimal: db.string(),
  sourceInteger: db.float(),
  indexedUuid: db.string().index(),
  indexedEnum: db.string().index(),
  indexedDecimal: db.string().index(),
  indexedInteger: db.float().index(),
  verificationMarker: db.string(),
  stepTier: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);
        const files = getMigrationFiles(migrationsDir);
        expect(files.length).toBe(10);
        expect(files[9]!.number).toBe(9);

        overwriteMigrationScript(
          9,
          `import type { Transaction } from "./db";

export const steps = {
  backfill: {
    run: async (trx: Transaction) => {
      await trx.updateTable("User").set({ stepTier: "bronze" }).where("stepTier", "is", null).execute();
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async () => {
      throw new Error("simulated step failure for resume e2e");
    },
  },
};
`,
        );

        const result = await tryDeployCli(configPath, workspaceId, tempDir, signal);

        expect(result.ok).toBe(false);
        expect(result.output).toContain("MIGRATION_PARTIALLY_APPLIED");
        expect(result.output).toContain("simulated step failure for resume e2e");
        expect(await getMigrationCheckpoint(tailordbName)).toBe(8);
        expect(await getTailorDBTypeFields(tailordbName, "User")).toContain("stepTier");
        expect(await namespaceLabels()).toMatchObject({
          "sdk-migration-in-progress": "m0009",
          "sdk-migration-execution": expect.stringMatching(/^e[0-9a-f]{32}$/),
        });
        expect(await migrationWorkflowExists(9)).toBe(true);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 10b: the next deploy resumes the failed run with the fixed script;
     * the completed step does not run again.
     */
    test(
      "resumes from the failed step without re-running the completed one",
      async ({ signal }) => {
        overwriteMigrationScript(
          9,
          `import type { Transaction } from "./db";

export const steps = {
  backfill: {
    run: async () => {
      throw new Error("the completed backfill step must not run again");
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").select(["id", "stepTier"]).execute();
      if (rows.length === 0 || rows.some((row) => row.stepTier !== "bronze")) {
        throw new Error("backfill did not commit before the failed run");
      }
    },
  },
};
`,
        );

        const configPath = createConfig();
        await runDeployCli(configPath, workspaceId, tempDir, signal);

        expect(await getMigrationCheckpoint(tailordbName)).toBe(9);
        const labels = await namespaceLabels();
        expect(labels).not.toHaveProperty("sdk-migration-in-progress");
        expect(labels).not.toHaveProperty("sdk-migration-execution");
        expect(await migrationWorkflowExists(9)).toBe(false);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 11: a steps migration whose script exports onFailure = "rollback" gives its
     * Pre-phase schema back, clears the in-progress record and removes its workflow when a
     * later step fails.
     */
    test(
      "rolls a multi-step migration back when a later step fails and its script asks for it",
      async ({ signal }) => {
        updateTypeFile(`import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
  phone: db.string({ optional: true }),
  loyaltyTier: db.string(),
  sourceUuid: db.string(),
  sourceEnum: db.string(),
  sourceDecimal: db.string(),
  sourceInteger: db.float(),
  indexedUuid: db.string().index(),
  indexedEnum: db.string().index(),
  indexedDecimal: db.string().index(),
  indexedInteger: db.float().index(),
  verificationMarker: db.string(),
  stepTier: db.string(),
  rollbackTier: db.string(),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`);

        const configPath = createConfig();
        await runGenerateCli(configPath, tempDir, signal);
        expect(getMigrationFiles(migrationsDir).length).toBe(11);

        overwriteMigrationScript(
          10,
          `import type { Transaction } from "./db";

export const onFailure = "rollback";

export const steps = {
  backfill: {
    run: async (trx: Transaction) => {
      await trx.updateTable("User").set({ rollbackTier: "bronze" }).where("rollbackTier", "is", null).execute();
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async () => {
      throw new Error("simulated step failure for rollback e2e");
    },
  },
};
`,
        );

        const result = await tryDeployCli(configPath, workspaceId, tempDir, signal);

        expect(result.ok).toBe(false);
        expect(result.output).toContain("MIGRATION_ROLLED_BACK");
        expect(result.output).toContain("simulated step failure for rollback e2e");
        expect(await getMigrationCheckpoint(tailordbName)).toBe(9);
        expect(await getTailorDBTypeFields(tailordbName, "User")).not.toContain("rollbackTier");
        const labels = await namespaceLabels();
        expect(labels).not.toHaveProperty("sdk-migration-in-progress");
        expect(labels).not.toHaveProperty("sdk-migration-execution");
        expect(await migrationWorkflowExists(10)).toBe(false);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 11b: nothing is in progress after the rollback, so the next deploy runs every
     * step again from the beginning and commits the checkpoint.
     */
    test(
      "runs every step again on the next deploy after a rollback",
      async ({ signal }) => {
        overwriteMigrationScript(
          10,
          `import type { Transaction } from "./db";

export const onFailure = "rollback";

export const steps = {
  backfill: {
    run: async (trx: Transaction) => {
      await trx.updateTable("User").set({ rollbackTier: "bronze" }).where("rollbackTier", "is", null).execute();
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").select(["id", "rollbackTier"]).execute();
      if (rows.length === 0 || rows.some((row) => row.rollbackTier !== "bronze")) {
        throw new Error("backfill did not run again after the rollback");
      }
    },
  },
};
`,
        );

        const configPath = createConfig();
        await runDeployCli(configPath, workspaceId, tempDir, signal);

        expect(await getMigrationCheckpoint(tailordbName)).toBe(10);
        expect(await getTailorDBTypeFields(tailordbName, "User")).toContain("rollbackTier");
        const labels = await namespaceLabels();
        expect(labels).not.toHaveProperty("sdk-migration-in-progress");
        expect(await migrationWorkflowExists(10)).toBe(false);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });
});
