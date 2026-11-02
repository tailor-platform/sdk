/**
 * E2E coverage for a relation written on a field inside `db.object()`.
 *
 * The relation must reach the platform as a foreign key on the inner field, and
 * the platform must reject a nested value that points at a missing parent while
 * accepting one that points at an existing parent. The writes run inside a
 * migration script, the way the nested member suite reads its rows back.
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
const testAppName = `nestedrel-e2e-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const tailordbName = `nestedreldb-${testRunId}`;

const PARENT_ID = "60000000-0000-4000-8000-000000000001";
const SECOND_PARENT_ID = "60000000-0000-4000-8000-000000000002";
const MISSING_ID = "60000000-0000-4000-8000-0000000000ff";

describe("E2E: relation inside a nested field", { concurrent: false }, () => {
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
import { user } from "./user";

export const order = db.table("Order", {
  info: db.object(
    { ownerID: db.uuid({ optional: true }).relation({ type: "keyOnly", toward: { table: user } }) },
    { optional: true },
  ),
  lines: db.object(
    { assigneeID: db.uuid().relation({ type: "keyOnly", toward: { table: user } }) },
    { array: true, optional: true },
  ),
${extraFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type order = typeof order;
`,
    );
  }

  function writeLegacyType(withRelation: boolean): void {
    const relation = withRelation ? '.relation({ type: "keyOnly", toward: { table: user } })' : "";
    fs.writeFileSync(
      path.join(tempDir, "tailordb", "legacy.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
${withRelation ? 'import { user } from "./user";\n' : ""}
export const legacy = db.table("Legacy", {
  info: db.object({ ownerID: db.uuid({ optional: true })${relation} }),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type legacy = typeof legacy;
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nestedrel-e2e-"));
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
    fs.mkdirSync(path.join(nodeModulesDir, ".bin"), { recursive: true });
    fs.symlinkSync(
      path.resolve(sdkRoot, "..", "sdk-plugin-seed", "bin", "cli.mjs"),
      path.join(nodeModulesDir, ".bin", "tailor-seed"),
    );

    await runSuite();
  }, 300000);

  test(
    "stores the foreign key on the inner fields of a nested field",
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
      const fields = resp.tailordbType?.schema?.fields;
      expect(fields?.info?.fields.ownerID).toMatchObject({
        foreignKey: true,
        foreignKeyType: "User",
        foreignKeyField: "id",
      });
      expect(fields?.lines?.fields.assigneeID).toMatchObject({
        foreignKey: true,
        foreignKeyType: "User",
        foreignKeyField: "id",
      });
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.deploy),
  );

  async function migrateWithScript(
    extraFields: string,
    script: string,
    signal: AbortSignal,
  ): Promise<CliResult> {
    writeOrderType(extraFields);
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
    return runInTempDir(
      ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
      CLI_BUDGET_MS.migratingDeploy,
      signal,
    );
  }

  // A rejected write aborts the transaction, so each rejection runs in a migration of its own,
  // as the last statement.
  function rejectionScript(parentId: string, email: string, values: string): string {
    return `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values({ id: "${parentId}", name: "Parent", email: "${email}" })
    .execute();
  await trx
    .insertInto("Order")
    .values({
      info: { ownerID: "${parentId}" },
      lines: [{ assigneeID: "${parentId}" }],
    })
    .execute();

  let message: string | null = null;
  try {
    await trx.insertInto("Order").values(${values}).execute();
  } catch (error) {
    message = String(error);
  }
  if (message === null) {
    throw new Error("a row pointing at a missing parent was accepted");
  }
  if (!/foreign key/i.test(message)) {
    throw new Error("unexpected error: " + message);
  }
}
`;
  }

  test(
    "accepts a value that points at an existing parent and rejects a nested value that points at a missing one",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n",
        rejectionScript(
          PARENT_ID,
          "parent-one@example.com",
          `{ info: { ownerID: "${MISSING_ID}" }, lines: null }`,
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
      expect(deploy.output).toContain("Executing 1 data migration(s)");
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "rejects an element of a nested array that points at a missing parent",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n",
        rejectionScript(
          SECOND_PARENT_ID,
          "parent-two@example.com",
          `{ info: null, lines: [{ assigneeID: "${MISSING_ID}" }] }`,
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
      expect(deploy.output).toContain("Executing 1 data migration(s)");
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "adds the relation to a nested field that already holds a value with no parent",
    async ({ signal }) => {
      const markers =
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n";

      writeLegacyType(false);
      await migrateWithScript(
        markers,
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx.insertInto("Legacy").values({ info: { ownerID: "${MISSING_ID}" } }).execute();
}
`,
        signal,
      );

      writeLegacyType(true);
      const deploy = await migrateWithScript(
        markers,
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("Legacy").select("info").execute();
  if (rows.length !== 1 || rows[0]?.info?.ownerID !== "${MISSING_ID}") {
    throw new Error("the stored value did not survive: " + JSON.stringify(rows));
  }
}
`,
        signal,
      );

      expect(deploy.exitCode).toBe(0);
      const resp = await client.getTailorDBType({
        workspaceId,
        namespaceName: tailordbName,
        tailordbTypeName: "Legacy",
      });
      expect(resp.tailordbType?.schema?.fields.info?.fields.ownerID?.foreignKey).toBe(true);
    },
    cliTestTimeout(
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.migratingDeploy,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.migratingDeploy,
    ),
  );

  function deletionScript(parentId: string, email: string, order: string, expectRejected: boolean) {
    return `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values({ id: "${parentId}", name: "Parent", email: "${email}" })
    .execute();
  await trx.insertInto("Order").values(${order}).execute();

  let message: string | null = null;
  try {
    await trx.deleteFrom("User").where("id", "=", "${parentId}").execute();
  } catch (error) {
    message = String(error);
  }
  ${
    expectRejected
      ? `if (message === null) throw new Error("the parent was deleted while a nested value points at it");
  if (!/foreign key|referenced/i.test(message)) throw new Error("unexpected error: " + message);`
      : `if (message !== null) throw new Error("deleting the parent failed: " + message);`
  }
}
`;
  }

  test(
    "refuses to delete a parent that a nested value points at",
    async ({ signal }) => {
      writeLegacyType(true);
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n",
        deletionScript(
          "60000000-0000-4000-8000-000000000011",
          "delete-one@example.com",
          `{ info: { ownerID: "60000000-0000-4000-8000-000000000011" }, lines: null }`,
          true,
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "refuses to delete a parent that an element of a nested array points at",
    async ({ signal }) => {
      writeLegacyType(true);
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n  markerFour: db.string({ optional: true }),\n",
        deletionScript(
          "60000000-0000-4000-8000-000000000012",
          "delete-two@example.com",
          `{ info: null, lines: [{ assigneeID: "60000000-0000-4000-8000-000000000012" }] }`,
          true,
        ),
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  function writeNodeType(tableName: "Node" | "Vertex"): void {
    const other = tableName === "Node" ? "vertex" : "node";
    fs.rmSync(path.join(tempDir, "tailordb", `${other}.ts`), { force: true });
    const exportName = tableName.toLowerCase();
    fs.writeFileSync(
      path.join(tempDir, "tailordb", `${exportName}.ts`),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const ${exportName} = db.table("${tableName}", {
  parentID: db.uuid({ optional: true }).relation({ type: "keyOnly", toward: { table: "self" } }),
  info: db.object(
    { parentID: db.uuid({ optional: true }).relation({ type: "keyOnly", toward: { table: "self" } }) },
    { optional: true },
  ),
  links: db.object(
    { parentID: db.uuid({ optional: true }).relation({ type: "keyOnly", toward: { table: "self" } }) },
    { array: true, optional: true },
  ),
}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type ${exportName} = typeof ${exportName};
`,
    );
  }

  const ROOT_ID = "60000000-0000-4000-8000-000000000021";
  const CHILD_ID = "60000000-0000-4000-8000-000000000022";
  const GRANDCHILD_ID = "60000000-0000-4000-8000-000000000023";

  test(
    "stores a self-referential foreign key inside a nested field",
    async ({ signal }) => {
      writeNodeType("Node");
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n  markerFour: db.string({ optional: true }),\n  markerFive: db.string({ optional: true }),\n",
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx.insertInto("Node").values({ id: "${ROOT_ID}", parentID: null, info: null, links: [] }).execute();
  await trx
    .insertInto("Node")
    .values({
      id: "${CHILD_ID}",
      parentID: "${ROOT_ID}",
      info: { parentID: "${ROOT_ID}" },
      links: [{ parentID: "${ROOT_ID}" }],
    })
    .execute();
  await trx
    .insertInto("Node")
    .values({
      id: "${GRANDCHILD_ID}",
      parentID: "${CHILD_ID}",
      info: { parentID: "${CHILD_ID}" },
      links: [{ parentID: "${ROOT_ID}" }, { parentID: "${CHILD_ID}" }],
    })
    .execute();
}
`,
        signal,
      );

      expect(deploy.exitCode).toBe(0);
      const resp = await client.getTailorDBType({
        workspaceId,
        namespaceName: tailordbName,
        tailordbTypeName: "Node",
      });
      const fields = resp.tailordbType?.schema?.fields;
      expect(fields?.info?.fields.parentID).toMatchObject({
        foreignKey: true,
        foreignKeyType: "Node",
        foreignKeyField: "id",
      });
      expect(fields?.links?.fields.parentID).toMatchObject({
        foreignKey: true,
        foreignKeyType: "Node",
        foreignKeyField: "id",
      });
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "rejects a nested self-reference that points at a missing row",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n  markerFour: db.string({ optional: true }),\n  markerFive: db.string({ optional: true }),\n  markerSix: db.string({ optional: true }),\n",
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  let message: string | null = null;
  try {
    await trx.insertInto("Node").values({ info: null, links: [{ parentID: "${MISSING_ID}" }] }).execute();
  } catch (error) {
    message = String(error);
  }
  if (message === null) throw new Error("a nested self-reference to a missing row was accepted");
  if (!/foreign key/i.test(message)) throw new Error("unexpected error: " + message);
}
`,
        signal,
      );

      expect(deploy.exitCode).toBe(0);
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );

  test(
    "copies rows whose nested values point at their own table when the table is renamed",
    async ({ signal }) => {
      writeNodeType("Vertex");
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
          "Node:Vertex",
        ],
        CLI_BUDGET_MS.local,
        signal,
      );
      const script = fs.readFileSync(
        getMigrationFilePath(migrationsDir, latestMigrationNumber(), "migrate"),
        "utf-8",
      );
      expect(script).toContain("clearNestedReferences");

      const deploy = await runInTempDir(
        ["deploy", "--config", configPath, "--workspace-id", workspaceId, "--yes"],
        CLI_BUDGET_MS.migratingDeploy,
        signal,
      );
      expect(deploy.exitCode).toBe(0);

      const readBack = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n  markerFour: db.string({ optional: true }),\n  markerFive: db.string({ optional: true }),\n  markerSix: db.string({ optional: true }),\n  markerSeven: db.string({ optional: true }),\n",
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx.selectFrom("Vertex").selectAll().orderBy("id", "asc").execute();
  const seen = JSON.stringify(
    rows.map((row) => ({ id: row.id, parentID: row.parentID, info: row.info, links: row.links })),
  );
  const expected = JSON.stringify([
    { id: "${ROOT_ID}", parentID: null, info: null, links: [] },
    {
      id: "${CHILD_ID}",
      parentID: "${ROOT_ID}",
      info: { parentID: "${ROOT_ID}" },
      links: [{ parentID: "${ROOT_ID}" }],
    },
    {
      id: "${GRANDCHILD_ID}",
      parentID: "${CHILD_ID}",
      info: { parentID: "${CHILD_ID}" },
      links: [{ parentID: "${ROOT_ID}" }, { parentID: "${CHILD_ID}" }],
    },
  ]);
  if (seen !== expected) throw new Error("PROBE_MISMATCH " + seen);
}
`,
        signal,
      );
      expect(readBack.exitCode).toBe(0);
    },
    cliTestTimeout(
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.migratingDeploy,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.migratingDeploy,
    ),
  );

  const SEED_ROOT_ID = "60000000-0000-4000-8000-000000000031";
  const SEED_CHILD_ID = "60000000-0000-4000-8000-000000000032";
  const SEED_GRANDCHILD_ID = "60000000-0000-4000-8000-000000000033";

  test(
    "seeds rows that point at their own table through nested values, whatever order the data lists them in",
    async ({ signal }) => {
      const rows = [
        {
          id: SEED_GRANDCHILD_ID,
          parentID: SEED_CHILD_ID,
          info: { parentID: SEED_CHILD_ID },
          links: [{ parentID: SEED_ROOT_ID }, { parentID: SEED_CHILD_ID }],
        },
        {
          id: SEED_CHILD_ID,
          parentID: SEED_ROOT_ID,
          info: { parentID: SEED_ROOT_ID },
          links: [{ parentID: SEED_ROOT_ID }],
        },
        { id: SEED_ROOT_ID, parentID: null, info: null, links: [] },
      ];
      fs.writeFileSync(
        path.join(tempDir, "seed", "data", "Vertex.jsonl"),
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
      const configPath = createConfig();

      await runInTempDir(
        ["seed", "apply", "Vertex", "--config", configPath, "--workspace-id", workspaceId],
        CLI_BUDGET_MS.deploy,
        signal,
      );

      const readBack = await migrateWithScript(
        "  markerOne: db.string({ optional: true }),\n  markerTwo: db.string({ optional: true }),\n  markerThree: db.string({ optional: true }),\n  markerFour: db.string({ optional: true }),\n  markerFive: db.string({ optional: true }),\n  markerSix: db.string({ optional: true }),\n  markerSeven: db.string({ optional: true }),\n  markerEight: db.string({ optional: true }),\n",
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  const rows = await trx
    .selectFrom("Vertex")
    .selectAll()
    .where("id", "in", ["${SEED_ROOT_ID}", "${SEED_CHILD_ID}", "${SEED_GRANDCHILD_ID}"])
    .orderBy("id", "asc")
    .execute();
  const seen = JSON.stringify(
    rows.map((row) => ({ id: row.id, parentID: row.parentID, info: row.info, links: row.links })),
  );
  const expected = JSON.stringify(${JSON.stringify(
    [...rows].toSorted((a, b) => a.id.localeCompare(b.id)),
  )});
  if (seen !== expected) throw new Error("PROBE_MISMATCH " + seen);
}
`,
        signal,
      );
      expect(readBack.exitCode).toBe(0);
    },
    cliTestTimeout(
      CLI_BUDGET_MS.deploy,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.local,
      CLI_BUDGET_MS.migratingDeploy,
    ),
  );
});
