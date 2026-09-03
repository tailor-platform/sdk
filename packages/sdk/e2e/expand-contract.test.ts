/**
 * E2E coverage for converting a field type through a generated migration pair.
 *
 * Deploying successfully is not sufficient evidence that a conversion worked:
 * the platform accepts some schema changes that leave stored values unreadable
 * under the new type. Every assertion here reads the rows back.
 */

import { execFileSync } from "node:child_process";
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
import { MIGRATION_REVIEW_REQUIRED_MARKER } from "../src/cli/commands/tailordb/migrate/template-generator";
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
const testAppName = `expand-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `expanddb-${testRunId}`;

const FIRST_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_ID = "40000000-0000-4000-8000-000000000002";

describe("E2E: TailorDB expand-contract field type change", { concurrent: false }, () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let migrationsDir: string;

  function runCli(args: string[], timeout = 300000): void {
    const cliPath = path.join(path.resolve(__dirname, ".."), "bin", "tailor.mjs");
    execFileSync("node", [cliPath, ...args], {
      cwd: tempDir,
      stdio: ["ignore", "pipe", "pipe"],
      // A configured editor would open the generated script and block the run.
      env: { ...process.env, NODE_OPTIONS: "--experimental-vm-modules", EDITOR: "", VISUAL: "" },
      encoding: "utf-8",
      timeout,
    });
  }

  function tryCli(args: string[], timeout = 300000): { ok: boolean; output: string } {
    try {
      runCli(args, timeout);
      return { ok: true, output: "" };
    } catch (error: unknown) {
      const e = error as { stdout?: Buffer | string; stderr?: Buffer | string };
      return {
        ok: false,
        output: `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`,
      };
    }
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

  function updateTypeFile(priceType: string, extraFields = ""): void {
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "user.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  price: ${priceType},
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

  test("seeds integer values under the original type", async () => {
    updateTypeFile("db.int()");
    const configPath = createConfig();

    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);
    runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"]);

    // A schema change is what earns a migration to hang the seed script on.
    updateTypeFile("db.int()", "  seedMarker: db.string({ optional: true }),\n");
    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);
    fs.writeFileSync(
      getMigrationFilePath(migrationsDir, 1, "migrate"),
      `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      { id: "${FIRST_ID}", name: "First", email: "first@example.com", price: 1250 },
      { id: "${SECOND_ID}", name: "Second", email: "second@example.com", price: -7 },
    ])
    .execute();
}
`,
    );
    runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"]);

    expect(reconstructSnapshotFromMigrations(migrationsDir)?.tables.User?.fields.price?.type).toBe(
      "integer",
    );
  }, 900000);

  test("rejects the type change until the conversion is requested", async () => {
    updateTypeFile("db.bool()", "  seedMarker: db.string({ optional: true }),\n");
    const configPath = createConfig();

    const result = tryCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Unsupported schema changes detected");
  }, 300000);

  test("marks the generated conversion as needing review", async () => {
    const configPath = createConfig();

    runCli([
      "tailordb",
      "migration",
      "generate",
      "--config",
      configPath,
      "--yes",
      "--expand-contract",
      "User.price",
    ]);

    expect(fs.readFileSync(conversionScriptPath(), "utf8")).toContain(
      MIGRATION_REVIEW_REQUIRED_MARKER,
    );
  }, 600000);

  test("reports the unreviewed conversion through migration validate", async () => {
    const configPath = createConfig();

    const result = tryCli(["tailordb", "migration", "validate", "--config", configPath]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(MIGRATION_REVIEW_REQUIRED_MARKER);
  }, 300000);

  test("carries the values across when the conversion is filled in", async () => {
    const configPath = createConfig();
    const migratePath = conversionScriptPath();
    // The marker text contains regex metacharacters, so drop its lines literally.
    const reviewed = fs
      .readFileSync(migratePath, "utf8")
      .split("\n")
      .filter((line) => !line.includes(MIGRATION_REVIEW_REQUIRED_MARKER))
      .join("\n")
      .replace(
        "const convertedValue: never = sourceValue;",
        "const convertedValue = sourceValue > 0;",
      );
    expect(reviewed).not.toContain(MIGRATION_REVIEW_REQUIRED_MARKER);
    expect(reviewed).not.toContain(": never");
    fs.writeFileSync(migratePath, reviewed);

    runCli(["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"], 900000);
  }, 900000);

  test("reads every row back through the new type", async () => {
    const configPath = createConfig();
    updateTypeFile(
      "db.bool()",
      "  seedMarker: db.string({ optional: true }),\n  readbackMarker: db.string({ optional: true }),\n",
    );
    runCli(["tailordb", "migration", "generate", "--config", configPath, "--yes"]);

    const readbackNumber = Math.max(...getMigrationFiles(migrationsDir).map((f) => f.number));
    fs.writeFileSync(
      getMigrationFilePath(migrationsDir, readbackNumber, "migrate"),
      `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("User").selectAll().orderBy("id", "asc").execute();
  const seen = rows.map((row) => \`\${row.id}=\${typeof row.price}:\${String(row.price)}\`).join("|");
  if (seen !== "${FIRST_ID}=boolean:true|${SECOND_ID}=boolean:false") {
    throw new Error("PROBE_MISMATCH " + seen);
  }
  if ("priceMigrate" in rows[0]!) {
    throw new Error("PROBE_TEMP_FIELD_REMAINS");
  }
}
`,
    );

    const result = tryCli(
      ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
      900000,
    );
    expect(result.output).not.toContain("PROBE_MISMATCH");
    expect(result.output).not.toContain("PROBE_TEMP_FIELD_REMAINS");
    expect(result.ok).toBe(true);
  }, 900000);

  test("replays local history to the declared schema", () => {
    const replayed = reconstructSnapshotFromMigrations(migrationsDir);

    expect(replayed?.tables.User?.fields.price?.type).toBe("boolean");
    expect(replayed?.tables.User?.fields.priceMigrate).toBeUndefined();
  });
});
