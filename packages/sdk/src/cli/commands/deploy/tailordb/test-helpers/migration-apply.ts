import { assert, vi } from "vitest";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
import type { NamespaceWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import type { DiffChange, MigrationDiff } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { NormalizedSchemaSnapshot } from "#/cli/commands/tailordb/migrate/snapshot";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBPlanResult } from "../plan";

const WORKSPACE_ID = "test-workspace";
const NAMESPACE = "test-ns";

// Each test file gets its own copy: files that call vi.mock run in isolation.
export const remoteCheckpoint = { number: null as number | null, historyId: null as string | null };

export function resetRemoteCheckpoint(number: number | null): void {
  remoteCheckpoint.number = number;
  remoteCheckpoint.historyId = null;
}

export async function recordRemoteCheckpoint(
  _client: OperatorClient,
  _workspaceId: string,
  _namespace: string,
  number: number,
  historyId?: string,
): Promise<boolean> {
  remoteCheckpoint.number = number;
  remoteCheckpoint.historyId = historyId ?? null;
  return true;
}

export function createMockClient(
  overrides: Partial<Record<keyof OperatorClient, unknown>> = {},
): OperatorClient {
  return {
    createTailorDBService: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn(async () => ({
      metadata: {
        labels: {
          ...(remoteCheckpoint.number !== null && {
            "sdk-migration": `m${String(remoteCheckpoint.number).padStart(4, "0")}`,
          }),
          ...(remoteCheckpoint.historyId && {
            "sdk-migration-history": remoteCheckpoint.historyId,
          }),
        },
      },
    })),
    setMetadata: vi.fn().mockResolvedValue({}),
    listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [] }),
    createTailorDBType: vi.fn().mockResolvedValue({}),
    updateTailorDBType: vi.fn().mockResolvedValue({}),
    createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
    deleteTailorDBType: vi.fn().mockResolvedValue({}),
    deleteTailorDBService: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as OperatorClient;
}

export const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

interface ChangeEntries {
  creates?: unknown[];
  updates?: unknown[];
  deletes?: unknown[];
  unchanged?: unknown[];
}

interface PlanResultOptions {
  type?: ChangeEntries;
  gqlPermission?: ChangeEntries;
  application?: Partial<Application>;
  context?: Partial<TailorDBPlanResult["context"]>;
}

function changeGroup(entries: ChangeEntries = {}) {
  return {
    creates: entries.creates ?? [],
    updates: entries.updates ?? [],
    deletes: entries.deletes ?? [],
    unchanged: entries.unchanged ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPlanResult(options: PlanResultOptions = {}): any {
  const namespacesWithMigrations: NamespaceWithMigrations[] = options.context
    ?.namespacesWithMigrations ?? [{ namespace: NAMESPACE, migrationsDir: "/test/migrations" }];
  return {
    changeSet: {
      service: changeGroup(),
      type: changeGroup(options.type),
      gqlPermission: changeGroup(options.gqlPermission),
    },
    context: {
      workspaceId: WORKSPACE_ID,
      application: {
        name: "test-app",
        authService: { config: { name: "auth", machineUsers: { migrator: {} } } },
        ...options.application,
      },
      tailorDBInputs: [],
      executorUsedTables: new Set<string>(),
      config: mockConfig,
      noSchemaCheck: true,
      checkpointRepairs: [],
      namespacesWithMigrations,
      migrationFileState: captureMigrationFileState(namespacesWithMigrations),
      ...options.context,
    },
  };
}

export function typeMetaRequest(tableName: string, namespace = NAMESPACE) {
  return {
    trn: `trn:v1:workspace:${WORKSPACE_ID}:tailordb:${namespace}:type:${tableName}`,
    labels: { "sdk-name": "test-app" },
  };
}

interface TypeEntryOptions {
  namespace?: string;
  fields?: Record<string, { type: string; required: boolean }>;
}

export function typeEntry(tableName: string, options: TypeEntryOptions = {}) {
  const namespace = options.namespace ?? NAMESPACE;
  return {
    name: tableName,
    request: {
      workspaceId: WORKSPACE_ID,
      namespaceName: namespace,
      tailordbType: {
        name: tableName,
        schema: { fields: options.fields ?? { name: { type: "string", required: true } } },
      },
    },
    metaRequest: typeMetaRequest(tableName, namespace),
  };
}

export function typeDeletion(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: { workspaceId: WORKSPACE_ID, namespaceName: namespace, tailordbTypeName: tableName },
  };
}

export function gqlPermissionEntry(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: {
      workspaceId: WORKSPACE_ID,
      namespaceName: namespace,
      typeName: tableName,
      permission: {},
    },
  };
}

export function gqlPermissionDeletion(tableName: string, namespace = NAMESPACE) {
  return {
    name: tableName,
    request: { workspaceId: WORKSPACE_ID, namespaceName: namespace, typeName: tableName },
  };
}

interface PendingMigrationOptions {
  number?: number;
  hasScript?: boolean;
  namespace?: string;
  migrationsDir?: string;
  diff?: Partial<MigrationDiff>;
}

export function mkPendingMigration(
  changes: DiffChange[],
  options: PendingMigrationOptions = {},
): PendingMigration {
  const number = options.number ?? 1;
  const hasScript = options.hasScript ?? true;
  const namespace = options.namespace ?? NAMESPACE;
  const migrationsDir = options.migrationsDir ?? "/test/migrations";
  const label = String(number).padStart(4, "0");
  return {
    number,
    scriptPath: `${migrationsDir}/${label}/migrate.ts`,
    diffPath: `${migrationsDir}/${label}/diff.json`,
    namespace,
    migrationsDir,
    hasScript,
    scriptForm: hasScript ? { kind: "main" } : null,
    diff: createMockMigrationDiff({
      namespace,
      changes,
      requiresMigrationScript: hasScript,
      ...options.diff,
    }),
  };
}

export function snapshotTable(
  name: string,
  fields: Record<string, { type: string; required: boolean }>,
  settings?: Record<string, unknown>,
) {
  return { name, pluralForm: `${name.toLowerCase()}s`, fields, ...(settings && { settings }) };
}

export function snapshotAt(
  tablesByVersion: Record<number, unknown>,
  maxVersion?: number,
): NormalizedSchemaSnapshot {
  const number = maxVersion ?? Math.max(...Object.keys(tablesByVersion).map(Number));
  const tables = tablesByVersion[number];
  assert(tables, `No snapshot fixture configured for migration number: ${number}`);
  return {
    version: 1,
    namespace: NAMESPACE,
    createdAt: "2026-01-01T00:00:00.000Z",
    tables,
  } as NormalizedSchemaSnapshot;
}
