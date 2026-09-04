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

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, aroundAll } from "vitest";
import {
  getMigrationFilePath,
  getMigrationFiles,
  loadDiff,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
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

describe("E2E: TailorDB nested member removal", { concurrent: false }, () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;

  // The CLI logs to stderr, so both streams are needed to see its output.
  function tryCli(args: string[], timeout = 300000): { ok: boolean; output: string } {
    const cliPath = path.join(path.resolve(__dirname, ".."), "bin", "tailor.mjs");
    const result = spawnSync("node", [cliPath, ...args], {
      cwd: tempDir,
      stdio: ["ignore", "pipe", "pipe"],
      // A configured editor would open the generated script and block the run.
      env: { ...process.env, NODE_OPTIONS: "--experimental-vm-modules", EDITOR: "", VISUAL: "" },
      encoding: "utf-8",
      timeout,
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}` };
  }

  function runCli(args: string[], timeout = 300000): string {
    const result = tryCli(args, timeout);
    if (!result.ok) {
      throw new Error(`tailor ${args.join(" ")} failed:\n${result.output}`);
    }
    return result.output;
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

  test("seeds rows with the original nested member", async () => {
    updateTypeFile("zip");
    const configPath = createConfig();

    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);
    runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"]);

    // A schema change is what earns a migration to hang the seed script on.
    updateTypeFile("zip", "  seedMarker: db.string({ optional: true }),\n");
    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);
    fs.writeFileSync(
      getMigrationFilePath(migrationsDir, latestMigrationNumber(), "migrate"),
      `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      {
        id: "${FIRST_ID}",
        name: "First",
        email: "first@example.com",
        address: { city: "Tokyo", zip: "150-0001" } as never,
      },
      {
        id: "${SECOND_ID}",
        name: "Second",
        email: "second@example.com",
        address: { city: "Osaka", zip: "530-0001" } as never,
      },
    ])
    .execute();
}
`,
    );
    runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"]);

    expect(await nestedMemberNames()).toEqual(["city", "zip"]);
  }, 900000);

  test("fails on the unresolved rename candidate without --rename", async () => {
    updateTypeFile("zipCode", "  seedMarker: db.string({ optional: true }),\n");
    const configPath = createConfig();

    const result = tryCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Possible rename(s) detected");
    expect(result.output).toContain("User.address.zip → zipCode?");
  }, 300000);

  test("records the rename and scaffolds a copy script with --rename", async () => {
    const configPath = createConfig();

    runCli([
      "tailordb",
      "migration",
      "generate",
      "--config",
      configPath,
      "--yes",
      "--rename",
      "User.address.zip:zipCode",
    ]);

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
  }, 300000);

  test("copies the renamed member with the generated script", async () => {
    const configPath = createConfig();

    const result = tryCli(
      ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
      900000,
    );
    if (!result.ok) throw new Error(`deploy failed:\n${result.output}`);
    expect(result.ok).toBe(true);

    const resp = await client.getTailorDBType({
      workspaceId,
      namespaceName: tailordbName,
      tailordbTypeName: "User",
    });
    const members = resp.tailordbType?.schema?.fields.address?.fields ?? {};
    expect(Object.keys(members).toSorted()).toEqual(["city", "zipCode"]);
    expect(members.zipCode?.required).toBe(true);
  }, 900000);

  test("reads the copied member back under its new name", async () => {
    const configPath = createConfig();
    updateTypeFile(
      "zipCode",
      "  seedMarker: db.string({ optional: true }),\n  readbackMarker: db.string({ optional: true }),\n",
    );
    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);

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

    const result = tryCli(
      ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
      900000,
    );
    expect(result.output).not.toContain("PROBE_MISMATCH");
    if (!result.ok) throw new Error(`deploy failed:\n${result.output}`);
    expect(result.ok).toBe(true);
  }, 900000);
});
