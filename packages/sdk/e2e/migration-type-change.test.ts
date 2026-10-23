/**
 * E2E tests for TailorDB migration failure handling and in-place field type changes.
 * Starts from an initial deploy of the base User table in its own workspace.
 */

import * as fs from "node:fs";
import { describe, test, expect } from "vitest";
import {
  getMigrationFiles,
  loadDiff,
  getMigrationFilePath,
} from "../src/cli/commands/tailordb/migrate/snapshot";
import {
  DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  GENERATE_TEST_TIMEOUT_MS,
  mergeStepsIntoOne,
  MigrationWorkspace,
} from "./migration-workspace";

const firstRowId = "10000000-0000-4000-8000-000000000001";
const secondRowId = "10000000-0000-4000-8000-000000000002";

describe("E2E: TailorDB Migration Failure and Type Changes", { concurrent: false }, () => {
  const ws = new MigrationWorkspace("types");
  ws.register();

  test(
    "deploys the initial schema",
    async ({ signal }) => {
      await ws.runGenerate(signal);
      await ws.runDeploy(signal);
      expect(await ws.getTailorDBTypeFields("User")).toEqual(
        expect.arrayContaining(["name", "email", "role"]),
      );
    },
    GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
  );

  describe("Migration Rollback on Failure", () => {
    /**
     * Scenario 8: A failing migrate.ts must roll back its Pre-phase DDL, leaving
     * the remote schema and checkpoint at the prior migration so a retry works.
     */
    test(
      "generates the breaking migration whose script will fail",
      async ({ signal }) => {
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "loyaltyTier: db.string()",
          "sourceUuid: db.uuid()",
          'sourceEnum: db.enum(["ACTIVE", "INACTIVE"])',
          "sourceDecimal: db.decimal()",
          "sourceInteger: db.int()",
          "indexedUuid: db.uuid().index()",
          'indexedEnum: db.enum(["ACTIVE", "INACTIVE"]).index()',
          "indexedDecimal: db.decimal().index()",
          "indexedInteger: db.int().index()",
        ]);

        await ws.runGenerate(signal);

        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(2);
        expect(files[1]!.number).toBe(1);

        const diffPath = getMigrationFilePath(ws.migrationsDir, 1, "diff");
        const diff = loadDiff(diffPath);
        expect(diff.hasBreakingChanges).toBe(true);
        expect(diff.requiresMigrationScript).toBe(true);
        expect(fs.existsSync(getMigrationFilePath(ws.migrationsDir, 1, "migrate"))).toBe(true);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    test(
      "rolls back the pre-migration DDL when migrate.ts fails",
      async ({ signal }) => {
        // Make the data migration deterministically fail.
        ws.overwriteMigrationScript(
          1,
          `export async function main(): Promise<void> {
  throw new Error("simulated migration failure for rollback e2e");
}
`,
        );

        const checkpointBefore = await ws.getMigrationCheckpoint();

        const result = await ws.tryDeploy(signal);

        // The deploy must fail for the injected reason, not an unrelated error.
        expect(result.ok).toBe(false);
        expect(result.output).toContain("simulated migration failure for rollback e2e");

        // Rollback restored User to its prior-checkpoint schema: the new field is gone,
        // prior fields remain.
        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).not.toContain("loyaltyTier");
        expect(fields).toEqual(expect.arrayContaining(["name", "email", "role"]));

        const checkpointAfter = await ws.getMigrationCheckpoint();
        expect(checkpointAfter).toBe(checkpointBefore);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );

    test(
      "a retry succeeds once migrate.ts is fixed (workspace was recoverable)",
      async ({ signal }) => {
        // Provide a working data migration that seeds rows under the source field types.
        ws.overwriteMigrationScript(
          1,
          `import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .insertInto("User")
    .values([
      {
        id: "${firstRowId}",
        name: "First",
        email: "first@example.com",
        loyaltyTier: "bronze",
        sourceUuid: "20000000-0000-4000-8000-000000000001",
        sourceEnum: "ACTIVE",
        sourceDecimal: "12.34",
        sourceInteger: 42,
        indexedUuid: "30000000-0000-4000-8000-000000000001",
        indexedEnum: "ACTIVE",
        indexedDecimal: "34.56",
        indexedInteger: 84,
      },
      {
        id: "${secondRowId}",
        name: "Second",
        email: "second@example.com",
        loyaltyTier: "silver",
        sourceUuid: "20000000-0000-4000-8000-000000000002",
        sourceEnum: "INACTIVE",
        sourceDecimal: "56.78",
        sourceInteger: -7,
        indexedUuid: "30000000-0000-4000-8000-000000000002",
        indexedEnum: "INACTIVE",
        indexedDecimal: "78.90",
        indexedInteger: -14,
      },
    ])
    .execute();
}
`,
        );

        // No drift error: the failed deploy left a consistent baseline at the prior checkpoint.
        await ws.runDeploy(signal);

        const fields = await ws.getTailorDBTypeFields("User");
        expect(fields).toContain("loyaltyTier");

        const checkpointAfter = await ws.getMigrationCheckpoint();
        expect(checkpointAfter).toBe(1);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });

  describe("In-place Field Type Changes", () => {
    test(
      "generates one phased migration for verified type pairs",
      async ({ signal }) => {
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "loyaltyTier: db.string()",
          "sourceUuid: db.string()",
          "sourceEnum: db.string()",
          "sourceDecimal: db.string()",
          "sourceInteger: db.float()",
          "indexedUuid: db.string().index()",
          "indexedEnum: db.string().index()",
          "indexedDecimal: db.string().index()",
          "indexedInteger: db.float().index()",
        ]);

        await ws.runGenerate(signal);

        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(3);
        expect(files[2]!.number).toBe(2);

        const diff = loadDiff(getMigrationFilePath(ws.migrationsDir, 2, "diff"));
        expect(diff.changes).toHaveLength(8);
        expect(diff.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceUuid" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceEnum" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceDecimal" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "sourceInteger" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedUuid" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedEnum" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedDecimal" }),
            expect.objectContaining({ kind: "field_type_modified", fieldName: "indexedInteger" }),
          ]),
        );
        expect(diff.breakingChanges.every((change) => !change.unsupported)).toBe(true);

        const migratePath = getMigrationFilePath(ws.migrationsDir, 2, "migrate");
        const generatedScript = fs.readFileSync(migratePath, "utf-8");
        const reviewedScript = generatedScript.replaceAll(
          /const normalizedValue = TODO\("[^"]*"\);/g,
          "const normalizedValue = sourceValue;",
        );
        const defaultNormalization = `        const sourceValue = row.sourceUuid;
        if (sourceValue === null) continue;
        const normalizedValue = sourceValue;`;
        const exercisedNormalization = `        const sourceValue = row.sourceUuid;
        if (sourceValue === null) continue;
        const normalizedValue =
          sourceValue === "20000000-0000-4000-8000-000000000001"
            ? "20000000-0000-4000-8000-000000000011"
            : sourceValue;`;
        const editedScript = reviewedScript.replace(defaultNormalization, exercisedNormalization);
        expect(editedScript).not.toBe(reviewedScript);
        expect(editedScript).not.toMatch(/\bTODO\(/);
        fs.writeFileSync(migratePath, mergeStepsIntoOne(editedScript));

        await ws.runDeploy(signal);
        expect(await ws.getMigrationCheckpoint()).toBe(2);
      },
      GENERATE_AND_DEPLOY_TEST_TIMEOUT_MS,
    );

    const mutateStep = `async (trx: Transaction) => {
      const rows = await trx.selectFrom("User").selectAll().orderBy("id", "asc").execute();
      if (rows.length !== 2) {
        throw new Error(\`Expected two rows after type changes, received \${rows.length}\`);
      }
      for (const row of rows) {
        if (
          typeof row.sourceUuid !== "string" ||
          typeof row.sourceEnum !== "string" ||
          typeof row.sourceDecimal !== "string" ||
          typeof row.sourceInteger !== "number" ||
          typeof row.indexedUuid !== "string" ||
          typeof row.indexedEnum !== "string" ||
          typeof row.indexedDecimal !== "string" ||
          typeof row.indexedInteger !== "number"
        ) {
          throw new Error("Type-changed row did not decode through its target field types");
        }
      }
      const normalized = rows.find((row) => row.id === "${firstRowId}");
      if (normalized?.sourceUuid !== "20000000-0000-4000-8000-000000000011") {
        throw new Error("Generated field-type normalization update did not persist");
      }

      await trx
        .updateTable("User")
        .set({
          sourceUuid: "not-a-uuid",
          sourceEnum: "NOT_ENUM",
          sourceDecimal: "not-a-decimal",
          sourceInteger: 42.5,
          indexedUuid: "not-an-indexed-uuid",
          indexedEnum: "NOT_INDEXED_ENUM",
          indexedDecimal: "not-an-indexed-decimal",
          indexedInteger: 84.5,
          verificationMarker: "verified",
        })
        .where("id", "=", "${firstRowId}")
        .execute();
      await trx.deleteFrom("User").where("id", "=", "${secondRowId}").execute();
    }`;

    const verifyStep = `async (trx: Transaction) => {
      const remaining = await trx.selectFrom("User").selectAll().execute();
      if (
        remaining.length !== 1 ||
        remaining[0]?.id !== "${firstRowId}" ||
        remaining[0]?.sourceUuid !== "not-a-uuid" ||
        remaining[0]?.sourceEnum !== "NOT_ENUM" ||
        remaining[0]?.sourceDecimal !== "not-a-decimal" ||
        remaining[0]?.sourceInteger !== 42.5 ||
        remaining[0]?.indexedUuid !== "not-an-indexed-uuid" ||
        remaining[0]?.indexedEnum !== "NOT_INDEXED_ENUM" ||
        remaining[0]?.indexedDecimal !== "not-an-indexed-decimal" ||
        remaining[0]?.indexedInteger !== 84.5
      ) {
        throw new Error("Target-type update or delete verification failed");
      }
    }`;

    const stepsScript = (
      mutate: string,
      verify: string,
    ) => `import type { Transaction } from "./db";

export const steps = {
  mutate: { run: ${mutate} },
  verify: { dependsOn: ["mutate"], run: ${verify} },
};
`;

    test(
      "generates the multi-step verification migration",
      async ({ signal }) => {
        ws.writeUserTable([
          "role: db.string({ optional: true })",
          "loyaltyTier: db.string()",
          "sourceUuid: db.string()",
          "sourceEnum: db.string()",
          "sourceDecimal: db.string()",
          "sourceInteger: db.float()",
          "indexedUuid: db.string().index()",
          "indexedEnum: db.string().index()",
          "indexedDecimal: db.string().index()",
          "indexedInteger: db.float().index()",
          "verificationMarker: db.string()",
        ]);

        await ws.runGenerate(signal);

        const files = getMigrationFiles(ws.migrationsDir);
        expect(files.length).toBe(4);
        expect(files[3]!.number).toBe(3);
      },
      GENERATE_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 10a: a script that exports onFailure = "rollback" gives its Pre-phase schema back,
     * clears the in-progress record and removes its workflow when a later step fails. The next
     * scenario deploys the same migration again, so nothing is left in progress here.
     */
    test(
      "rolls the migration back when its second step fails and its script asks for it",
      async ({ signal }) => {
        ws.overwriteMigrationScript(
          3,
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
        expect(await ws.getMigrationCheckpoint()).toBe(2);
        expect(await ws.getTailorDBTypeFields("User")).not.toContain("verificationMarker");
        const labels = await ws.namespaceLabels();
        expect(labels).not.toHaveProperty("sdk-migration-in-progress");
        expect(labels).not.toHaveProperty("sdk-migration-execution");
        expect(await ws.migrationWorkflowExists(3)).toBe(false);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );

    /**
     * Scenario 10b: a step that fails after another step committed leaves the
     * migration in progress, keeping its Pre-phase schema for the next deploy.
     */
    test(
      "leaves the migration in progress when its second step fails",
      async ({ signal }) => {
        ws.overwriteMigrationScript(
          3,
          stepsScript(
            mutateStep,
            `async () => {
      throw new Error("simulated step failure for resume e2e");
    }`,
          ),
        );

        const result = await ws.tryDeploy(signal);

        expect(result.ok).toBe(false);
        expect(result.output).toContain("MIGRATION_PARTIALLY_APPLIED");
        expect(result.output).toContain("simulated step failure for resume e2e");
        expect(await ws.getMigrationCheckpoint()).toBe(2);
        expect(await ws.getTailorDBTypeFields("User")).toContain("verificationMarker");
        expect(await ws.namespaceLabels()).toMatchObject({
          "sdk-migration-in-progress": "m0003",
          "sdk-migration-execution": expect.stringMatching(/^e[0-9a-f]{32}$/),
        });
        expect(await ws.migrationWorkflowExists(3)).toBe(true);
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
          3,
          stepsScript(
            `async () => {
      throw new Error("the completed mutate step must not run again");
    }`,
            verifyStep,
          ),
        );

        await ws.runDeploy(signal);

        expect(await ws.getMigrationCheckpoint()).toBe(3);
        const labels = await ws.namespaceLabels();
        expect(labels).not.toHaveProperty("sdk-migration-in-progress");
        expect(labels).not.toHaveProperty("sdk-migration-execution");
        expect(await ws.migrationWorkflowExists(3)).toBe(false);
      },
      DEPLOY_TEST_TIMEOUT_MS,
    );
  });
});
