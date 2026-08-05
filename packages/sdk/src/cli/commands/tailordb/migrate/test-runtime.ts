import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import * as path from "pathe";
import {
  deployMigrationTestBaseline,
  deployMigrationTestTarget,
} from "#/cli/commands/deploy/deploy";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { getMigrationMachineUser } from "#/cli/commands/deploy/tailordb/migration";
import { bundleSeedScript } from "#/cli/commands/generate/seed/bundler";
import {
  toTailorDBDeployInput,
  verifyRemoteSchema,
} from "#/cli/commands/tailordb/migrate/schema-checks";
import { createValidatedWorkspaceWithClient } from "#/cli/commands/workspace/create";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { executeScript } from "#/cli/shared/script-executor";
import { chunkSeedData, type SeedData } from "#/cli/shared/seed-chunker";
import { loadSeedContext, type SeedContext } from "#/cli/shared/seed-context";
import { loadApplicationNamespaces } from "#/cli/shared/tailordb-namespaces";
import { assertDefined } from "#/utils/assert";
import { bundleMigrationScript } from "./bundler";
import { getNamespacesWithMigrations } from "./config";
import { fetchRemoteMigrationNumber } from "./remote-state";
import {
  assertValidMigrationFiles,
  getLatestMigrationNumber,
  normalizeSchemaSnapshot,
  reconstructSnapshotFromMigrations,
  type NormalizedSchemaSnapshot,
} from "./snapshot";
import type { LoadedApplicationNamespaces } from "#/cli/shared/tailordb-namespaces";
import type { TailorDBServiceConfig } from "#/types/tailordb.generated";
import type {
  MigrationTestDependencies,
  MigrationTestOptions,
  PreparedMigrationTest,
} from "./test-types";
import type { JsonObject } from "type-fest";

const CLONE_POLL_INTERVAL = 1_000;
const CLONE_TIMEOUT = 5 * 60 * 1_000;

interface RuntimeState {
  client: OperatorClient;
  loaded: LoadedApplicationNamespaces;
  options: MigrationTestOptions;
  seedContext?: SeedContext;
}

interface WaitForCloneOptions {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  operationId: string;
  pollInterval?: number;
  timeout?: number;
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function assertSeedDataDirectory(dataDir: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Seed data directory not found: ${dataDir}. Run 'tailor generate' before testing migrations.`,
        { cause: error },
      );
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Seed data path is not a directory: ${dataDir}`);
  }
}

function assertAssertionScript(assertionPath: string): void {
  const resolvedPath = path.resolve(assertionPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Migration assertion script not found: ${resolvedPath}`, { cause: error });
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(`Migration assertion path is not a file: ${resolvedPath}`);
  }
}

/**
 * Wait for an application-data clone operation to reach a terminal state.
 * @param client - Operator client
 * @param options - Clone operation identifiers and polling limits
 */
export async function waitForCloneApplicationData(
  client: OperatorClient,
  options: WaitForCloneOptions,
): Promise<void> {
  const pollInterval = options.pollInterval ?? CLONE_POLL_INTERVAL;
  const timeout = options.timeout ?? CLONE_TIMEOUT;
  const deadline = Date.now() + timeout;

  while (Date.now() <= deadline) {
    const operation = await client.getCloneApplicationDataOperation({
      sourceWorkspaceId: options.sourceWorkspaceId,
      targetWorkspaceId: options.targetWorkspaceId,
      operationId: options.operationId,
    });
    if (operation.status === CloneOperationStatus.COMPLETED) {
      return;
    }
    if (operation.status === CloneOperationStatus.FAILED) {
      throw new Error(
        `Application data clone failed: ${operation.errorMessage || "unknown platform error"}`,
      );
    }
    if (
      operation.status !== CloneOperationStatus.PENDING &&
      operation.status !== CloneOperationStatus.PROCESSING
    ) {
      throw new Error(`Application data clone returned unexpected status ${operation.status}.`);
    }
    await delay(pollInterval);
  }

  throw new Error(`Application data clone timed out after ${Math.round(timeout / 1_000)} seconds.`);
}

/**
 * Load generated JSONL seed rows for the types in a baseline snapshot.
 * @param dataDir - Directory containing `<Type>.jsonl` files
 * @param typeNames - Baseline type names to load
 * @returns Seed rows keyed by type name
 */
export function loadSnapshotSeedData(dataDir: string, typeNames: string[]): SeedData {
  const data: SeedData = {};
  for (const typeName of typeNames) {
    const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
    let content: string;
    try {
      content = fs.readFileSync(jsonlPath, "utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        data[typeName] = [];
        continue;
      }
      throw error;
    }
    data[typeName] = content
      ? content.split("\n").map((line, index) => {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch (error) {
            throw new Error(
              `Invalid JSON in ${jsonlPath} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(
              `Invalid seed row in ${jsonlPath} at line ${index + 1}: expected a JSON object`,
            );
          }
          return value as JsonObject;
        })
      : [];
  }
  return data;
}

