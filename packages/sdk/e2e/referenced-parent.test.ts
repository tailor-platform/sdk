/**
 * E2E coverage for removing or changing a parent that an array field, or a
 * field inside a nested object, still points at.
 *
 * Each case runs the same migration script against PGlite (the schema
 * `migration script` writes) and against the platform, and the script itself
 * asserts that the write is refused. A refused write aborts the transaction, so
 * every case runs in a migration of its own, with the refused write last.
 */

import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, test, expect, aroundAll } from "vitest";
import {
  formatMigrationNumber,
  getMigrationFilePath,
  getMigrationFiles,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { createKyselyPGlite } from "../src/vitest/pglite-kysely";
import { CLI_BUDGET_MS, cliTestTimeout, runCli, type CliResult } from "./cli";
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
const testAppName = `parentref-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `parentrefdb-${testRunId}`;

const PARENT_ID = "70000000-0000-4000-8000-000000000001";

describe("E2E: parent referenced from an array or nested value", { concurrent: false }, () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;
  let markerCount = 0;

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

  function writeOrderType(markers: number): void {
    const markerFields = Array.from(
      { length: markers },
      (_, index) => `  marker${index}: db.string({ optional: true }),\n`,
    ).join("");
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "order.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
import { user } from "./user";

export const order = db.table("Order", {
  ownerIDs: db.uuid({ array: true, optional: true }).relation({ type: "keyOnly", toward: { table: user } }),
  emails: db.string({ array: true, optional: true }).relation({ type: "keyOnly", toward: { table: user, key: "email" } }),
  info: db.object(
    { ownerID: db.uuid({ optional: true }).relation({ type: "keyOnly", toward: { table: user } }) },
    { optional: true },
  ),
${markerFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type order = typeof order;
`,
    );
  }

  function latestMigrationNumber(): number {
    return Math.max(...getMigrationFiles(migrationsDir).map((f) => f.number));
  }

  function refusedWriteScript(order: string, refused: string, email: string): string {
    return `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values({ id: "${PARENT_ID}", name: "Parent", email: "${email}" })
    .execute();
  await trx.insertInto("Order").values(${order}).execute();

  let message: string | null = null;
  try {
    await ${refused};
  } catch (error) {
    message = String(error);
  }
  if (message === null) {
    throw new Error("the write was accepted although a row still points at the parent");
  }
  if (!/foreign key/i.test(message)) {
    throw new Error("unexpected error: " + message);
  }
}
`;
  }

  async function runOnPglite(migrationNumber: number): Promise<void> {
    const schemaPath = getMigrationFilePath(migrationsDir, migrationNumber, "pgliteSchema");
    const scriptPath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
    const { pgliteSchema } = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(fs.readFileSync(schemaPath, "utf8"))).toString("base64")}`
    );
    const { main } = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(fs.readFileSync(scriptPath, "utf8"))).toString("base64")}`
    );
    const pglite = new PGlite();
    const db = createKyselyPGlite(pglite);
    try {
      await pglite.exec(pgliteSchema[tailordbName]);
      await db.transaction().execute(main);
    } finally {
      await db.destroy();
    }
  }

  async function migrateWithScript(
    script: string,
    signal: AbortSignal,
    pglite = true,
  ): Promise<CliResult> {
    markerCount += 1;
    writeOrderType(markerCount);
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
    fs.writeFileSync(getMigrationFilePath(migrationsDir, migrationNumber, "migrate"), script);
    if (pglite) await runOnPglite(migrationNumber);
    return runInTempDir(
      ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
      CLI_BUDGET_MS.migratingDeploy,
      signal,
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
    await trackWorkspace(client, workspaceId);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parentref-e2e-"));
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

    writeOrderType(0);
    await runSuite();
  }, 300000);

  test(
    "deploys the schema the cases build on",
    async ({ signal }) => {
      const configPath = createConfig();

      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
        signal,
      );
      const deploy = await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.deploy,
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.deploy),
  );

  test(
    "refuses to delete a parent that an element of an array field points at",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          `{ ownerIDs: ["${PARENT_ID}"] }`,
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
          "array@example.com",
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "refuses to delete a parent that a nested value points at",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          `{ info: { ownerID: "${PARENT_ID}" } }`,
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
          "nested@example.com",
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "refuses to delete a parent that an array field points at by another key",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          `{ emails: ["keyed@example.com"] }`,
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
          "keyed@example.com",
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "refuses to change the key a parent is pointed at by",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          `{ emails: ["renamed@example.com"] }`,
          `trx.updateTable("User").set({ email: "other@example.com" }).where("id", "=", "${PARENT_ID}").execute()`,
          "renamed@example.com",
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );
});
