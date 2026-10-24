/**
 * E2E tests for resuming a multi-step migration whose later step failed after an earlier one committed.
 * Starts from an initial deploy of the base User table in its own workspace.
 */

import { describe, test, expect } from "vitest";
import {
  DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_TEST_TIMEOUT_MS,
  MigrationWorkspace,
} from "./migration-workspace";

const rowId = "60000000-0000-4000-8000-000000000001";

const stepsScript = (mutate: string, verify: string) => `import type { Transaction } from "./db";

export const steps = {
  mutate: { run: ${mutate} },
  verify: { dependsOn: ["mutate"], run: ${verify} },
};
`;

describe("E2E: TailorDB Migration Step Resume", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("resume");
  ws.register();

  test(
    "deploys the initial schema",
    async ({ signal }) => {
      expect(await ws.deployInitialSchema(signal)).toEqual(
        expect.arrayContaining(["name", "email", "role"]),
      );
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  test(
    "generates the multi-step verification migration",
    async ({ signal }) => {
      expect(await ws.generateVerificationMigration(signal)).toEqual([0, 1]);
    },
    GENERATE_TEST_TIMEOUT_MS,
  );

  /**
   * Scenario 10b: a step that fails after another step committed leaves the
   * migration in progress, keeping its Pre-phase schema for the next deploy.
   */
  test(
    "leaves the migration in progress when its second step fails",
    async ({ signal }) => {
      ws.overwriteMigrationScript(
        1,
        stepsScript(
          `async (trx: Transaction) => {
      await trx
        .insertInto("User")
        .values({ id: "${rowId}", name: "First", email: "first@example.com", verificationMarker: "verified" })
        .execute();
    }`,
          `async () => {
      throw new Error("simulated step failure for resume e2e");
    }`,
        ),
      );

      const result = await ws.tryDeploy(signal);

      expect(result.ok).toBe(false);
      expect(result.output).toContain("MIGRATION_PARTIALLY_APPLIED");
      expect(result.output).toContain("simulated step failure for resume e2e");
      expect(await ws.getMigrationCheckpoint()).toBe(0);
      expect(await ws.getTailorDBTypeFields("User")).toContain("verificationMarker");
      expect(await ws.namespaceLabels()).toMatchObject({
        "sdk-migration-in-progress": "m0001",
        "sdk-migration-execution": expect.stringMatching(/^e[0-9a-f]{32}$/),
      });
      expect(await ws.migrationWorkflowExists(1)).toBe(true);
    },
    DEPLOY_TEST_TIMEOUT_MS,
  );

  /**
   * Scenario 10c: the next deploy resumes the failed run with the fixed script;
   * the completed step does not run again, and its committed changes are visible.
   */
  test(
    "resumes from the failed step without re-running the completed one",
    async ({ signal }) => {
      ws.overwriteMigrationScript(
        1,
        stepsScript(
          `async () => {
      throw new Error("the completed mutate step must not run again");
    }`,
          `async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").selectAll().execute();
      if (rows.length !== 1 || rows[0]?.id !== "${rowId}" || rows[0]?.verificationMarker !== "verified") {
        throw new Error("The completed mutate step's insert is not visible");
      }
    }`,
        ),
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
