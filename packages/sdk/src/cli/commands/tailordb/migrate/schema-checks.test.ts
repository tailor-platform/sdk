import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import {
  computeSourceScriptHash,
  extractSourceScriptHash,
} from "#/parser/service/tailordb/type-script";
import { buildInProgressSnapshot, logRemoteDriftGuidance } from "./schema-checks";
import {
  applyDiffToSnapshot,
  MISSING_REMOTE_SCRIPT_HASH_SUFFIX,
  SCHEMA_SNAPSHOT_VERSION,
  type SchemaSnapshot,
} from "./snapshot";
import { generateTailorDBTypeManifestFromSnapshot } from "./snapshot-manifest";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotField } from "./test-helpers/schema-fixtures";
import type { MigrationDiff } from "./diff-calculator";
import type { SchemaDrift } from "./types";

const missingHashDrift: SchemaDrift = {
  tableName: "Foo",
  kind: "script_mismatch",
  details: `Table 'Foo' ${MISSING_REMOTE_SCRIPT_HASH_SUFFIX}`,
};

const scriptsDifferDrift: SchemaDrift = {
  tableName: "Bar",
  kind: "script_mismatch",
  details: "Table 'Bar' scripts differ between remote and snapshot",
};

const conflictingHashDrift: SchemaDrift = {
  tableName: "Baz",
  kind: "script_mismatch",
  details: "Table 'Baz' has conflicting script hashes on remote",
};

const scriptNotOnRemoteDrift: SchemaDrift = {
  tableName: "Qux",
  kind: "script_mismatch",
  details: "Table 'Qux' has scripts in snapshot but not on remote",
};

function hintWasLogged(infoSpy: ReturnType<typeof vi.spyOn>): boolean {
  return (infoSpy.mock.calls as unknown[][]).some(
    ([message]) => typeof message === "string" && message.includes("add the missing hashes"),
  );
}

describe("logRemoteDriftGuidance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("adds the missing-hash hint when every drift is a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint when a drift is not a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift, scriptsDifferDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when no drift results are passed", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance();
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when only one of several namespaces has a non-missing-hash drift", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: true, drifts: [scriptsDifferDrift] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("shows the hint when namespaces without drift are ignored", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: false, drifts: [] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint for a conflicting-hash drift, which is not the missing-hash pattern", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [conflictingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint for a script-not-on-remote drift, which is not the missing-hash pattern", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [scriptNotOnRemoteDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });
});

const scripted = (expr: string) => snapshotField("string", { hooks: { create: { expr } } });

function userSnapshot(fields: Record<string, ReturnType<typeof snapshotField>>): SchemaSnapshot {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    tables: {
      User: {
        name: "User",
        pluralForm: "Users",
        fields: { id: snapshotField("uuid", { required: true }), ...fields },
      },
    },
  };
}

function deployedScriptHash(previous: SchemaSnapshot, diff: MigrationDiff): string | undefined {
  const target = applyDiffToSnapshot(previous, diff).tables.User!;
  const expr = generateTailorDBTypeManifestFromSnapshot(target).schema?.typeHook?.create?.expr;
  return expr ? extractSourceScriptHash(expr) : undefined;
}

describe("buildInProgressSnapshot", () => {
  test.each([
    [
      "a removed field",
      {
        kind: "field_removed",
        tableName: "User",
        fieldName: "legacy",
        before: scripted('"legacy"'),
      },
    ],
    [
      "the old field of a rename",
      {
        kind: "field_renamed",
        tableName: "User",
        fieldName: "renamed",
        previousFieldName: "legacy",
        before: scripted('"legacy"'),
        after: snapshotField("string"),
      },
    ],
  ] as const)(
    "hashes the table scripts the deploy wrote while %s is kept for the script",
    (_label, change) => {
      const previous = userSnapshot({ name: scripted('"name"'), legacy: scripted('"legacy"') });
      const diff = createMockMigrationDiff({
        changes: [change],
        requiresMigrationScript: true,
      });

      const expected = buildInProgressSnapshot(previous, diff).tables.User!;

      expect(expected.fields.legacy).toBeDefined();
      expect(computeSourceScriptHash(expected.fields)).toBe(deployedScriptHash(previous, diff));
    },
  );
});
