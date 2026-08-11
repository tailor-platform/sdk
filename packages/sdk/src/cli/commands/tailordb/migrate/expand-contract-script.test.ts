import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { writeDbTypesFile } from "./db-types-generator";
import { MIGRATION_REVIEW_REQUIRED_MARKER, generateMigrationScript } from "./template-generator";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotField, snapshotType } from "./test-helpers/schema-fixtures";
import type { ExpandContractPlan } from "./expand-contract";
import type { SchemaSnapshot } from "./snapshot-types";

const plan: ExpandContractPlan = {
  typeName: "User",
  fieldName: "price",
  tempFieldName: "priceMigrate",
  before: snapshotField("integer", { required: true }),
  after: snapshotField("string", { required: true }),
};

function expandScript(plans: ExpandContractPlan[] = [plan]): string {
  return generateMigrationScript(
    createMockMigrationDiff({
      changes: [
        { kind: "field_added", typeName: "User", fieldName: "priceMigrate", after: plan.after },
        { kind: "field_removed", typeName: "User", fieldName: "price", before: plan.before },
      ],
    }),
    plans,
  );
}

describe("expand conversion script", () => {
  test("clears the original field in the same update that writes the converted value", () => {
    expect(expandScript()).toContain(`.set({
            ["priceMigrate"]: convertedValue,
            ["price"]: null,
          })`);
  });

  test("selects only rows still holding a value, so a re-run skips converted rows", () => {
    expect(expandScript()).toContain(`.where("price", "is not", null)`);
  });

  test("advances by id, so an edited body cannot loop on the same batch", () => {
    const script = expandScript();

    expect(script).toContain(`query = query.where("id", ">", lastId)`);
    expect(script).toContain("lastId = rows[rows.length - 1]!.id;");
  });

  test("marks the conversion as needing review", () => {
    const script = expandScript();

    expect(script).toContain(MIGRATION_REVIEW_REQUIRED_MARKER);
    expect(script).toContain("const convertedValue: never = sourceValue;");
  });

  test("emits a conversion for each planned field", () => {
    const script = expandScript([
      plan,
      { ...plan, fieldName: "size", tempFieldName: "sizeMigrate" },
    ]);

    expect(script).toContain(`["priceMigrate"]: convertedValue`);
    expect(script).toContain(`["sizeMigrate"]: convertedValue`);
  });

  test("does not fall back to the no-op placeholder", () => {
    expect(expandScript()).not.toContain("No data migration needed");
  });

  test("leaves migrations without a plan untouched", () => {
    const script = generateMigrationScript(
      createMockMigrationDiff({
        changes: [
          { kind: "field_removed", typeName: "User", fieldName: "price", before: plan.before },
        ],
      }),
    );

    expect(script).toContain("No data migration needed");
    expect(script).not.toContain("convertedValue");
  });
});

describe("db.ts for an expand migration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function generate(): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expand-contract-db-"));
    tempDirs.push(dir);
    const migrationsDir = path.join(dir, "migrations");
    fs.mkdirSync(path.join(migrationsDir, "0001"), { recursive: true });

    const snapshot: SchemaSnapshot = {
      version: 1,
      namespace: "testdb",
      createdAt: "2026-01-01T00:00:00.000Z",
      types: {
        User: { ...snapshotType("User"), fields: { price: plan.before } },
      },
    };
    const filePath = await writeDbTypesFile(
      snapshot,
      migrationsDir,
      1,
      createMockMigrationDiff({ changes: [] }),
      [plan],
    );
    return fs.readFileSync(filePath, "utf8");
  }

  test("declares the temporary field the conversion script writes", async () => {
    expect(await generate()).toMatch(/priceMigrate: [^;]+;/);
  });

  test("keeps the original field readable and nullable so the script can clear it", async () => {
    const content = await generate();

    expect(content).toMatch(/\bprice: [^;]*null[^;]*;/);
  });
});
