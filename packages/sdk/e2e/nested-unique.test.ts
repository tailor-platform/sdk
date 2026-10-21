/**
 * E2E coverage for `.unique()` on a field inside `db.object()`.
 *
 * The constraint must reach the platform on the inner field, and the platform
 * must reject a second row whose inner value duplicates the first. The writes
 * run inside a migration script, the way the nested relation suite does.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, aroundAll } from "vitest";
import {
  formatMigrationNumber,
  getMigrationFilePath,
  getMigrationFiles,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { CLI_BUDGET_MS, cliTestTimeout, runCli } from "./cli";
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
const testAppName = `nesteduq-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `nesteduqdb-${testRunId}`;

describe("E2E: unique field inside a nested field", { concurrent: false }, () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;

  function runInTempDir(args: string[], timeoutMs: number, signal: AbortSignal) {
    return runCli(args, { cwd: tempDir, timeoutMs, signal });
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

  function writeOrderType(extraFields = ""): void {
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "order.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const order = db.table("Order", {
  info: db.object({ code: db.string({ optional: true }).unique() }, { optional: true }),
${extraFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type order = typeof order;
`,
    );
  }

  function latestMigrationNumber(): number {
    return Math.max(...getMigrationFiles(migrationsDir).map((f) => f.number));
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
    await trackWorkspace(client, workspaceId);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nesteduq-e2e-"));
    trackTempDir(tempDir);
    migrationsDir = path.join(tempDir, "migrations");

    fs.mkdirSync(path.join(tempDir, "tailordb"), { recursive: true });
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "tailordb", "user.ts"),
      path.join(tempDir, "tailordb", "user.ts"),
    );
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
    const sdkNodeModules = path.join(sdkRoot, "node_modules");
    fs.symlinkSync(path.join(sdkNodeModules, "kysely"), path.join(nodeModulesDir, "kysely"));
    fs.symlinkSync(
      path.join(sdkNodeModules, "@tailor-platform", "function-kysely-tailordb"),
      path.join(tailorPlatformDir, "function-kysely-tailordb"),
    );

    await runSuite();
  }, 300000);

  test(
    "stores the unique constraint on the inner field of a nested field",
    async ({ signal }) => {
      writeOrderType();
      const configPath = createConfig();

      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
        signal,
      );
      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.deploy,
        signal,
      );

      const resp = await client.getTailorDBType({
        workspaceId,
        namespaceName: tailordbName,
        tailordbTypeName: "Order",
      });
      expect(resp.tailordbType?.schema?.fields.info?.fields.code).toMatchObject({
        unique: true,
        index: true,
      });
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.deploy),
  );

  test(
    "rejects a second row whose inner value duplicates the first",
    async ({ signal }) => {
      writeOrderType("  marker: db.string({ optional: true }),\n");
      const configPath = createConfig();
      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
        signal,
      );
      const migrationNumber = latestMigrationNumber();
      await runInTempDir(
        [
          "tailordb",
          "migration",
          "script",
          formatMigrationNumber(migrationNumber),
          "--config",
          configPath,
        ],
        CLI_BUDGET_MS.local,
        signal,
      );
      fs.writeFileSync(
        getMigrationFilePath(migrationsDir, migrationNumber, "migrate"),
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx.insertInto("Order").values({ info: { code: "dup" } }).execute();
  await trx.insertInto("Order").values({ info: { code: "other" } }).execute();

  let message: string | null = null;
  try {
    await trx.insertInto("Order").values({ info: { code: "dup" } }).execute();
  } catch (error) {
    message = String(error);
  }
  if (message === null) {
    throw new Error("a duplicate inner value was accepted");
  }
  if (!/unique|duplicate/i.test(message)) {
    throw new Error("unexpected error: " + message);
  }
}
`,
      );

      const deploy = await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
        signal,
      );

      expect(deploy.exitCode).toBe(0);
      expect(deploy.output).toContain("Executing 1 data migration(s)");
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );
});
