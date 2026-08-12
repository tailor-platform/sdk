import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertDefined } from "#/utils/assert";
import { planExpandContract } from "./expand-contract";
import {
  buildExpandDiff,
  buildIntermediateSnapshot,
  compareSnapshots,
  normalizeSchemaSnapshot,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import {
  snapshotField,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";
import type { MigrationDiff } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig } from "./snapshot-types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function migrationsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expand-contract-chain-"));
  tempDirs.push(dir);
  return path.join(dir, "migrations");
}

function snapshot(fields: Record<string, SnapshotFieldConfig>): SchemaSnapshot {
  return {
    version: 1,
    namespace: "testdb",
    createdAt: "2026-01-01T00:00:00.000Z",
    types: { User: { ...snapshotType("User"), fields } },
  };
}

/**
 * Produce the two diffs a single generate run would write for one type change.
 * @param previousFields - Fields before the change
 * @param currentFields - Fields the user now declares
 * @returns Both diffs plus the intermediate snapshot between them
 */
function generatePair(
  previousFields: Record<string, SnapshotFieldConfig>,
  currentFields: Record<string, SnapshotFieldConfig>,
) {
  const previous = normalizeSchemaSnapshot(snapshot(previousFields));
  const current = normalizeSchemaSnapshot(snapshot(currentFields));
  const { plans } = planExpandContract({
    previous,
    current,
    diff: compareSnapshots(previous, current),
    confirmed: new Set(["User.price"]),
  });
  const intermediate = buildIntermediateSnapshot(previous, plans);
  const expand = buildExpandDiff(previous, intermediate, plans);
  const contract = compareSnapshots(intermediate, current, {
    fieldRenames: plans.map((plan) => ({
      tableName: plan.tableName,
      previousFieldName: plan.tempFieldName,
      fieldName: plan.fieldName,
    })),
  });
  return { previous, current, intermediate, plans, expand, contract };
}

function writePair(
  dir: string,
  previous: SchemaSnapshot,
  expand: MigrationDiff,
  contract: MigrationDiff,
) {
  writeInitialSchema(dir, previous.types);
  writeDiff(dir, 1, expand.changes, expand);
  writeDiff(dir, 2, contract.changes, contract);
}

describe("expand-contract migration chain", () => {
  test("replays to exactly the schema the user declared", () => {
    const { previous, current, expand, contract } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );
    const dir = migrationsDir();
    writePair(dir, previous, expand, contract);

    expect(reconstructSnapshotFromMigrations(dir)?.types).toEqual(current.types);
  });

  test("replays the expand migration alone to the intermediate schema", () => {
    const { previous, intermediate, expand, contract } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );
    const dir = migrationsDir();
    writePair(dir, previous, expand, contract);

    expect(reconstructSnapshotFromMigrations(dir, 1)?.types).toEqual(intermediate.types);
  });

  test("frees the original name so the contract can reuse it", () => {
    const { intermediate } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    expect(intermediate.types.User?.fields.price).toBeUndefined();
    expect(intermediate.types.User?.fields.priceMigrate?.type).toBe("boolean");
  });

  test("removes the original field in the expand migration, which keeps it readable there", () => {
    const { expand } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    expect(expand.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "field_added", fieldName: "priceMigrate" }),
        expect.objectContaining({ kind: "field_removed", fieldName: "price" }),
      ]),
    );
  });

  test("requires the conversion script, which is the only thing carrying the data", () => {
    const { expand } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    expect(expand.requiresMigrationScript).toBe(true);
  });

  test("records the removed field as optional so the script can clear it", () => {
    const { expand } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    const removed = expand.changes.find((change) => change.kind === "field_removed");
    // The deploy restores this contract while the script runs; a required one
    // rejects the null the script writes.
    expect(removed && "before" in removed && removed.before.required).toBe(false);
  });

  test("keeps hooks and validation off the temporary field", () => {
    const { intermediate } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      {
        // The hooks belong to the target contract, which is what the temporary
        // field is copied from.
        price: snapshotField("boolean", {
          required: true,
          hooks: { update: { expr: "value + '!'" } },
          validate: [{ script: { expr: "value !== ''" }, errorMessage: "non-empty only" }],
        }),
      },
    );

    const temp = assertDefined(
      intermediate.types.User?.fields.priceMigrate,
      "temporary field missing",
    );
    // The rename re-applies the real contract; running an update hook here
    // would apply it once on the conversion and again on the copy.
    expect(temp.type).toBe("boolean");
    expect(temp.hooks).toBeUndefined();
    expect(temp.validate).toBeUndefined();
  });

  test("relaxes the temporary field so the expand script can fill it in batches", () => {
    const { intermediate } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    expect(intermediate.types.User?.fields.priceMigrate?.required).toBe(false);
    expect(intermediate.types.User?.fields.priceMigrate?.unique).toBe(false);
  });

  test("contracts through a single rename that restores the final contract", () => {
    const { contract } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    expect(contract.changes).toEqual([
      expect.objectContaining({
        kind: "field_renamed",
        fieldName: "price",
        previousFieldName: "priceMigrate",
      }),
    ]);
    expect(contract.requiresMigrationScript).toBe(true);
  });

  test("carries the post-expand state as the contract's starting point", () => {
    const { contract } = generatePair(
      { price: snapshotField("integer", { required: true }) },
      { price: snapshotField("boolean", { required: true }) },
    );

    const renamed = contract.changes.find((change) => change.kind === "field_renamed");
    expect(renamed && "before" in renamed && renamed.before.type).toBe("boolean");
  });
});
