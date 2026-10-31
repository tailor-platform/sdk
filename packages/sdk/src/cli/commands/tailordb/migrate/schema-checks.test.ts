import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import {
  computeSourceScriptHash,
  extractSourceScriptHash,
} from "#/parser/service/tailordb/type-script";
import {
  buildInProgressSnapshot,
  formatRemoteVerificationResults,
  logRemoteDriftGuidance,
  verifyRemoteSchema,
} from "./schema-checks";
import {
  applyDiffToSnapshot,
  MISSING_REMOTE_SCRIPT_HASH_SUFFIX,
  SCHEMA_SNAPSHOT_VERSION,
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "./snapshot";
import { generateTailorDBTypeManifestFromSnapshot } from "./snapshot-manifest";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import {
  remoteType,
  snapshotField,
  snapshotType,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
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

  test("keeps the config, workspace, and profile of this run in the status command it suggests", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance(
      { configPath: "custom.config.ts", contextArgs: ["--workspace-id=ws-1", "--profile=staging"] },
      [{ hasDrift: true, drifts: [scriptsDifferDrift] }],
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "  - Run `tailor tailordb migration status --config=custom.config.ts --workspace-id=ws-1 --profile=staging` to compare local vs remote.",
      { mode: "plain" },
    );
  });

  test("adds the missing-hash hint when every drift is a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [{ hasDrift: true, drifts: [missingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint when a drift is not a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [
      { hasDrift: true, drifts: [missingHashDrift, scriptsDifferDrift] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when no drift results are passed", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({});
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when only one of several namespaces has a non-missing-hash drift", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: true, drifts: [scriptsDifferDrift] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("shows the hint when namespaces without drift are ignored", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: false, drifts: [] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint for a conflicting-hash drift, which is not the missing-hash pattern", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [{ hasDrift: true, drifts: [conflictingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the generic steps when every drifted namespace has no checkpoint yet", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [
      { hasDrift: true, drifts: [scriptsDifferDrift], checkpointUnset: true },
      { hasDrift: false, drifts: [] },
    ]);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("keeps the generic steps when a namespace with a checkpoint also drifted", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [
      { hasDrift: true, drifts: [scriptsDifferDrift], checkpointUnset: true },
      { hasDrift: true, drifts: [scriptsDifferDrift] },
    ]);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("migration generate"),
      expect.anything(),
    );
  });

  test("omits the hint for a script-not-on-remote drift, which is not the missing-hash pattern", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance({}, [{ hasDrift: true, drifts: [scriptNotOnRemoteDrift] }]);
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

  test("hashes the table scripts the deploy wrote while a removed nested member is kept for the script", () => {
    const before = snapshotField("nested", {
      fields: { street: snapshotField("string"), legacy: scripted('"legacy"') },
    });
    const after = snapshotField("nested", { fields: { street: snapshotField("string") } });
    const previous = userSnapshot({ name: scripted('"name"'), address: before });
    const diff = createMockMigrationDiff({
      changes: [{ kind: "field_modified", tableName: "User", fieldName: "address", before, after }],
      requiresMigrationScript: true,
    });

    const expected = buildInProgressSnapshot(previous, diff).tables.User!;

    expect(expected.fields.address?.fields?.legacy).toBeDefined();
    expect(computeSourceScriptHash(expected.fields)).toBe(deployedScriptHash(previous, diff));
  });
});

describe("verifyRemoteSchema", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function migrationsDirWith(tables: Record<string, TailorDBSnapshotType>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-checks-verify-"));
    temporaryDirectories.push(dir);
    writeInitialSchema(dir, tables);
    return dir;
  }

  function migrationsDirWithUser(): string {
    return migrationsDirWith({ User: snapshotType("User") });
  }

  function remoteClient(metadata: unknown, remoteTypes: unknown[]) {
    return {
      getMetadata: vi.fn().mockResolvedValue({ metadata }),
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValue({ tailordbTypes: remoteTypes, nextPageToken: "" }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({ permissions: [], nextPageToken: "" }),
    } as unknown as OperatorClient;
  }

  function verify(client: OperatorClient, migrationsDir: string) {
    return verifyRemoteSchema(
      client,
      "workspace",
      [{ namespace: "tailordb", migrationsDir }],
      {} as LoadedConfig,
      [],
    );
  }

  test("verifies a deployed namespace without a checkpoint against 0000", async () => {
    const client = remoteClient({ labels: {} }, [remoteType("User", ["id", "name"])]);

    await expect(verify(client, migrationsDirWithUser())).resolves.toEqual([
      {
        namespace: "tailordb",
        remoteMigrationNumber: 0,
        drifts: [],
        hasDrift: false,
        checkpointUnset: true,
      },
    ]);
  });

  test("reports where a deployed namespace without a checkpoint differs from 0000", async () => {
    const client = remoteClient({ labels: {} }, [remoteType("User", ["id", "name", "legacyCode"])]);

    const [result] = await verify(client, migrationsDirWithUser());

    expect(result).toMatchObject({ hasDrift: true, checkpointUnset: true });
    expect(result?.drifts).toEqual([
      expect.objectContaining({ tableName: "User", fieldName: "legacyCode" }),
    ]);
  });

  test("skips a namespace that has metadata but no tables yet", async () => {
    const client = remoteClient({ labels: {} }, []);

    await expect(verify(client, migrationsDirWithUser())).resolves.toEqual([
      {
        namespace: "tailordb",
        remoteMigrationNumber: 0,
        drifts: [],
        hasDrift: false,
        skipped: "not_deployed",
      },
    ]);
  });

  test("queries the configured namespace even when 0000 records another one", async () => {
    const dir = migrationsDirWithUser();
    const schemaPath = path.join(dir, "0000", "schema.json");
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(schemaPath, "utf-8")),
        namespace: "elsewhere",
      }),
    );
    const client = remoteClient({ labels: {} }, [remoteType("User", ["id", "name"])]);

    const [result] = await verify(client, dir);

    expect(result).toMatchObject({ hasDrift: false, checkpointUnset: true });
    expect(client.listTailorDBTypes).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "tailordb" }),
    );
  });

  test("accepts field defaults in 0000 that the remote does not carry", async () => {
    const itemFields = { name: snapshotField("string", { required: true, default: "unnamed" }) };
    const dir = migrationsDirWith({
      Item: { name: "Item", pluralForm: "Items", fields: itemFields },
    });
    const item = remoteType("Item", ["name"]);
    const remoteItem = {
      ...item,
      schema: {
        ...item.schema,
        typeHook: {
          create: { expr: `_value // @sdk-source-hash:${computeSourceScriptHash(itemFields)}` },
        },
      },
    };
    const client = remoteClient({ labels: {} }, [remoteItem]);

    const [result] = await verify(client, dir);

    expect(result).toMatchObject({ hasDrift: false, checkpointUnset: true });
  });
});

describe("formatRemoteVerificationResults", () => {
  test("shows the checkpoint of a namespace without one as unset", () => {
    const output = formatRemoteVerificationResults([
      {
        namespace: "tailordb",
        remoteMigrationNumber: 0,
        drifts: [scriptsDifferDrift],
        hasDrift: true,
        checkpointUnset: true,
      },
    ]);

    expect(output).toContain("Remote migration: <unset>");
  });
});
