/**
 * E2E coverage for `.unique()` on a field inside `db.object()`.
 *
 * The constraint must reach the platform on the inner field, and the platform
 * must reject a second row whose inner value duplicates the first. The writes
 * run inside a migration script, the way the nested relation suite does.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test, expect } from "vitest";
import {
  formatMigrationNumber,
  getMigrationFiles,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { CLI_BUDGET_MS, cliTestTimeout, runCli } from "./cli";
import { GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS, MigrationWorkspace } from "./migration-workspace";

describe("E2E: unique field inside a nested field", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("nuniq");
  ws.register();

  function writeOrderType(extraFields = ""): void {
    fs.writeFileSync(
      path.join(ws.tempDir, "tailordb", "order.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const order = db.table("Order", {
  info: db.object(
    {
      code: db.string({ optional: true }).unique(),
      tag: db.string({ optional: true }).index(),
    },
    { optional: true },
  ),
${extraFields}}).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);

export type order = typeof order;
`,
    );
  }

  function latestMigrationNumber(): number {
    return Math.max(...getMigrationFiles(ws.migrationsDir).map((f) => f.number));
  }

  test(
    "stores the unique and index settings on the inner fields of a nested field",
    async ({ signal }) => {
      writeOrderType();
      await ws.runGenerate(signal);
      await ws.runDeploy(signal);

      const resp = await ws.client.getTailorDBType({
        workspaceId: ws.workspaceId,
        namespaceName: ws.tailordbName,
        tailordbTypeName: "Order",
      });
      const inner = resp.tailordbType?.schema?.fields.info?.fields;
      expect(inner?.code).toMatchObject({ unique: true, index: true });
      expect(inner?.tag).toMatchObject({ unique: false, index: true });
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  test(
    "rejects a second row whose inner value duplicates the first",
    async ({ signal }) => {
      writeOrderType("  marker: db.string({ optional: true }),\n");
      await ws.runGenerate(signal);
      const migrationNumber = latestMigrationNumber();
      await runCli(
        [
          "tailordb",
          "migration",
          "script",
          formatMigrationNumber(migrationNumber),
          "--config",
          ws.createConfig(),
        ],
        { cwd: ws.tempDir, timeoutMs: CLI_BUDGET_MS.local, signal },
      );
      ws.overwriteMigrationScript(
        migrationNumber,
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

      const deploy = await runCli(
        ["deploy", "--config", ws.createConfig(), "--workspace-id", ws.workspaceId, "--yes"],
        { cwd: ws.tempDir, timeoutMs: CLI_BUDGET_MS.migratingDeploy, signal },
      );

      expect(deploy.exitCode).toBe(0);
      expect(deploy.output).toContain("Executing 1 data migration(s)");
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.local, CLI_BUDGET_MS.migratingDeploy),
  );
});
