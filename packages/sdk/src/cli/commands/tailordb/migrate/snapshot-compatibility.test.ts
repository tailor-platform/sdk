import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { aroundEach, describe, expect, test } from "vitest";
import { extractSourceScriptHash } from "#/parser/service/tailordb/type-script";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import { loadDiff, loadSnapshot } from "./snapshot-files";
import { generateTailorDBTypeManifestFromSnapshot } from "./snapshot-manifest";
import { reconstructSnapshotFromMigrations } from "./snapshot-migrations";
import { generateSchemaFile } from "./template-generator";
import { writeDiffToDir, writeSchemaToDir } from "./test-helpers/snapshot-test";
import type { DiffChange } from "./diff-calculator";
import type { SchemaSnapshot, TailorDBSnapshotType } from "./snapshot-types";

const fixtureDir = path.join(import.meta.dirname, "__test_fixtures__/compatibility/v2");
const user = {
  id: "user-1",
  type: "USER_TYPE_MACHINE_USER",
  workspace_id: "workspace-1",
  attribute_map: {},
  attributes: [],
};

describe("migration file compatibility", () => {
  let testDir: string;

  aroundEach(async (runTest) => {
    testDir = fs.mkdtempSync(path.join(tmpdir(), "migration-compatibility-"));
    try {
      await runTest();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function readHistoricalSnapshot(): SchemaSnapshot {
    const { types, ...raw } = JSON.parse(
      fs.readFileSync(path.join(fixtureDir, "0000/schema.json"), "utf8"),
    ) as Omit<SchemaSnapshot, "tables"> & { types: Record<string, TailorDBSnapshotType> };
    return { ...raw, tables: types };
  }

  function validate(table: TailorDBSnapshotType, record: Record<string, unknown>): unknown {
    const manifest = generateTailorDBTypeManifestFromSnapshot(table);
    const expr = manifest.schema!.typeValidate!.create!.expr!;
    return new Function("_newRecord", "_oldRecord", "user", `return ${expr}\n`)(record, null, user);
  }

  test("preserves boolean validation failures in the historical v2 snapshot", () => {
    const snapshot = loadSnapshot(path.join(fixtureDir, "0000/schema.json"));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
    const expr = manifest.schema!.typeValidate!.create!.expr!;
    const validate = new Function("_newRecord", "_oldRecord", "user", `return ${expr}\n`);
    const record = { name: "x", city: "Tokyo" };

    expect(() => validate(record, null, user)).not.toThrow();
    expect(validate(record, null, user)).toEqual({
      name: "Name must be longer than 5 characters",
    });
  });

  test.each([1, 2, 3, 4, 5, 6])("preserves saved script semantics in format %s", (version) => {
    const raw = readHistoricalSnapshot();
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, { ...raw, version }));

    expect(validate(snapshot.tables.Customer!, { name: "x", city: "Tokyo" })).toEqual({
      name: "Name must be longer than 5 characters",
    });
    expect(validate(snapshot.tables.Customer!, { name: "long enough", city: "Tokyo" })).toEqual({});
  });

  test.each(["create", "update"] as const)(
    "preserves legacy %s hook access to the record",
    (operation) => {
      const snapshot = loadSnapshot(path.join(fixtureDir, "0000/schema.json"));
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
      const expr = manifest.schema!.typeHook![operation]!.expr!;
      const record = { postalCode: "100", address: "Tokyo", city: "Chiyoda" };
      const oldRecord =
        operation === "update" ? { postalCode: "999", address: "Osaka", city: "Chuo" } : null;

      expect(
        new Function("_input", "_oldRecord", "user", `return ${expr}\n`)(record, oldRecord, user),
      ).toEqual({
        fullAddress: "100 Tokyo Chiyoda",
      });
    },
  );

  test("preserves existing fields in legacy hooks during partial updates", () => {
    const snapshot = loadSnapshot(path.join(fixtureDir, "0000/schema.json"));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
    const expr = manifest.schema!.typeHook!.update!.expr!;
    const input = Object.freeze({ city: "Chiyoda" });
    const oldRecord = Object.freeze({ postalCode: "100", address: "Tokyo", city: "Chuo" });

    expect(
      new Function("_input", "_oldRecord", "user", `return ${expr}\n`)(input, oldRecord, user),
    ).toEqual({
      fullAddress: "100 Tokyo Chiyoda",
    });
  });

  test("preserves explicit nulls in legacy update hooks", () => {
    const snapshot = loadSnapshot(path.join(fixtureDir, "0000/schema.json"));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
    const expr = manifest.schema!.typeHook!.update!.expr!;
    const input = { city: null };
    const oldRecord = { postalCode: "100", address: "Tokyo", city: "Chuo" };

    expect(
      new Function("_input", "_oldRecord", "user", `return ${expr}\n`)(input, oldRecord, user),
    ).toEqual({
      fullAddress: "100 Tokyo null",
    });
  });

  test("preserves legacy hook access to sibling fields when nested", () => {
    const raw = readHistoricalSnapshot();
    const { postalCode, address, city, fullAddress } = raw.tables.Customer!.fields;
    raw.tables.Customer!.fields = {
      profile: {
        type: "nested",
        required: false,
        fields: {
          postalCode: postalCode!,
          address: address!,
          city: city!,
          fullAddress: fullAddress!,
        },
      },
    };
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);

    const createExpr = manifest.schema!.typeHook!.create!.expr!;
    const createInput = { profile: { postalCode: "100", address: "Tokyo", city: "Chiyoda" } };
    expect(
      new Function("_input", "_oldRecord", "user", `return ${createExpr}\n`)(
        createInput,
        null,
        user,
      ),
    ).toMatchObject({ profile: { fullAddress: "100 Tokyo Chiyoda" } });

    const updateExpr = manifest.schema!.typeHook!.update!.expr!;
    const input = { profile: { city: "Chiyoda" } };
    const oldRecord = { profile: { postalCode: "100", address: "Tokyo", city: "Chuo" } };
    expect(
      new Function("_input", "_oldRecord", "user", `return ${updateExpr}\n`)(
        input,
        oldRecord,
        user,
      ),
    ).toMatchObject({ profile: { fullAddress: "100 Tokyo Chiyoda" } });
    expect(
      new Function("_input", "_oldRecord", "user", `return ${updateExpr}\n`)({}, oldRecord, user),
    ).toMatchObject({ profile: { fullAddress: "100 Tokyo Chuo" } });
  });

  test("preserves omitted nested values read by a legacy update hook", () => {
    const raw = readHistoricalSnapshot();
    raw.tables.Customer!.fields = {
      profile: {
        type: "nested",
        required: false,
        fields: {
          postalCode: { type: "string", required: false },
          city: { type: "string", required: false },
        },
      },
      label: {
        type: "string",
        required: false,
        hooks: {
          update: {
            expr: "_data.profile === null ? 'cleared' : _data.profile.postalCode + ' ' + _data.profile.city",
          },
        },
      },
    };
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
    const run = new Function(
      "_input",
      "_oldRecord",
      `return ${manifest.schema!.typeHook!.update!.expr!}\n`,
    );
    const oldRecord = Object.freeze({
      profile: Object.freeze({ postalCode: "100", city: "Chuo" }),
    });
    const input = Object.freeze({ profile: Object.freeze({ city: "Chiyoda" }) });

    expect(run(input, oldRecord)).toMatchObject({ label: "100 Chiyoda" });
    expect(run({ profile: null }, oldRecord)).toMatchObject({ label: "cleared" });
  });

  test("preserves legacy hook access to the current array element", () => {
    const raw = readHistoricalSnapshot();
    const { postalCode, address, city, fullAddress } = raw.tables.Customer!.fields;
    raw.tables.Customer!.fields = {
      entries: {
        type: "nested",
        required: false,
        array: true,
        fields: {
          postalCode: postalCode!,
          address: address!,
          city: city!,
          fullAddress: fullAddress!,
        },
      },
    };
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);
    const input = { entries: [{ postalCode: "100", address: "Tokyo", city: "Chiyoda" }] };
    for (const operation of ["create", "update"] as const) {
      const run = new Function(
        "_input",
        "_oldRecord",
        "user",
        `return ${manifest.schema!.typeHook![operation]!.expr!}\n`,
      );
      expect(run(input, { entries: [] }, user)).toMatchObject({
        entries: [{ fullAddress: "100 Tokyo Chiyoda" }],
      });
    }
  });

  test("preserves every validator's metadata when saving a baseline", async () => {
    const raw = readHistoricalSnapshot();
    const first = raw.tables.Customer!.fields.name!.validate![0]!;
    const validations = [
      { ...first, futureMetadata: { id: "first" } },
      {
        script: { expr: "_data.name !== 'forbidden'", futureScriptMetadata: "second" },
        errorMessage: "forbidden name",
        futureMetadata: { id: "second" },
      },
    ];
    raw.tables.Customer!.fields.name!.validate = validations;
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));
    const { filePath } = await generateSchemaFile(snapshot, testDir, 1);
    const reloaded = loadSnapshot(filePath);

    expect(reloaded.tables.Customer!.fields.name!.validate).toEqual(
      raw.tables.Customer!.fields.name!.validate,
    );
    expect(validate(reloaded.tables.Customer!, { name: "forbidden", city: "Tokyo" })).toEqual({
      name: "forbidden name",
    });
  });

  test("preserves the historical source hash when compiling legacy scripts", () => {
    const snapshot = loadSnapshot(path.join(fixtureDir, "0000/schema.json"));
    const manifest = generateTailorDBTypeManifestFromSnapshot(snapshot.tables.Customer!);

    expect(extractSourceScriptHash(manifest.schema!.typeHook!.create!.expr!)).toBe(
      "9a8ff2388df89279",
    );
  });

  test("stops a legacy validator chain at its first failure", () => {
    const raw = readHistoricalSnapshot();
    const field = raw.tables.Customer!.fields.name!;
    field.validate!.push({
      script: { expr: '(() => { throw new Error("must not run"); })({ data: _data })' },
      errorMessage: "second failure",
    });
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));

    expect(() => validate(snapshot.tables.Customer!, { name: "x", city: "Tokyo" })).not.toThrow();
    expect(validate(snapshot.tables.Customer!, { name: "x", city: "Tokyo" })).toEqual({
      name: "Name must be longer than 5 characters",
    });
  });

  test("normalizes legacy validators inside nested fields and arrays", () => {
    const raw = readHistoricalSnapshot();
    const legacyName = raw.tables.Customer!.fields.name!;
    raw.tables.Customer!.fields = {
      profile: { type: "nested", required: false, fields: { name: legacyName } },
      entries: { type: "nested", required: false, array: true, fields: { name: legacyName } },
    };
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));

    expect(
      validate(snapshot.tables.Customer!, {
        profile: { name: "x" },
        entries: [{ name: "long enough" }, { name: "y" }],
      }),
    ).toEqual({
      "profile.name": "Name must be longer than 5 characters",
      "entries[1].name": "Name must be longer than 5 characters",
    });
  });

  test("leaves current expressions and locally bound legacy-looking names unchanged", () => {
    const raw = readHistoricalSnapshot();
    raw.tables.Customer!.fields = {
      name: {
        type: "string",
        required: true,
        validate: [
          {
            script: {
              expr: '(({value}) => value.length > 5 ? undefined : "too short")({value: _value})',
            },
            errorMessage: "",
          },
          {
            script: { expr: '((_data) => _data === "x" ? "last error" : undefined)(_value)' },
            errorMessage: "",
          },
        ],
      },
      label: { type: "string", required: false, hooks: { create: { expr: '"_data"' } } },
    };
    const snapshot = loadSnapshot(writeSchemaToDir(testDir, 0, raw));

    expect(snapshot.tables.Customer!.fields).toEqual(raw.tables.Customer!.fields);
    expect(validate(snapshot.tables.Customer!, { name: "x" })).toEqual({ name: "last error" });
  });

  test("replays old and current diffs while adapting both before and after fields", () => {
    fs.cpSync(fixtureDir, testDir, { recursive: true });
    const legacy = loadDiff(path.join(testDir, "0001/diff.json"));
    for (const change of legacy.changes) {
      if (change.kind !== "field_modified" || change.fieldName !== "name") continue;
      for (const field of [change.before, change.after]) {
        expect(
          validate(
            { name: "Customer", pluralForm: "Customers", fields: { name: field } },
            { name: "x" },
          ),
        ).toEqual({
          name: "Name must be longer than 5 characters",
        });
      }
    }
    writeDiffToDir(testDir, 2, {
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: "2026-09-10T00:00:00Z",
      changes: [
        {
          kind: "field_added",
          tableName: "Customer",
          fieldName: "code",
          after: {
            type: "string",
            required: false,
            validate: [
              {
                script: { expr: '_value === "ok" ? undefined : "invalid code"' },
                errorMessage: "",
              },
            ],
          },
        },
      ],
      hasBreakingChanges: false,
      breakingChanges: [],
      requiresMigrationScript: false,
    });

    const snapshot = reconstructSnapshotFromMigrations(testDir)!;
    expect(validate(snapshot.tables.Customer!, { name: "x", city: "Tokyo", code: "bad" })).toEqual({
      name: "Name must be longer than 5 characters",
      code: "invalid code",
    });
  });

  test("keeps source files unchanged and preserves behavior through baseline serialization", async () => {
    const sourcePath = path.join(fixtureDir, "0000/schema.json");
    const original = fs.readFileSync(sourcePath, "utf8");
    const snapshot = loadSnapshot(sourcePath);
    const baseline = { ...snapshot, version: SCHEMA_SNAPSHOT_VERSION };
    const { filePath } = await generateSchemaFile(baseline, testDir, 0);
    const reloaded = loadSnapshot(filePath);

    expect(reloaded.tables).toEqual(snapshot.tables);
    expect(loadSnapshot(filePath)).toEqual(reloaded);
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(original);
    expect(validate(reloaded.tables.Customer!, { name: "x", city: "Tokyo" })).toEqual({
      name: "Name must be longer than 5 characters",
    });
  });

  test("adapts legacy scripts in every table and field change carrying a schema", () => {
    const table = readHistoricalSnapshot().tables.Customer!;
    const field = table.fields.name!;
    const changes: DiffChange[] = [
      { kind: "table_added", tableName: "Customer", after: table },
      { kind: "table_removed", tableName: "Customer", before: table },
      {
        kind: "table_renamed",
        tableName: "Customer",
        previousTableName: "Client",
        before: table,
        after: table,
      },
      { kind: "field_added", tableName: "Customer", fieldName: "name", after: field },
      { kind: "field_removed", tableName: "Customer", fieldName: "name", before: field },
      {
        kind: "field_modified",
        tableName: "Customer",
        fieldName: "name",
        before: field,
        after: field,
      },
      {
        kind: "field_type_modified",
        tableName: "Customer",
        fieldName: "name",
        before: field,
        after: field,
      },
      {
        kind: "field_renamed",
        tableName: "Customer",
        fieldName: "name",
        previousFieldName: "label",
        before: field,
        after: field,
      },
    ];
    const filePath = writeDiffToDir(testDir, 1, {
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: "2026-09-10T00:00:00Z",
      changes,
      hasBreakingChanges: false,
      breakingChanges: [],
      requiresMigrationScript: false,
    });
    const original = fs.readFileSync(filePath, "utf8");
    const diff = loadDiff(filePath);

    for (const change of diff.changes) {
      const schemas = [];
      switch (change.kind) {
        case "table_added":
          schemas.push(change.after);
          break;
        case "table_removed":
          schemas.push(change.before);
          break;
        case "table_renamed":
          schemas.push(change.before, change.after);
          break;
        case "field_added":
          schemas.push({ ...table, fields: { name: change.after } });
          break;
        case "field_removed":
          schemas.push({ ...table, fields: { name: change.before } });
          break;
        case "field_modified":
        case "field_type_modified":
        case "field_renamed":
          schemas.push(
            { ...table, fields: { name: change.before } },
            { ...table, fields: { name: change.after } },
          );
          break;
        default:
          throw new Error(`Unexpected change kind: ${change.kind}`);
      }
      for (const schema of schemas) {
        expect(validate(schema, { name: "x", city: "Tokyo" })).toEqual({
          name: "Name must be longer than 5 characters",
        });
      }
    }
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
    expect(loadDiff(writeDiffToDir(testDir, 2, diff))).toEqual(diff);
  });
});
