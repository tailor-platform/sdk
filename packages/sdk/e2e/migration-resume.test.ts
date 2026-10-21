/**
 * E2E tests for resuming a multi-step TailorDB migration after a step fails.
 * Starts from an initial deploy of the base User table in its own workspace.
 */

import { describe, test, expect } from "vitest";
import { getMigrationFiles } from "../src/cli/commands/tailordb/migrate/snapshot";
import {
  DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  MigrationWorkspace,
} from "./migration-workspace";

describe("E2E: TailorDB Multi-step Migration Resume", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("resume");
  ws.register();

  test(
    "deploys the initial schema",
    async ({ signal }) => {
      await ws.runGenerate(signal);
      await ws.runDeploy(signal);
      expect(await ws.getTailorDBTypeFields("User")).toContain("name");
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  /**
   * Scenario 10: a step that fails after another step committed leaves the
   * migration in progress, keeping its Pre-phase schema for the next deploy.
   */
  test(
    "leaves a multi-step migration in progress when a later step fails",
    async ({ signal }) => {
      ws.writeUserTable(["role: db.string({ optional: true })", "stepTier: db.string()"]);

      await ws.runGenerate(signal);
      const files = getMigrationFiles(ws.migrationsDir);
      expect(files.length).toBe(2);
      expect(files[1]!.number).toBe(1);

      ws.overwriteMigrationScript(
        1,
        `import type { Transaction } from "./db";

export const steps = {
  backfill: {
    run: async (trx: Transaction) => {
      await trx
        .insertInto("User")
        .values({ name: "Resume User", email: "resume@example.com", stepTier: "bronze" })
        .execute();
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async () => {
      throw new Error("simulated step failure for resume e2e");
    },
  },
};
`,
      );

      const result = await ws.tryDeploy(signal);

      expect(result.ok).toBe(false);
      expect(result.output).toContain("MIGRATION_PARTIALLY_APPLIED");
      expect(result.output).toContain("simulated step failure for resume e2e");
      expect(await ws.getTailorDBTypeFields("User")).toContain("stepTier");
      expect(await ws.namespaceLabels()).toMatchObject({
        "sdk-migration-in-progress": "m0001",
        "sdk-migration-execution": expect.stringMatching(/^e[0-9a-f]{32}$/),
      });
      expect(await ws.migrationWorkflowExists(1)).toBe(true);
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  /**
   * Scenario 10b: the next deploy resumes the failed run with the fixed script;
   * the completed step does not run again.
   */
  test(
    "resumes from the failed step without re-running the completed one",
    async ({ signal }) => {
      ws.overwriteMigrationScript(
        1,
        `import type { Transaction } from "./db";

export const steps = {
  backfill: {
    run: async () => {
      throw new Error("the completed backfill step must not run again");
    },
  },
  verify: {
    dependsOn: ["backfill"],
    run: async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").select(["id", "stepTier"]).execute();
      if (rows.length === 0 || rows.some((row) => row.stepTier !== "bronze")) {
        throw new Error("backfill did not commit before the failed run");
      }
    },
  },
};
`,
      );

      await ws.runDeploy(signal);

      expect(await ws.getMigrationCheckpoint()).toBe(1);
      const labels = await ws.namespaceLabels();
      expect(labels).not.toHaveProperty("sdk-migration-in-progress");
      expect(labels).not.toHaveProperty("sdk-migration-execution");
      expect(await ws.migrationWorkflowExists(1)).toBe(false);
    },
    DEPLOY_TEST_TIMEOUT_MS,
  );
});