/**
 * Derive insertion order and self-referencing types from a baseline snapshot.
 * @param snapshot - Baseline schema snapshot
 * @returns Dependency-ordered type names and self-referencing types
 */
export function sortSeedTypesForSnapshot(snapshot: NormalizedSchemaSnapshot): {
  order: string[];
  selfRefTypes: string[];
} {
  const typeNames = Object.keys(snapshot.types);
  const available = new Set(typeNames);
  const dependencies = new Map<string, string[]>();
  const selfRefTypes: string[] = [];
  for (const [typeName, type] of Object.entries(snapshot.types)) {
    const referenced = new Set<string>();
    for (const field of Object.values(type.fields)) {
      const target = field.foreignKeyType;
      if (!target) continue;
      if (target === typeName) {
        selfRefTypes.push(typeName);
      } else if (available.has(target)) {
        referenced.add(target);
      }
    }
    dependencies.set(typeName, [...referenced]);
  }

  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (typeName: string): void => {
    if (visited.has(typeName)) return;
    visited.add(typeName);
    for (const dependency of dependencies.get(typeName) ?? []) {
      visit(dependency);
    }
    order.push(typeName);
  };
  for (const typeName of typeNames) {
    visit(typeName);
  }
  return { order, selfRefTypes };
}

function temporaryWorkspaceName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `migration-test-${timestamp}-${randomBytes(3).toString("hex")}`;
}

function stateOrThrow(state: RuntimeState | undefined): RuntimeState {
  return assertDefined(state, "migration test runtime was used before preparation");
}

function migrationConfig(
  loaded: LoadedApplicationNamespaces,
  namespace: string,
): TailorDBServiceConfig["migration"] {
  return (loaded.config.db?.[namespace] as TailorDBServiceConfig | undefined)?.migration;
}

function authExecutionContext(
  state: RuntimeState,
  namespace: string,
  explicitMachineUser?: string,
): { authNamespace: string; machineUserName: string } {
  const auth = state.loaded.application.authService;
  if (!auth) {
    throw new Error("Auth configuration is required to execute migration test scripts.");
  }
  const machineUserName =
    explicitMachineUser ??
    getMigrationMachineUser(
      migrationConfig(state.loaded, namespace),
      auth.config.machineUsers ? Object.keys(auth.config.machineUsers) : undefined,
    );
  if (!machineUserName) {
    throw new Error(
      `No machine user is available for namespace "${namespace}". Pass --machine-user or configure one in auth or db.${namespace}.migration.`,
    );
  }
  return { authNamespace: auth.config.name, machineUserName };
}

