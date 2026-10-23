/**
 * E2E tests for a multi-step migration whose script asks to be rolled back when a later step fails,
 * and for deploying that migration again afterwards.
 * Starts from an initial deploy of the base User table, holding rows, in its own workspace.
 */

import { describe, test, expect } from "vitest";
import { getMigrationFiles } from "../src/cli/commands/tailordb/migrate/snapshot";
import { CLI_BUDGET_MS, cliTestTimeout } from "./cli";
import {
  DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_TEST_TIMEOUT_MS,
  MigrationWorkspace,
} from "./migration-workspace";

describe("E2E: TailorDB Migration Step Rollback", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("rollbk");
  ws.register();

  test(
    "deploys the initial schema with rows",
    async ({ signal }) => {
      await ws.runGenerate(signal);
      await ws.runDeploy(signal);
      expect(await ws.getTailorDBTypeFields("User")).toEqual(
        expect.arrayContaining(["name", "email", "role"]),
      );
      await ws.runTailorDBScript(
        `  await db
    .insertInto("User")
    .values([
      { id: "50000000-0000-4000-8000-000000000001", name: "First", email: "first@example.com" },
      { id: "50000000-0000-4000-8000-000000000002", name: "Second", email: "second@example.com" },
    ])
    .execute();`,
        signal,
      );
    },
    cliTestTimeout(CLI_BUDGET_MS.local, CLI_BUDGET_MS.deploy, CLI_BUDGET_MS.script),
  );

  test(
    "generates the multi-step verification migration",
    async ({ signal }) => {
      ws.writeUserTable(["role: db.string({ optional: true })", "verificationMarker: db.string()"]);

      await ws.runGenerate(signal);

      const files = getMigrationFiles(ws.migrationsDir);
      expect(files.length).toBe(2);
      expect(files[1]!.number).toBe(1);
    },
    GENERATE_TEST_TIMEOUT_MS,
  );

  /**
   * Scenario 10a: a script that exports onFailure = "rollback" gives its Pre-phase schema back,
   * clears the in-progress record and removes its workflow when a later step fails.
   */
  test(
    "rolls the migration back when its second step fails and its script asks for it",
    async ({ signal }) => {
      ws.overwriteMigrationScript(
        1,
        `import type { Transaction } from "./db";

export const onFailure = "rollback";

export const steps = {
  probe: {
    run: async (trx: Transaction) => {
      await trx.updateTable("User").set({ verificationMarker: "rollback-probe" }).execute();
    },
  },
  verify: {
    dependsOn: ["probe"],
    run: async () => {
      throw new Error("simulated step failure for rollback e2e");
    },
  },
};
`,
      );

      const result = await ws.tryDeploy(signal);

      expect(result.ok).toBe(false);
      expect(result.output).toContain("MIGRATION_ROLLED_BACK");
      expect(result.output).toContain("simulated step failure for rollback e2e");
      expect(await ws.getMigrationCheckpoint()).toBe(0);
      expect(await ws.getTailorDBTypeFields("User")).not.toContain("verificationMarker");
      const labels = await ws.namespaceLabels();
      expect(labels).not.toHaveProperty("sdk-migration-in-progress");
      expect(labels).not.toHaveProperty("sdk-migration-execution");
      expect(await ws.migrationWorkflowExists(1)).toBe(false);
    },
    DEPLOY_TEST_TIMEOUT_MS,
  );

  test(
    "applies the migration on the next deploy once its steps succeed",
    async ({ signal }) => {
      ws.overwriteMigrationScript(
        1,
        `import type { Transaction } from "./db";

export const steps = {
  mark: {
    run: async (trx: Transaction) => {
      await trx.updateTable("User").set({ verificationMarker: "verified" }).execute();
    },
  },
  verify: {
    dependsOn: ["mark"],
    run: async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").select("verificationMarker").execute();
      if (rows.length !== 2 || rows.some((row) => row.verificationMarker !== "verified")) {
        throw new Error("The mark step's update is not visible");
      }
    },
  },
};
`,
      );

      await ws.runDeploy(signal);

      expect(await ws.getMigrationCheckpoint()).toBe(1);
      expect(await ws.getTailorDBTypeFields("User")).toContain("verificationMarker");
      const labels = await ws.namespaceLabels();
      expect(labels).not.toHaveProperty("sdk-migration-in-progress");
      expect(labels).not.toHaveProperty("sdk-migration-execution");
      expect(await ws.migrationWorkflowExists(1)).toBe(false);
    },
    DEPLOY_TEST_TIMEOUT_MS,
  );
});
