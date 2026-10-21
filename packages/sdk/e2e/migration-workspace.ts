import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { aroundAll } from "vitest";
import { resourceTrn } from "../src/cli/commands/deploy/label";
import { migrationWorkflowResourceName } from "../src/cli/commands/deploy/tailordb/migration-workflow";
import { getMigrationFilePath } from "../src/cli/commands/tailordb/migrate/snapshot";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const E2E_WORKSPACE_PREFIX = "e2e-ws-";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "migration");

// A deploy killed mid data migration cannot roll back, and the leftover remote schema fails
// all later deploys closed, so each test outlasts the CLI calls it makes.
export const GENERATE_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.local);
export const DEPLOY_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.deploy);
export const GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS = cliTestTimeout(
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.deploy,
);

const BASE_USER_FIELDS = ["name: db.string()", "email: db.string().unique()"];

/**
 * A workspace, fixture directory and TailorDB namespace owned by one migration test file.
 * Each file creates its own so files can run in parallel.
 */
export class MigrationWorkspace {
  workspaceId!: string;
  client!: OperatorClient;
  tempDir!: string;
  readonly tailordbName: string;
  readonly workspaceName: string;
  private readonly appName: string;

  /**
   * @param suffix - Distinguishes this file's workspace and namespace from the other migration files
   */
  constructor(suffix: string) {
    const ciRunId = resolveE2ERunId();
    const testRunId = Date.now().toString(36);
    this.appName = `migration-e2e-${suffix}-${testRunId}`;
    this.workspaceName = `${E2E_WORKSPACE_PREFIX}${ciRunId ? `${ciRunId}-` : ""}${testRunId}-${suffix}`;
    this.tailordbName = `testdb-${suffix}-${testRunId}`;
  }

  get migrationsDir(): string {
    return path.join(this.tempDir, "migrations");
  }

  /**
   * Create the workspace and fixture directory around the enclosing describe block.
   * Call once inside that block.
   */
  register(): void {
    aroundAll(async (runSuite) => {
      this.client = await initOperatorClient(await loadAccessToken());

      const region = await resolveE2EWorkspaceRegion(this.client);
      console.log(`Creating workspace "${this.workspaceName}" in region "${region}"...`);
      const createResp = await this.client.createWorkspace({
        workspaceName: this.workspaceName,
        workspaceRegion: region,
        deleteProtection: false,
        organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
        folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
      });
      this.workspaceId = createResp.workspace!.id!;
      await trackWorkspace(this.client, this.workspaceId);
      console.log(`Workspace created: ${this.workspaceId}`);
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = this.workspaceId;

      this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-e2e-"));
      trackTempDir(this.tempDir);
      this.copyFixture();

      await runSuite();
    }, WORKSPACE_CREATION_ALLOWANCE_MS);
  }

  private copyFixture(): void {
    const sdkRoot = path.resolve(__dirname, "..");
    const destTailordb = path.join(this.tempDir, "tailordb");
    fs.mkdirSync(destTailordb, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "tailordb", "user.ts"),
      path.join(destTailordb, "user.ts"),
    );