async function prepareMigrationTest(options: MigrationTestOptions): Promise<{
  state: RuntimeState;
  prepared: PreparedMigrationTest;
}> {
  const loaded = await loadApplicationNamespaces({ configPath: options.configPath });
  const configDir = path.dirname(loaded.config.path);
  const namespaces = getNamespacesWithMigrations(loaded.config, configDir);
  if (namespaces.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found.");
  }
  for (const namespace of namespaces) {
    assertValidMigrationFiles(namespace.migrationsDir, namespace.namespace);
  }

  let seedContext: SeedContext | undefined;
  if (options.data === "seed") {
    seedContext = await loadSeedContext({ configPath: loaded.config.path });
    assertSeedDataDirectory(path.join(seedContext.distPath, "data"));
  }
  if (options.assertionPath) {
    assertAssertionScript(options.assertionPath);
  }

  const inputs = loaded.application.tailorDBServices.map(toTailorDBDeployInput);
  const accessToken = await loadAccessToken({ profile: options.profile });
  const platformConfig = await loadPlatformClientConfig({ profile: options.profile });
  const client = await initOperatorClient(accessToken, platformConfig);
  const sourceWorkspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
  if (options.targetWorkspaceId === sourceWorkspaceId) {
    throw new Error("The migration test target workspace must differ from the source workspace.");
  }

  const [workspaceResponse, applicationResponse] = await Promise.all([
    client.getWorkspace({ workspaceId: sourceWorkspaceId }),
    client.getApplication({
      workspaceId: sourceWorkspaceId,
      applicationName: loaded.config.name,
    }),
  ]);
  const sourceWorkspace = assertDefined(
    workspaceResponse.workspace,
    `source workspace "${sourceWorkspaceId}" not found`,
  );
  assertDefined(
    applicationResponse.application,
    `application "${loaded.config.name}" not found in source workspace`,
  );

  const remoteChecks = await verifyRemoteSchema(
    client,
    sourceWorkspaceId,
    namespaces,
    loaded.config,
    inputs,
  );
  const invalidRemote = remoteChecks.find(
    (check) => check.hasDrift || check.checkpointMissingLocal,
  );
  if (invalidRemote) {
    throw new Error(
      `Source namespace "${invalidRemote.namespace}" does not match its migration checkpoint. Run 'tailor tailordb migration validate' first.`,
    );
  }

  const baselines = new Map<
    string,
    { migrationNumber: number; snapshot: NormalizedSchemaSnapshot }
  >();
  const targetSnapshots = new Map<string, NormalizedSchemaSnapshot>();
  const pendingNamespaces: string[] = [];
  for (const namespace of namespaces) {
    const migrationNumber = await fetchRemoteMigrationNumber(
      client,
      resourceTrn(sourceWorkspaceId, "tailordb", namespace.namespace),
    );
    if (migrationNumber === null) {
      throw new Error(
        `Source namespace "${namespace.namespace}" has no sdk-migration checkpoint. Deploy or set its migration checkpoint before testing.`,
      );
    }
    const latest = getLatestMigrationNumber(namespace.migrationsDir);
    if (migrationNumber > latest) {
      throw new Error(
        `Source namespace "${namespace.namespace}" is at migration ${migrationNumber}, but the local history ends at ${latest}.`,
      );
    }
    const snapshot = reconstructSnapshotFromMigrations(namespace.migrationsDir, migrationNumber);
    if (!snapshot) {
      throw new Error(
        `No migration baseline snapshot found for namespace "${namespace.namespace}".`,
      );
    }
    baselines.set(namespace.namespace, { migrationNumber, snapshot });
    const targetSnapshot = reconstructSnapshotFromMigrations(namespace.migrationsDir, latest);
    if (!targetSnapshot) {
      throw new Error(`No target migration snapshot found for namespace "${namespace.namespace}".`);
    }
    targetSnapshots.set(namespace.namespace, targetSnapshot);
    if (migrationNumber < latest) {
      pendingNamespaces.push(namespace.namespace);
    }
  }
  if (pendingNamespaces.length === 0) {
    throw new Error("No pending TailorDB migrations found in the source workspace.");
  }

  const prepared: PreparedMigrationTest = {
    sourceWorkspaceId,
    sourceApplicationName: loaded.config.name,
    temporaryWorkspace: {
      name: temporaryWorkspaceName(),
      region: sourceWorkspace.region,
      ...(sourceWorkspace.organizationId ? { organizationId: sourceWorkspace.organizationId } : {}),
      ...(sourceWorkspace.folderId ? { folderId: sourceWorkspace.folderId } : {}),
    },
    baselines,
    targetSnapshots,
    pendingNamespaces,
  };
  return {
    state: { client, loaded, options, ...(seedContext ? { seedContext } : {}) },
    prepared,
  };
}

/**
 * Create the platform operations used by `tailordb migration test`.
 * @returns Migration test dependencies backed by the Operator API
 */
