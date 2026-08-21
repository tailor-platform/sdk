import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, aroundEach, aroundAll } from "vitest";
import {
  loadSnapshot,
  loadDiff,
  getMigrationFiles,
  getNextMigrationNumber,
  getLatestMigrationNumber,
  writeSnapshot,
  writeDiff,
  SCHEMA_SNAPSHOT_VERSION,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  formatMigrationNumber,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
} from "./snapshot";
import { writeDiffToDir, writeSchemaToDir } from "./test-helpers/snapshot-test";
import type { MigrationDiff } from "./diff-calculator";

const TEST_MIGRATIONS_BASE = path.join(
  __dirname,
  "__test_migrations__",
  path.basename(import.meta.filename),
);

describe("snapshot", () => {
  const namespace = "tailordb";
  let testDir: string;

  aroundAll(async (runSuite) => {
    await runSuite();
    try {
      fs.rmSync(TEST_MIGRATIONS_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  aroundEach(async (runTest) => {
    testDir = path.join(
      TEST_MIGRATIONS_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
  });

  // ==========================================================================
  // getMigrationFiles
  // ==========================================================================
  describe("getMigrationFiles", () => {
    test("returns sorted list of migration files (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 2, diffContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files.length).toBe(3);
      expect(files[0]!.number).toBe(INITIAL_SCHEMA_NUMBER);
      expect(files[1]!.number).toBe(1);
      expect(files[2]!.number).toBe(2);
    });

    test("identifies schema vs diff files correctly (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const files = getMigrationFiles(testDir);

      expect(files[0]!.type).toBe("schema");
      expect(files[1]!.type).toBe("diff");
    });

    test("ignores invalid directories", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {},
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      // Create invalid directory name
      fs.mkdirSync(path.join(testDir, "invalid"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "README.md"), "readme");

      const files = getMigrationFiles(testDir);

      expect(files.length).toBe(1);
    });

    test("returns empty array for non-existent directory", () => {
      const nonExistent = path.join(testDir, "does-not-exist");
      const files = getMigrationFiles(nonExistent);
      expect(files).toEqual([]);
    });
  });

  // ==========================================================================
  // getNextMigrationNumber / getLatestMigrationNumber
  // ==========================================================================
  describe("getNextMigrationNumber", () => {
    test("returns INITIAL_SCHEMA_NUMBER (0) for empty directory", () => {
      const nextNum = getNextMigrationNumber(testDir);
      expect(nextNum).toBe(INITIAL_SCHEMA_NUMBER);
    });

    test("returns next number after latest (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 1, diffContent);

      const nextNum = getNextMigrationNumber(testDir);

      expect(nextNum).toBe(2);
    });
  });

  describe("getLatestMigrationNumber", () => {
    test("returns 0 for empty directory", () => {
      const latestNum = getLatestMigrationNumber(testDir);
      expect(latestNum).toBe(0);
    });

    test("returns highest migration number (directory structure)", () => {
      const schemaContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        types: {},
      };
      const diffContent = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: "",
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      writeSchemaToDir(testDir, INITIAL_SCHEMA_NUMBER, schemaContent);
      writeDiffToDir(testDir, 4, diffContent);

      const latestNum = getLatestMigrationNumber(testDir);

      expect(latestNum).toBe(4);
    });
  });

  // ==========================================================================
  // loadSnapshot / loadDiff / writeSnapshot / writeDiff
  // ==========================================================================
  describe("loadSnapshot", () => {
    test("loads snapshot from file", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const filePath = path.join(testDir, "test_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(loaded.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(loaded.tables.User).toBeDefined();
    });

    test("reads a legacy types key as tables", () => {
      const legacySnapshot = {
        version: 4,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const filePath = path.join(testDir, "legacy_types_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(Object.keys(loaded.tables)).toEqual(["User"]);
      expect(loaded.tables.User?.name).toBe("User");
    });

    test("keeps the current key when a snapshot carries both", () => {
      const table = (name: string) => ({
        [name]: {
          name,
          pluralForm: `${name}s`,
          fields: { id: { type: "uuid", required: true } },
        },
      });
      const filePath = path.join(testDir, "both_keys_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: table("Legacy"),
          tables: table("Current"),
        }),
      );

      expect(Object.keys(loadSnapshot(filePath).tables)).toEqual(["Current"]);
    });

    test("preserves unrecognized keys when normalizing a legacy types key", () => {
      const legacySnapshot = {
        version: 2,
        namespace,
        createdAt: new Date().toISOString(),
        futureKey: { nested: true },
        types: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const filePath = path.join(testDir, "legacy_types_extra_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath) as NormalizedSchemaSnapshot & {
        futureKey?: { nested: boolean };
      };

      expect(loaded.version).toBe(2);
      expect(loaded.futureKey).toEqual({ nested: true });
      expect(Object.keys(loaded.tables)).toEqual(["User"]);
    });

    test("keeps a legacy __proto__ table name through types normalization", () => {
      const types = Object.create(null) as Record<string, unknown>;
      types["__proto__"] = {
        name: "__proto__",
        pluralForm: "__proto__",
        fields: { id: { type: "uuid", required: true } },
      };
      const filePath = path.join(testDir, "legacy_proto_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 4,
          namespace,
          createdAt: new Date().toISOString(),
          types,
        }),
      );

      const loaded = loadSnapshot(filePath);

      expect(Object.keys(loaded.tables)).toEqual(["__proto__"]);
    });

    test("preserves type names that match Object prototype keys", () => {
      const tables = Object.create(null) as SchemaSnapshot["tables"];
      tables["__proto__"] = {
        name: "__proto__",
        pluralForm: "__proto__",
        fields: { id: { type: "uuid", required: true } },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables,
      };

      const filePath = path.join(testDir, "proto_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      const loaded = loadSnapshot(filePath);

      expect(Object.hasOwn(loaded.tables, "__proto__")).toBe(true);
      expect(loaded.tables["__proto__"]?.fields.id).toBeDefined();
    });
  });

  describe("loadDiff", () => {
    test("loads diff from file", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "test_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes.length).toBe(1);
      expect(loaded.changes[0]!.kind).toBe("table_added");
    });

    test("loads a phased field type change", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_type_modified",
            tableName: "User",
            fieldName: "age",
            before: { type: "integer", required: false },
            after: { type: "float", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            tableName: "User",
            fieldName: "age",
            reason: "Field type changed from integer to float",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "type_change_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      expect(loadDiff(filePath).changes[0]!.kind).toBe("field_type_modified");
    });

    test("backfills warnings fields for legacy diff.json", () => {
      // Legacy diff.json written before warning-tier support shipped. The file
      // has no warnings/hasWarnings keys at all.
      const legacyDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.warnings).toEqual([]);
      expect(loaded.hasWarnings).toBe(false);
      expect(loaded.changes.length).toBe(1);
    });

    test("reads legacy typeName across changes, breakingChanges, and warnings", () => {
      const legacyDiff = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            typeName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [{ typeName: "User", fieldName: "legacyCode", reason: "Field removed" }],
        hasWarnings: true,
        warnings: [{ typeName: "User", fieldName: "legacyCode", reason: "Field removed" }],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "legacy_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes[0]!.tableName).toBe("User");
      expect(loaded.breakingChanges[0]!.tableName).toBe("User");
      expect(loaded.warnings[0]!.tableName).toBe("User");
    });

    test("reads legacy previousTypeName on a rename change", () => {
      const legacyDiff = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_renamed",
            typeName: "Member",
            previousTypeName: "User",
            before: { name: "User", pluralForm: "Users", fields: {} },
            after: { name: "Member", pluralForm: "Members", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_previous_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const change = loadDiff(filePath).changes[0]!;

      expect(change.tableName).toBe("Member");
      expect(change.kind === "table_renamed" && change.previousTableName).toBe("User");
    });

    test("preserves unrecognized keys and version when normalizing legacy field names", () => {
      const legacyDiff = {
        version: 2,
        namespace,
        createdAt: new Date().toISOString(),
        description: "hand-written note",
        futureKey: { nested: true },
        changes: [
          {
            kind: "type_added",
            typeName: "NewType",
            unknownChangeKey: 42,
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_roundtrip_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath) as MigrationDiff & {
        description?: string;
        futureKey?: { nested: boolean };
      };

      expect(loaded.version).toBe(2);
      expect(loaded.description).toBe("hand-written note");
      expect(loaded.futureKey).toEqual({ nested: true });
      expect(loaded.changes[0]!.kind).toBe("table_added");
      expect(loaded.changes[0]!.tableName).toBe("NewType");
      expect((loaded.changes[0] as { unknownChangeKey?: number }).unknownChangeKey).toBe(42);
    });

    test("keeps a current-format diff.json unchanged", () => {
      const currentDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: "NewType",
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "current_table_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(currentDiff, null, 2));

      expect(loadDiff(filePath).changes[0]!.tableName).toBe("NewType");
    });

    test("rejects a diff.json whose tableName is not a string", () => {
      const malformed = {
        version: 3,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_added",
            tableName: 123,
            after: { name: "NewType", pluralForm: "NewTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "malformed_type_name_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(malformed, null, 2));

      expect(() => loadDiff(filePath)).toThrow(/Invalid migration diff/);
    });

    test("derives warnings from removal changes in a legacy diff.json", () => {
      // Legacy diff.json written before warning-tier support: removals are
      // recorded in changes but the warnings field does not exist yet.
      const legacyDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
          {
            kind: "table_removed",
            tableName: "OldType",
            before: { name: "OldType", pluralForm: "OldTypes", fields: {} },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "legacy_removal_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.hasWarnings).toBe(true);
      expect(loaded.warnings).toEqual([
        {
          tableName: "User",
          fieldName: "legacyCode",
          reason: "Field removed (existing data will no longer be accessible through the schema)",
        },
        {
          tableName: "OldType",
          reason:
            "Table removed (all records in this table will be deleted during post-migration cleanup)",
        },
      ]);
    });

    test("keeps a recorded empty warnings array authoritative over changes", () => {
      const diff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            tableName: "User",
            fieldName: "legacyCode",
            before: { type: "string" },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "recorded_empty_warnings_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.hasWarnings).toBe(false);
      expect(loaded.warnings).toEqual([]);
    });

    test("derives hasWarnings from warnings array regardless of stored flag", () => {
      // A hand-edited diff.json could end up with mismatched warnings and
      // hasWarnings; the loader must reconcile to the array.
      const inconsistentDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [
          {
            tableName: "Product",
            fieldName: "legacyCode",
            reason: "Field was removed",
          },
        ],
        requiresMigrationScript: false,
      };

      const filePath = path.join(testDir, "inconsistent_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(inconsistentDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.warnings.length).toBe(1);
      expect(loaded.hasWarnings).toBe(true);
    });

    test("loads a diff containing a type_renamed change", () => {
      const renameDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "table_renamed",
            tableName: "Person",
            previousTableName: "User",
            before: { name: "User", pluralForm: "Users", fields: {} },
            after: { name: "Person", pluralForm: "People", fields: {} },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            tableName: "Person",
            reason: "Table renamed from User to Person",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "type_rename_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(renameDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes).toEqual(renameDiff.changes);
      expect(loaded.requiresMigrationScript).toBe(true);
    });

    test("loads a diff containing a field_renamed change", () => {
      const renameDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_renamed",
            tableName: "User",
            fieldName: "displayName",
            previousFieldName: "fullName",
            before: { type: "string", required: false },
            after: { type: "string", required: false },
          },
        ],
        hasBreakingChanges: true,
        breakingChanges: [
          {
            tableName: "User",
            fieldName: "displayName",
            reason: "Field renamed from fullName to displayName",
          },
        ],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: true,
      };

      const filePath = path.join(testDir, "rename_diff.json");
      fs.writeFileSync(filePath, JSON.stringify(renameDiff, null, 2));

      const loaded = loadDiff(filePath);

      expect(loaded.changes).toEqual(renameDiff.changes);
      expect(loaded.requiresMigrationScript).toBe(true);
    });

    describe("legacy type_* change kinds", () => {
      const snapshotType = (name: string) => ({ name, pluralForm: `${name}s`, fields: {} });
      const settingsState = (pluralForm: string) => ({ pluralForm });

      // Payloads carry the legacy `typeName` spelling because that is the only
      // shape a pre-rename diff.json actually has on disk.
      const LEGACY_CHANGES = [
        ["type_added", "table_added", { typeName: "User", after: snapshotType("User") }],
        ["type_removed", "table_removed", { typeName: "OldUser", before: snapshotType("OldUser") }],
        [
          "type_renamed",
          "table_renamed",
          {
            typeName: "Person",
            previousTypeName: "User",
            before: snapshotType("User"),
            after: snapshotType("Person"),
          },
        ],
        ["type_modified", "table_modified", { typeName: "User" }],
        [
          "type_settings_modified",
          "table_settings_modified",
          {
            typeName: "User",
            before: settingsState("Users"),
            after: settingsState("People"),
          },
        ],
        [
          "type_scripts_modified",
          "table_scripts_modified",
          { typeName: "User", before: {}, after: { typeValidateExpr: "() => true" } },
        ],
      ] as const;

      test.each(LEGACY_CHANGES)("normalizes %s to %s", (legacyKind, currentKind, changePayload) => {
        const legacyDiff = {
          version: 2,
          namespace,
          createdAt: new Date().toISOString(),
          changes: [{ kind: legacyKind, ...changePayload }],
          hasBreakingChanges: false,
          breakingChanges: [],
          hasWarnings: false,
          warnings: [],
          requiresMigrationScript: false,
        };

        const filePath = path.join(testDir, `legacy_${legacyKind}_diff.json`);
        fs.writeFileSync(filePath, JSON.stringify(legacyDiff, null, 2));

        const change = loadDiff(filePath).changes[0]!;

        expect(change.kind).toBe(currentKind);
        expect(change.tableName).toBe(changePayload.typeName);
      });
    });
  });

  describe("loadSnapshot validation", () => {
    test.each([1, 2, 3])("loads supported snapshot format version %s", (version) => {
      const filePath = path.join(testDir, `v${version}_schema.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: new Date().toISOString(),
          types: { User: { name: "User", pluralForm: "Users", fields: {} } },
        }),
      );

      expect(loadSnapshot(filePath).version).toBe(version);
    });

    test("loads a valid rebaseline history marker", () => {
      const filePath = path.join(testDir, "rebaseline_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {},
          rebaseline: {
            historyId: "hcurrent",
            replacedHistoryId: "hprevious",
            replacedLatestMigration: 42,
          },
        }),
      );

      expect(loadSnapshot(filePath).rebaseline).toEqual({
        historyId: "hcurrent",
        replacedHistoryId: "hprevious",
        replacedLatestMigration: 42,
      });
    });

    test.each([
      ["historyId", { historyId: "INVALID!", replacedHistoryId: null, replacedLatestMigration: 1 }],
      [
        "replacedHistoryId",
        { historyId: "hcurrent", replacedHistoryId: "INVALID!", replacedLatestMigration: 1 },
      ],
      [
        "replacedLatestMigration",
        { historyId: "hcurrent", replacedHistoryId: null, replacedLatestMigration: 10_000 },
      ],
    ])("rejects an invalid rebaseline marker at %s", (field, rebaseline) => {
      const filePath = path.join(testDir, `invalid_rebaseline_${field}_schema.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {},
          rebaseline,
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(field);
    });

    test("rejects snapshot formats older than the supported window", () => {
      const version = 0;
      const filePath = path.join(testDir, `unsupported_v${version}_schema.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadSnapshot(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadSnapshot(filePath)).toThrow(
        /re-baseline with an SDK that still supports this migration history, then upgrade/i,
      );
    });

    test("rejects snapshot formats newer than the supported window", () => {
      const version = 6;
      const filePath = path.join(testDir, `unsupported_v${version}_schema.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadSnapshot(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadSnapshot(filePath)).toThrow(
        /upgrade to an SDK that supports migration file format version 6/i,
      );
    });

    test("rejects an ambiguous permission field-ref operand", () => {
      const filePath = path.join(testDir, "ambiguous_operand_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [],
                  read: [
                    {
                      permit: "allow",
                      conditions: [[{ user: "id", record: "ownerId" }, "eq", "x"]],
                    },
                  ],
                  update: [],
                  delete: [],
                },
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("rejects a record field-ref in GQL permission conditions", () => {
      const filePath = path.join(testDir, "gql_record_ref_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                gql: [
                  {
                    permit: "allow",
                    actions: ["read"],
                    conditions: [[{ record: "ownerId" }, "eq", "x"]],
                  },
                ],
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("loads a snapshot with an unknown operator string", () => {
      const filePath = path.join(testDir, "unknown_operator_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [],
                  read: [
                    {
                      permit: "allow",
                      conditions: [["x", "startsWith", "admin"]],
                    },
                  ],
                  update: [],
                  delete: [],
                },
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).not.toThrow();
    });

    test("loads a snapshot with an unknown GQL action", () => {
      const filePath = path.join(testDir, "unknown_gql_action_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                gql: [
                  {
                    permit: "allow",
                    actions: ["futureAction"],
                    conditions: [["x", "eq", "y"]],
                  },
                ],
              },
            },
          },
        }),
      );

      expect(() => loadSnapshot(filePath)).not.toThrow();
    });

    test("loads a field config without required and defaults it to true", () => {
      const filePath = path.join(testDir, "no_required_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {
                name: { type: "string" },
              },
            },
          },
        }),
      );

      const loaded = loadSnapshot(filePath);
      expect(loaded.tables.User?.fields.name?.required).toBe(true);
    });

    test("loads a partial record permission object (only create and read)", () => {
      const filePath = path.join(testDir, "partial_permission_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            User: {
              name: "User",
              pluralForm: "Users",
              fields: {},
              permissions: {
                record: {
                  create: [{ permit: "allow", conditions: [] }],
                  read: [{ permit: "allow", conditions: [] }],
                },
              },
            },
          },
        }),
      );

      const loaded = loadSnapshot(filePath);
      expect(loaded.tables.User?.permissions?.record?.create).toHaveLength(1);
      expect(loaded.tables.User?.permissions?.record?.update).toEqual([]);
      expect(loaded.tables.User?.permissions?.record?.delete).toEqual([]);
    });

    test("throws with file path when the file is not valid JSON", () => {
      const filePath = path.join(testDir, "truncated_schema.json");
      fs.writeFileSync(filePath, '{"version": 1, "namespace": "x"');

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("throws with file path when JSON is not an object", () => {
      const filePath = path.join(testDir, "corrupt_schema.json");
      fs.writeFileSync(filePath, JSON.stringify("not an object"));

      expect(() => loadSnapshot(filePath)).toThrow(filePath);
    });

    test("throws with file path and offending field path when a required field has wrong type", () => {
      const filePath = path.join(testDir, "bad_type_schema.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: 1, namespace: 42, createdAt: "t", types: {} }),
      );

      let thrownError: unknown;
      try {
        loadSnapshot(filePath);
      } catch (e) {
        thrownError = e;
      }
      expect(thrownError).toBeInstanceOf(Error);
      const message = (thrownError as Error).message;
      expect(message).toContain(filePath);
      // z.prettifyError includes the field path ("namespace") in the output
      expect(message).toContain("namespace");
    });

    test("loads a legacy snapshot missing newer optional fields", () => {
      // Older snapshots may omit pluralForm and settings on a table.
      const legacySnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        types: {
          Product: {
            name: "Product",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };
      const filePath = path.join(testDir, "legacy_schema.json");
      fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

      const loaded = loadSnapshot(filePath);
      expect(loaded.tables.Product?.name).toBe("Product");
      // pluralForm is backfilled from inflection
      expect(loaded.tables.Product?.pluralForm).toBe("Products");
    });

    test("unknown extra keys survive loadSnapshot → writeSnapshot round-trip", () => {
      // A snapshot written by a newer CLI may include unknown fields; they
      // must not be silently dropped on load/save.
      const snapshotWithExtra = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        futureTopLevelField: "keep-me",
        types: {
          Widget: {
            name: "Widget",
            pluralForm: "Widgets",
            futurTypeField: "also-keep",
            fields: {
              id: { type: "uuid", required: true, futureFieldProp: true },
            },
          },
        },
      };
      const loadPath = path.join(testDir, "future_schema.json");
      fs.writeFileSync(loadPath, JSON.stringify(snapshotWithExtra, null, 2));

      const loaded = loadSnapshot(loadPath);
      const savedPath = writeSnapshot(loaded, testDir, 99);
      const saved = JSON.parse(fs.readFileSync(savedPath, "utf-8")) as Record<string, unknown>;

      expect(saved.futureTopLevelField).toBe("keep-me");
      const widget = (saved.tables as Record<string, unknown>).Widget as Record<string, unknown>;
      expect(widget.futurTypeField).toBe("also-keep");
      const idField = (widget.fields as Record<string, unknown>).id as Record<string, unknown>;
      expect(idField.futureFieldProp).toBe(true);
    });
  });

  describe("loadDiff validation", () => {
    test.each([1, 2, 3])("loads supported diff format version %s", (version) => {
      const filePath = path.join(testDir, `v${version}_diff.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(loadDiff(filePath).version).toBe(version);
    });

    test("rejects diff formats older than the supported window", () => {
      const version = 0;
      const filePath = path.join(testDir, `unsupported_v${version}_diff.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadDiff(filePath)).toThrow(
        /re-baseline with an SDK that still supports this migration history, then upgrade/i,
      );
    });

    test("rejects diff formats newer than the supported window", () => {
      const version = 6;
      const filePath = path.join(testDir, `unsupported_v${version}_diff.json`);
      fs.writeFileSync(filePath, JSON.stringify({ version }));

      expect(() => loadDiff(filePath)).toThrow(/supports migration file format versions 1-5/);
      expect(() => loadDiff(filePath)).toThrow(
        /upgrade to an SDK that supports migration file format version 6/i,
      );
    });

    test("throws with file path when JSON is not an object", () => {
      const filePath = path.join(testDir, "corrupt_diff.json");
      fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]));

      expect(() => loadDiff(filePath)).toThrow(filePath);
    });

    test("throws with file path when a required field has wrong type", () => {
      const filePath = path.join(testDir, "bad_type_diff.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: "t",
          changes: "not-an-array",
          hasBreakingChanges: false,
          breakingChanges: [],
          requiresMigrationScript: false,
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(filePath);
    });

    test("rejects a whitespace-only migration script skip reason", () => {
      const filePath = path.join(testDir, "blank_skip_reason_diff.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          namespace,
          createdAt: "t",
          changes: [],
          hasBreakingChanges: true,
          breakingChanges: [],
          requiresMigrationScript: true,
          scriptSkipped: { reason: "   ", acknowledgedAt: "2026-07-22T00:00:00.000Z" },
        }),
      );

      expect(() => loadDiff(filePath)).toThrow(/reason/i);
    });
  });

  describe("writeSnapshot", () => {
    test("writes snapshot to directory structure with correct name", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const filePath = writeSnapshot(snapshot, testDir, INITIAL_SCHEMA_NUMBER);

      expect(filePath).toBe(
        path.join(testDir, formatMigrationNumber(INITIAL_SCHEMA_NUMBER), SCHEMA_FILE_NAME),
      );
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(SCHEMA_SNAPSHOT_VERSION).toBe(5);
      expect(loaded.version).toBe(5);
    });
  });

  describe("writeDiff", () => {
    test("writes diff to directory structure with correct name", () => {
      const diff: MigrationDiff = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        changes: [],
        hasBreakingChanges: false,
        breakingChanges: [],
        hasWarnings: false,
        warnings: [],
        requiresMigrationScript: false,
      };

      const filePath = writeDiff(diff, testDir, 1);

      expect(filePath).toBe(path.join(testDir, formatMigrationNumber(1), DIFF_FILE_NAME));
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