    const destGenerated = path.join(this.tempDir, "generated");
    fs.mkdirSync(destGenerated, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "generated", "tailordb.ts"),
      path.join(destGenerated, "tailordb.ts"),
    );

    fs.mkdirSync(this.migrationsDir, { recursive: true });

    fs.writeFileSync(
      path.join(this.tempDir, "package.json"),
      JSON.stringify({ type: "module" }, null, 2),
    );

    // Module resolution for migration script bundling.
    const nodeModulesDir = path.join(this.tempDir, "node_modules");
    const tailorPlatformDir = path.join(nodeModulesDir, "@tailor-platform");
    fs.mkdirSync(tailorPlatformDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(tailorPlatformDir, "sdk"));

    // In the pnpm workspace these live in the monorepo root node_modules.
    const monorepoNodeModules = path.join(sdkRoot, "../..", "node_modules");
    fs.symlinkSync(path.join(monorepoNodeModules, "kysely"), path.join(nodeModulesDir, "kysely"));
    fs.symlinkSync(
      path.join(monorepoNodeModules, "@tailor-platform", "function-kysely-tailordb"),
      path.join(tailorPlatformDir, "function-kysely-tailordb"),
    );
  }

  /**
   * Copy a fixture table file next to user.ts.
   * @param fileName - File under fixtures/migration/tailordb
   */
  addTableFixture(fileName: string): void {
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "tailordb", fileName),
      path.join(this.tempDir, "tailordb", fileName),
    );
  }

  /**
   * Create config file from template with placeholders replaced
   * @returns Path to the created config file
   */
  createConfig(): string {
    const template = fs.readFileSync(path.join(FIXTURE_DIR, "config.template.ts"), "utf-8");
    const config = template
      .replace(/\{\{APP_NAME\}\}/g, this.appName)
      .replace(/\{\{TAILORDB_NAME\}\}/g, this.tailordbName);

    const configPath = path.join(this.tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, config);
    return configPath;
  }

  /**
   * Rewrite the User table with `name` and `email` plus the given fields
   * @param fieldLines - Extra field declarations, e.g. `role: db.string({ optional: true })`
   */
  writeUserTable(fieldLines: string[]): void {
    const fields = [...BASE_USER_FIELDS, ...fieldLines].map((line) => `  ${line},`).join("\n");
    fs.writeFileSync(
      path.join(this.tempDir, "tailordb", "user.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
${fields}
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );
  }

  /**
   * Edit migration script to replace its TODO placeholders with test values
   * @param migrationNumber - Migration number
   * @param replacements - Field name to value replacements
   */
  editMigrationScript(migrationNumber: number, replacements: Record<string, string>): void {
    const migratePath = getMigrationFilePath(this.migrationsDir, migrationNumber, "migrate");

    if (!fs.existsSync(migratePath)) {
      throw new Error(`Migration script not found: ${migratePath}`);
    }

    let content = fs.readFileSync(migratePath, "utf-8");
    for (const [fieldName, value] of Object.entries(replacements)) {
      // Replace patterns like: fieldName: TODO("..."),
      const pattern = new RegExp(`(${fieldName}:\\s*)TODO\\("[^"]*"\\)(,?)`, "g");
      content = content.replace(pattern, `$1${value}$2`);
    }
    fs.writeFileSync(migratePath, content);
  }

  /**
   * Overwrite a migration's migrate.ts with the given script body.
   * @param migrationNumber - Migration number
   * @param body - Full TypeScript source to write
   */
  overwriteMigrationScript(migrationNumber: number, body: string): void {
    fs.writeFileSync(getMigrationFilePath(this.migrationsDir, migrationNumber, "migrate"), body);
  }

  /**
   * Run the generate CLI command via subprocess
   * @param signal - The calling test's signal
   */
  async runGenerate(signal: AbortSignal | undefined): Promise<void> {
    await runCli(["tailordb", "migration", "generate", "--config", this.createConfig(), "--yes"], {
      cwd: this.tempDir,
      timeoutMs: CLI_BUDGET_MS.local,
      signal,
    });
  }

  /**
   * Run the deploy CLI command via subprocess
   * @param signal - The calling test's signal
   */
  async runDeploy(signal: AbortSignal | undefined): Promise<void> {
    await runCli(this.deployArgs(), {
      cwd: this.tempDir,
      timeoutMs: CLI_BUDGET_MS.deploy,
      signal,
    });
  }

  /**
   * Run the deploy CLI command, returning the result instead of throwing so callers
   * can assert on an expected failure. A deploy killed for exceeding its budget still
   * rejects: it did not fail, it was interrupted.
   * @param signal - The calling test's signal
   * @returns Whether deploy succeeded and its combined output
   */
  tryDeploy(signal: AbortSignal | undefined): Promise<CliResult> {
    return tryCli(this.deployArgs(), {
      cwd: this.tempDir,
      timeoutMs: CLI_BUDGET_MS.deploy,
      signal,
    });
  }

  private deployArgs(): string[] {
    return ["deploy", "--config", this.createConfig(), "--workspace-id", this.workspaceId, "--yes"];
  }

  /**
   * Run pending migrations against a designated E2E target workspace.
   * @param targetWorkspaceId - Empty throwaway workspace retained for assertions
   * @param assertionPath - Post-migration assertion script
   * @param signal - The calling test's signal
   */
  async runMigrationTest(
    targetWorkspaceId: string,
    assertionPath: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await runCli(
      [
        "tailordb",
        "migration",
        "test",
        "--config",
        this.createConfig(),
        "--workspace-id",
        this.workspaceId,
        "--target-workspace-id",
        targetWorkspaceId,
        "--data",
        "seed",
        "--assert",
        assertionPath,
        "--yes",
      ],
      { cwd: this.tempDir, timeoutMs: CLI_BUDGET_MS.deploy, signal },
    );
  }

  /**
   * List all TailorDB service namespaces in the workspace
   * @returns List of TailorDB service namespace names
   */
  async listTailorDBServiceNames(): Promise<string[]> {
    const services: string[] = [];
    let pageToken = "";
    do {
      const resp = await this.client.listTailorDBServices({
        workspaceId: this.workspaceId,
        pageToken,
      });
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
   * List all TailorDB table names in the test namespace
   * @returns List of table names
   */
  async listTailorDBTypeNames(): Promise<string[]> {
    const types: string[] = [];
    let pageToken = "";
    do {
      const resp = await this.client.listTailorDBTypes({
        workspaceId: this.workspaceId,
        namespaceName: this.tailordbName,
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
   * Get field names for a table in the test namespace
   * @param tableName - Table name
   * @returns List of field names
   */
  async getTailorDBTypeFields(tableName: string): Promise<string[]> {
    const resp = await this.client.getTailorDBType({
      workspaceId: this.workspaceId,
      namespaceName: this.tailordbName,
      tailordbTypeName: tableName,
    });
    return Object.keys(resp.tailordbType?.schema?.fields ?? {});
  }

  /**
   * Read the labels on the TailorDB service metadata.
   * @returns The namespace's labels
   */
  async namespaceLabels(): Promise<Record<string, string>> {
    const { metadata } = await this.client.getMetadata({
      trn: resourceTrn(this.workspaceId, "tailordb", this.tailordbName),
    });
    return metadata?.labels ?? {};
  }

  /**
   * Read the applied migration checkpoint number from the TailorDB service metadata.
   * @returns The applied migration number, or null if no checkpoint label is set
   */
  async getMigrationCheckpoint(): Promise<number | null> {
    const label = (await this.namespaceLabels())[MIGRATION_LABEL_KEY];
    return label ? parseMigrationLabelNumber(label) : null;
  }

  /**
   * @param migrationNumber - Migration number
   * @returns Whether the migration's temporary workflow still exists
   */
  async migrationWorkflowExists(migrationNumber: number): Promise<boolean> {
    try {
      await this.client.getWorkflowByName({
        workspaceId: this.workspaceId,
        workflowName: migrationWorkflowResourceName(this.tailordbName, migrationNumber),
      });
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }
}