export function createMigrationTestDependencies(): MigrationTestDependencies {
  let runtimeState: RuntimeState | undefined;
  return {
    prepare: async (options) => {
      const { state, prepared } = await prepareMigrationTest(options);
      runtimeState = state;
      return prepared;
    },
    createWorkspace: async (prepared) => {
      const state = stateOrThrow(runtimeState);
      const workspace = await createValidatedWorkspaceWithClient(
        state.client,
        prepared.temporaryWorkspace,
      );
      logger.info(`Created temporary workspace ${workspace.name} (${workspace.id}).`);
      return { id: workspace.id, name: workspace.name };
    },
    deployBaseline: async ({ prepared, targetWorkspaceId }) => {
      const state = stateOrThrow(runtimeState);
      await deployMigrationTestBaseline(
        {
          configPath: state.loaded.config.path,
          profile: state.options.profile,
          workspaceId: targetWorkspaceId,
          yes: true,
        },
        prepared.baselines,
      );
    },
    seedData: async ({ prepared, targetWorkspaceId }) => {
      const state = stateOrThrow(runtimeState);
      const seedContext = assertDefined(
        state.seedContext,
        "seed context missing after migration test preparation",
      );
      const dataDir = path.join(seedContext.distPath, "data");
      assertSeedDataDirectory(dataDir);
      const seedSnapshots = new Map(
        state.loaded.application.tailorDBServices.map((service) => {
          const baseline = prepared.baselines.get(service.namespace);
          const input = toTailorDBDeployInput(service);
          return [
            service.namespace,
            baseline?.snapshot ??
              normalizeSchemaSnapshot({
                version: 1,
                namespace: service.namespace,
                createdAt: new Date().toISOString(),
                types: input.types,
              }),
          ] as const;
        }),
      );
      for (const [namespace, snapshot] of seedSnapshots) {
        const { order, selfRefTypes } = sortSeedTypesForSnapshot(snapshot);
        const data = loadSnapshotSeedData(dataDir, order);
        const typesWithData = order.filter((typeName) => (data[typeName]?.length ?? 0) > 0);
        if (typesWithData.length === 0) continue;
        const bundled = await bundleSeedScript(
          namespace,
          typesWithData,
          path.dirname(state.loaded.config.path),
        );
        const chunks = chunkSeedData({
          data,
          order,
          codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
        });
        const auth = authExecutionContext(
          state,
          namespace,
          state.options.machineUser ?? seedContext.machineUserName,
        );
        for (const chunk of chunks) {
          const execution = await executeScript({
            client: state.client,
            workspaceId: targetWorkspaceId,
            name: `migration-test-seed-${namespace}.ts`,
            code: bundled.bundledCode,
            arg: { data: chunk.data, order: chunk.order, selfRefTypes, upsert: false },
            invoker: {
              namespace: auth.authNamespace,
              machineUserName: auth.machineUserName,
            },
          });
          if (!execution.success) {
            throw new Error(
              execution.error ?? `Seed execution failed for namespace "${namespace}".`,
            );
          }
          const result = JSON.parse(execution.result || "{}") as { success?: boolean };
          if (result.success !== true) {
            throw new Error(`Seed execution reported failure for namespace "${namespace}".`);
          }
        }
      }
    },
    cloneData: async ({ sourceWorkspaceId, targetWorkspaceId, applicationName }) => {
      const state = stateOrThrow(runtimeState);
      logger.warn(
        "Clone mode copies TailorDB records only; IdP users and file blobs are not copied.",
      );
      let operationId: string;
      try {
        const response = await state.client.cloneApplicationData({
          sourceWorkspaceId,
          sourceApplicationName: applicationName,
          targetWorkspaceId,
          targetApplicationName: applicationName,
        });
        operationId = response.operationId;
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Unimplemented) {
          throw new Error(
            "Application data clone is not enabled for this platform. Retry with '--data seed'.",
            { cause: error },
          );
        }
        throw error;
      }
      if (!operationId) {
        throw new Error("Application data clone returned no operation ID.");
      }
      await waitForCloneApplicationData(state.client, {
        sourceWorkspaceId,
        targetWorkspaceId,
        operationId,
      });
    },
    deployMigrations: async ({ prepared, targetWorkspaceId }) => {
      const state = stateOrThrow(runtimeState);
      await deployMigrationTestTarget(
        {
          configPath: state.loaded.config.path,
          profile: state.options.profile,
          workspaceId: targetWorkspaceId,
          yes: true,
        },
        prepared.targetSnapshots,
      );
    },
    runAssertion: async ({
      prepared,
      targetWorkspaceId,
      assertionPath,
      assertionNamespace,
      machineUser,
    }) => {
      const state = stateOrThrow(runtimeState);
      const namespace =
        assertionNamespace ??
        (prepared.pendingNamespaces.length === 1 ? prepared.pendingNamespaces[0] : undefined);
      if (!namespace) {
        throw new Error(
          "--assert-namespace is required when pending migrations span multiple namespaces.",
        );
      }
      if (!prepared.baselines.has(namespace)) {
        throw new Error(`Assertion namespace "${namespace}" is not configured for migrations.`);
      }
      const auth = authExecutionContext(state, namespace, machineUser);
      const bundled = await bundleMigrationScript(
        assertionPath,
        namespace,
        0,
        state.loaded.config.env ?? {},
        path.dirname(state.loaded.config.path),
      );
      const execution = await executeScript({
        client: state.client,
        workspaceId: targetWorkspaceId,
        name: `migration-test-assert-${namespace}.ts`,
        code: bundled.bundledCode,
        invoker: {
          namespace: auth.authNamespace,
          machineUserName: auth.machineUserName,
        },
      });
      if (!execution.success) {
        throw new Error(
          execution.error ?? `Migration assertion failed for namespace "${namespace}".`,
        );
      }
    },
    deleteWorkspace: async (workspaceId) => {
      const state = stateOrThrow(runtimeState);
      await state.client.deleteWorkspace({ workspaceId });
    },
  };
}
