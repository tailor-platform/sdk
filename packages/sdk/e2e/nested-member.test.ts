/**
 * E2E coverage for renaming a member inside a nested field.
 *
 * `migration generate` must detect the removed + added member pair, record the
 * confirmed rename, and scaffold a copy script. During deploy the pre-migration
 * phase must keep the old member readable and relax the required new member so
 * the generated script can copy the values before the post-migration phase
 * drops the old member. Every assertion reads the rows back from inside a
 * migration script.
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
  loadDiff,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { createKyselyPGlite } from "../src/vitest/pglite-kysely";
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
const testAppName = `nested-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `nesteddb-${testRunId}`;

const FIRST_ID = "50000000-0000-4000-8000-000000000001";
const SECOND_ID = "50000000-0000-4000-8000-000000000002";

describe("E2E: TailorDB nested member rename", { concurrent: false }, () => {
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

  function updateTypeFile(zipMember: string, extraFields = ""): void {
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "user.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  address: db.object({ city: db.string(), ${zipMember}: db.string() }, { optional: true }),
  addressHistory: db.object({ city: db.string(), zip: db.string() }, { array: true, optional: true }),
${extraFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );
  }

  function latestMigrationNumber(): number {
    return Math.max(...getMigrationFiles(migrationsDir).map((f) => f.number));
  }

  async function nestedMemberNames(): Promise<string[]> {
    const resp = await client.getTailorDBType({
      workspaceId,
      namespaceName: tailordbName,
      tailordbTypeName: "User",
    });
    return Object.keys(resp.tailordbType?.schema?.fields.address?.fields ?? {}).toSorted();
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nested-e2e-"));
    trackTempDir(tempDir);
    migrationsDir = path.join(tempDir, "migrations");

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
    const sdkNodeModules = path.join(sdkRoot, "node_modules");
    fs.symlinkSync(path.join(sdkNodeModules, "kysely"), path.join(nodeModulesDir, "kysely"));
    fs.symlinkSync(
      path.join(sdkNodeModules, "@tailor-platform", "function-kysely-tailordb"),
      path.join(tailorPlatformDir, "function-kysely-tailordb"),
    );

    await runSuite();
  }, 300000);

  test(
    "writes nested objects and arrays through the same migration on PGlite and TailorDB",
    async () => {
      updateTypeFile("zip");
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
      updateTypeFile("zip", "  seedMarker: db.string({ optional: true }),\n");
      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
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
      );
      const scriptPath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
      fs.writeFileSync(
        scriptPath,
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      {
        id: "${FIRST_ID}",
        name: "First",
        email: "first@example.com",
        address: { city: "Tokyo", zip: "150-0001" },
        addressHistory: [{ city: "Kyoto", zip: "600-0001" }],
      },
      {
        id: "${SECOND_ID}",
        name: "Second",
        email: "second@example.com",
        address: null,
        addressHistory: null,
      },
    ])
    .execute();
  await trx.updateTable("User").set({
    address: { city: "Osaka", zip: "530-0001" },
    addressHistory: [],
  }).where("id", "=", "${SECOND_ID}").execute();
  const rows = await trx.selectFrom("User")
    .select(["id", "address", "addressHistory"]).orderBy("id").execute();
  const first = rows[0];
  const second = rows[1];
  if (rows.length !== 2 || first?.address?.city !== "Tokyo" ||
      !Array.isArray(first.addressHistory) || first.addressHistory.length !== 1 ||
      first.addressHistory[0]?.city !== "Kyoto" || second?.address?.city !== "Osaka" ||
      !Array.isArray(second.addressHistory) || second.addressHistory.length !== 0) {
    throw new Error("Nested write parity failed: " + JSON.stringify(rows));
  }
}
`,
      );
      const schemaPath = getMigrationFilePath(migrationsDir, migrationNumber, "pgliteSchema");
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
      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.deploy,
      );

      expect(await nestedMemberNames()).toEqual(["city", "zip"]);
    },
    cliTestTimeout(
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.deploy,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.deploy,
    ),
  );

  test(
    "fails on the unresolved rename candidate without --rename",
    async () => {
      updateTypeFile("zipCode", "  seedMarker: db.string({ optional: true }),\n");
      const configPath = createConfig();

      const result = await tryInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );

      expect(result.ok).toBe(false);
      expect(result.output).toContain("Possible rename(s) detected");
      expect(result.output).toContain("User.address.zip → zipCode?");
    },
    cliTestTimeout(CLI_BUDGET_MS.local),
  );

  test(
    "records the rename and scaffolds a copy script with --rename",
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
          "--rename",
          "User.address.zip:zipCode",
        ],
        CLI_BUDGET_MS.local,
      );

      const migrationNumber = latestMigrationNumber();
      const diff = loadDiff(getMigrationFilePath(migrationsDir, migrationNumber, "diff"));
      expect(diff.changes).toEqual([
        expect.objectContaining({
          kind: "field_modified",
          fieldName: "address",
          memberRenames: [{ previousPath: ["zip"], path: ["zipCode"] }],
        }),
      ]);
      expect(diff.requiresMigrationScript).toBe(true);
      expect(diff.warnings).toEqual([]);
      const script = fs.readFileSync(
        getMigrationFilePath(migrationsDir, migrationNumber, "migrate"),
        "utf-8",
      );
      expect(script).toContain('renameNestedMember(value, ["zip"], "zipCode")');
    },
    cliTestTimeout(CLI_BUDGET_MS.local),
  );

  test(
    "copies the renamed member with the generated script",
    async () => {
      const configPath = createConfig();

      await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
      );

      const resp = await client.getTailorDBType({
        workspaceId,
        namespaceName: tailordbName,
        tailordbTypeName: "User",
      });
      const members = resp.tailordbType?.schema?.fields.address?.fields ?? {};
      expect(Object.keys(members).toSorted()).toEqual(["city", "zipCode"]);
      expect(members.zipCode?.required).toBe(true);
    },
    cliTestTimeout(CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "reads the copied member back under its new name",
    async () => {
      const configPath = createConfig();
      updateTypeFile(
        "zipCode",
        "  seedMarker: db.string({ optional: true }),\n  readbackMarker: db.string({ optional: true }),\n",
      );
      await runInTempDir(
        ["tailordb", "migration", "generate", "--config", configPath, "--yes"],
        CLI_BUDGET_MS.local,
      );

      fs.writeFileSync(
        getMigrationFilePath(migrationsDir, latestMigrationNumber(), "migrate"),
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("User").selectAll().orderBy("id", "asc").execute();
  // The platform does not preserve member order, so compare sorted keys.
  const sorted = (value: Record<string, unknown>) =>
    JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  const seen = rows
    .map((row) => {
      const raw: unknown = row.address;
      return row.id + "=" + typeof raw + ":" + sorted(raw as Record<string, unknown>);
    })
    .join("|");
  const expected = [
    "${FIRST_ID}=object:" + JSON.stringify({ city: "Tokyo", zipCode: "150-0001" }),
    "${SECOND_ID}=object:" + JSON.stringify({ city: "Osaka", zipCode: "530-0001" }),
  ].join("|");
  if (seen !== expected) {
    throw new Error("PROBE_MISMATCH " + seen);
  }
}
`,
      );

      const result = await tryInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
      );
      expect(result.output).not.toContain("PROBE_MISMATCH");
      expect(result.ok).toBe(true);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );
});
