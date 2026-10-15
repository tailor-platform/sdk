/**
 * E2E coverage for converting a field type, and a single value into an array,
 * through a generated migration pair.
 *
 * Deploying successfully is not sufficient evidence that a conversion worked:
 * the platform accepts some schema changes that leave stored values unreadable
 * under the new type. Every assertion here reads the rows back.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, aroundAll } from "vitest";
import {
  getMigrationFilePath,
  getMigrationFiles,
  reconstructSnapshotFromMigrations,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { CLI_BUDGET_MS, cliTestTimeout, runCli, tryCli } from "./cli";
import {
  resolveE2ERunId,
  resolveE2EWorkspaceRegion,
  trackWorkspace,
  trackTempDir,
} from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_DIR = path.join(__dirname, "fixtures", "migration");

const ciRunId = resolveE2ERunId();
const testRunId = Date.now().toString(36);
const testAppName = `expand-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `expanddb-${testRunId}`;

const FIRST_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_ID = "40000000-0000-4000-8000-000000000002";

const GENERATE_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.local);
const SEED_TEST_TIMEOUT_MS = cliTestTimeout(
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.deploy,
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.deploy,
);
const MIGRATE_TEST_TIMEOUT_MS = cliTestTimeout(CLI_BUDGET_MS.migratingDeploy);
const GENERATE_AND_MIGRATE_TEST_TIMEOUT_MS = cliTestTimeout(
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.migratingDeploy,
);

describe("E2E: TailorDB expand-contract field type change", { concurrent: false }, () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;

  function runInTempDir(args: string[], timeoutMs: number) {
    return runCli(args, { cwd: tempDir, timeoutMs });
  }

  function tryInTempDir(args: string[], timeoutMs: number) {
    return tryCli(args, { cwd: tempDir, timeoutMs });
  }

  /**
   * Locate the generated conversion script by its contents, so the assertions
   * do not depend on how many migrations the earlier steps produced.
   * @returns Path to the migration script holding the conversion
   */
  function conversionScriptPath(): string {
    for (const file of getMigrationFiles(migrationsDir)) {
      if (file.type !== "diff") continue;
      const migratePath = getMigrationFilePath(migrationsDir, file.number, "migrate");
      if (!fs.existsSync(migratePath)) continue;
      if (fs.readFileSync(migratePath, "utf8").includes("convertedValue")) return migratePath;
    }
    throw new Error("No generated conversion script found");
  }

  function createConfig(): string {
    const template = fs.readFileSync(path.join(FIXTURE_DIR, "config.template.ts"), "utf-8");
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(
      configPath,
      template
        .replace(/\{\{APP_NAME\}\}/g, testAppName)
        .replace(/\{\{TAILORDB_NAME\}\}/g, tailordbName),
    );
    return configPath;
  }

  function updateTypeFile(priceType: string, tagsType: string, extraFields = ""): void {
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "user.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  price: ${priceType},
  tags: ${tagsType},
${extraFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );
  }

  aroundAll(async (runSuite) => {
    const accessToken = await loadAccessToken();
    client = await initOperatorClient(accessToken);
    const region = await resolveE2EWorkspaceRegion(client);

    const createResp = await client.createWorkspace({
      workspaceName: testWorkspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id!;
    trackWorkspace(workspaceId);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "expand-e2e-"));
    trackTempDir(tempDir);
    migrationsDir = path.join(tempDir, "migrations");

    delete process.env.EDITOR;
    delete process.env.VISUAL;

    fs.mkdirSync(path.join(tempDir, "tailordb"), { recursive: true });
    fs.mkdirSync(migrationsDir, { recursive: true });
    const generatedDir = path.join(tempDir, "generated");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "generated", "tailordb.ts"),
      path.join(generatedDir, "tailordb.ts"),
    );
    fs.mkdirSync(path.join(tempDir, "seed", "data"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

    const nodeModulesDir = path.join(tempDir, "node_modules");
    const tailorPlatformDir = path.join(nodeModulesDir, "@tailor-platform");
    fs.mkdirSync(tailorPlatformDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(tailorPlatformDir, "sdk"));
    const monorepoNodeModules = path.resolve(sdkRoot, "../..", "node_modules");
    fs.symlinkSync(path.join(monorepoNodeModules, "kysely"), path.join(nodeModulesDir, "kysely"));
    fs.symlinkSync(
      path.join(monorepoNodeModules, "@tailor-platform", "function-kysely-tailordb"),
      path.join(tailorPlatformDir, "function-kysely-tailordb"),
    );

    await runSuite();
  }, 300000);

  test(
    "seeds integer values under the original type",
    async () => {
      updateTypeFile("db.int()", "db.string()");
      const configPath = createConfig();

      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );
      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.deploy,
      );

      // A schema change is what earns a migration to hang the seed script on.
      updateTypeFile("db.int()", "db.string()", "  seedMarker: db.string({ optional: true }),\n");
      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );
      fs.writeFileSync(
        getMigrationFilePath(migrationsDir, 1, "migrate"),
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      { id: "${FIRST_ID}", name: "First", email: "first@example.com", price: 1250, tags: "alpha" },
      { id: "${SECOND_ID}", name: "Second", email: "second@example.com", price: -7, tags: "beta" },
    ])
    .execute();
}
`,
      );
      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.deploy,
      );

      expect(
        reconstructSnapshotFromMigrations(migrationsDir)?.tables.User?.fields.price?.type,
      ).toBe("integer");
    },
    SEED_TEST_TIMEOUT_MS,
  );

  test(
    "rejects the type change until the conversion is requested",
    async () => {
      updateTypeFile(
        "db.bool()",
        "db.string({ array: true })",
        "  seedMarker: db.string({ optional: true }),\n",
      );
      const configPath = createConfig();

      const result = await tryInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );

      expect(result.ok).toBe(false);
      expect(result.output).toContain("Unsupported schema changes detected");
    },
    GENERATE_TEST_TIMEOUT_MS,
  );

  test(
    "marks the generated conversion as needing review",
    async () => {
      const configPath = createConfig();

      await runInTempDir(
        [
          "tailordb",
          "migration",
          "generate",
          "--config",
          configPath,
          "--yes",
          "--expand-contract",
          "User.price",
          "--expand-contract",
          "User.tags",
        ],
        CLI_BUDGET_MS.local,
      );

      const script = fs.readFileSync(conversionScriptPath(), "utf8");
      // The array conversion is mechanical, so only the price conversion asks for review.
      expect(script).toContain(`["tagsMigrate"]: convertedValue`);
      expect(script.match(/\bTODO\(/g)).toHaveLength(1);
    },
    GENERATE_TEST_TIMEOUT_MS,
  );

  test(
    "reports the unreviewed conversion through migration validate",
    async () => {
      const configPath = createConfig();

      const result = await tryInTempDir(
        ["tailordb", "migration", "validate", "--config", configPath],
        CLI_BUDGET_MS.local,
      );

      expect(result.ok).toBe(false);
      expect(result.output).toContain("TODO()");
    },
    GENERATE_TEST_TIMEOUT_MS,
  );

  test(
    "carries the values across when the conversion is filled in",
    async () => {
      const configPath = createConfig();
      const migratePath = conversionScriptPath();
      const reviewed = fs
        .readFileSync(migratePath, "utf8")
        .replace(
          /const convertedValue = TODO\("[^"]*"\);/,
          "const convertedValue = row.price > 0;",
        );
      expect(reviewed).not.toMatch(/\bTODO\(/);
      fs.writeFileSync(migratePath, reviewed);

      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
      );
    },
    MIGRATE_TEST_TIMEOUT_MS,
  );

  test(
    "reads every row back through the new type",
    async () => {
      const configPath = createConfig();
      updateTypeFile(
        "db.bool()",
        "db.string({ array: true })",
        "  seedMarker: db.string({ optional: true }),\n  readbackMarker: db.string({ optional: true }),\n",
      );
      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );

      const readbackNumber = Math.max(...getMigrationFiles(migrationsDir).map((f) => f.number));
      fs.writeFileSync(
        getMigrationFilePath(migrationsDir, readbackNumber, "migrate"),
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("User").selectAll().orderBy("id", "asc").execute();
  const seen = rows
    .map((row) => \`\${row.id}=\${typeof row.price}:\${String(row.price)}:\${JSON.stringify(row.tags)}\`)
    .join("|");
  if (seen !== '${FIRST_ID}=boolean:true:["alpha"]|${SECOND_ID}=boolean:false:["beta"]') {
    throw new Error("PROBE_MISMATCH " + seen);
  }
  if ("priceMigrate" in rows[0]! || "tagsMigrate" in rows[0]!) {
    throw new Error("PROBE_TEMP_FIELD_REMAINS");
  }
}
`,
      );

      const result = await tryInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
      );
      expect(result.output).not.toContain("PROBE_MISMATCH");
      expect(result.output).not.toContain("PROBE_TEMP_FIELD_REMAINS");
      expect(result.ok).toBe(true);
    },
    GENERATE_AND_MIGRATE_TEST_TIMEOUT_MS,
  );

  test("replays local history to the declared schema", () => {
    const replayed = reconstructSnapshotFromMigrations(migrationsDir);

    expect(replayed?.tables.User?.fields.price?.type).toBe("boolean");
    expect(replayed?.tables.User?.fields.priceMigrate).toBeUndefined();
    expect(replayed?.tables.User?.fields.tags).toEqual(
      expect.objectContaining({ type: "string", array: true }),
    );
    expect(replayed?.tables.User?.fields.tagsMigrate).toBeUndefined();
  });
});
