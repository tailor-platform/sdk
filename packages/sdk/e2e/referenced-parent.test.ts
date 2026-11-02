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
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, test, expect } from "vitest";
import {
  formatMigrationNumber,
  getMigrationFilePath,
  getMigrationFiles,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import { createKyselyPGlite } from "../src/vitest/pglite-kysely";
import { CLI_BUDGET_MS, cliTestTimeout, runCli } from "./cli";
import { GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS, MigrationWorkspace } from "./migration-workspace";

const PARENT_ID = "70000000-0000-4000-8000-000000000001";
const SECOND_ID = "70000000-0000-4000-8000-000000000002";

const REFUSED_WRITE_TIMEOUT_MS = cliTestTimeout(
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.local,
  CLI_BUDGET_MS.migratingDeploy,
);

describe("E2E: parent referenced from an array or nested value", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("parent");
  ws.register();
  let markerCount = 0;

  function writeOrderType(markers: number): void {
    const markerFields = Array.from(
      { length: markers },
      (_, index) => `  marker${index}: db.string({ optional: true }),\n`,
    ).join("");
    fs.writeFileSync(
      path.join(ws.tempDir, "tailordb", "order.ts"),
      `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
import { user } from "./user";

export const order = db.table("Order", {
  ownerIDs: db.uuid({ array: true, optional: true }).relation({ type: "keyOnly", toward: { table: user } }),
  emails: db.string({ array: true, optional: true }).relation({ type: "keyOnly", toward: { table: user, key: "email" } }),
  siblingIDs: db.uuid({ array: true, optional: true }).relation({ type: "keyOnly", toward: { table: "self" } }),
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
    return Math.max(...getMigrationFiles(ws.migrationsDir).map((f) => f.number));
  }

  function parentAndOrder(order: string, email: string): string {
    return `  await trx
    .insertInto("User")
    .values({ id: "${PARENT_ID}", name: "Parent", email: "${email}" })
    .execute();
  await trx.insertInto("Order").values(${order}).execute();`;
  }

  function orders(...rows: string[]): string {
    return rows
      .map((row) => `  await trx.insertInto("Order").values(${row}).execute();`)
      .join("\n");
  }

  function refusedWriteScript(setup: string, refused: string): string {
    return `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
${setup}

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
    const schemaPath = getMigrationFilePath(ws.migrationsDir, migrationNumber, "pgliteSchema");
    const scriptPath = getMigrationFilePath(ws.migrationsDir, migrationNumber, "migrate");
    const { pgliteSchema } = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(fs.readFileSync(schemaPath, "utf8"))).toString("base64")}`
    );
    const { main } = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(fs.readFileSync(scriptPath, "utf8"))).toString("base64")}`
    );
    const pglite = new PGlite();
    const db = createKyselyPGlite(pglite);
    try {
      await pglite.exec(pgliteSchema[ws.tailordbName]);
      await db.transaction().execute(main);
    } finally {
      await db.destroy();
    }
  }

  async function migrateWithScript(script: string, signal: AbortSignal) {
    markerCount += 1;
    writeOrderType(markerCount);
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
    ws.overwriteMigrationScript(migrationNumber, script);
    await runOnPglite(migrationNumber);
    return ws.tryDeploy(signal);
  }

  test(
    "deploys the schema the cases build on",
    async ({ signal }) => {
      writeOrderType(0);
      await ws.runGenerate(signal);
      await ws.runDeploy(signal);

      expect(await ws.getTailorDBTypeFields("Order")).toEqual(
        expect.arrayContaining(["ownerIDs", "emails", "siblingIDs", "info"]),
      );
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  test(
    "refuses to delete a parent that an element of an array field points at",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          parentAndOrder(`{ ownerIDs: ["${PARENT_ID}"] }`, "array@example.com"),
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "refuses to delete a parent that a nested value points at",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          parentAndOrder(`{ info: { ownerID: "${PARENT_ID}" } }`, "nested@example.com"),
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "refuses to delete a parent that an array field points at by another key",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          parentAndOrder(`{ emails: ["keyed@example.com"] }`, "keyed@example.com"),
          `trx.deleteFrom("User").where("id", "=", "${PARENT_ID}").execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "refuses to change the key a parent is pointed at by",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          parentAndOrder(`{ emails: ["renamed@example.com"] }`, "renamed@example.com"),
          `trx.updateTable("User").set({ email: "other@example.com" }).where("id", "=", "${PARENT_ID}").execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "refuses to delete a row whose array points at the row itself",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          `${orders(`{ id: "${PARENT_ID}" }`)}
  await trx.updateTable("Order").set({ siblingIDs: ["${PARENT_ID}"] }).where("id", "=", "${PARENT_ID}").execute();`,
          `trx.deleteFrom("Order").where("id", "=", "${PARENT_ID}").execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "refuses to delete in one statement two rows that point at each other",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        refusedWriteScript(
          orders(`{ id: "${SECOND_ID}" }`, `{ id: "${PARENT_ID}", siblingIDs: ["${SECOND_ID}"] }`),
          `trx.deleteFrom("Order").where("id", "in", ["${PARENT_ID}", "${SECOND_ID}"]).execute()`,
        ),
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );

  test(
    "deletes a row that pointed at itself once its reference is cleared",
    async ({ signal }) => {
      const deploy = await migrateWithScript(
        `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
${orders(`{ id: "${PARENT_ID}" }`)}
  await trx.updateTable("Order").set({ siblingIDs: ["${PARENT_ID}"] }).where("id", "=", "${PARENT_ID}").execute();
  await trx.updateTable("Order").set({ siblingIDs: null }).where("id", "=", "${PARENT_ID}").execute();
  await trx.deleteFrom("Order").where("id", "=", "${PARENT_ID}").execute();
  const rest = await trx.selectFrom("Order").select("id").execute();
  if (rest.length !== 0) throw new Error("the row was not deleted");
}
`,
        signal,
      );

      expect(deploy).toMatchObject({ ok: true });
    },
    REFUSED_WRITE_TIMEOUT_MS,
  );
});
