import {
  bundleSeedScript,
  chunkSeedData,
  initOperatorClient,
  loadAccessToken,
  loadWorkspaceId,
  logger,
  show,
  styles,
  withKeptScriptWorkflow,
  withScriptWorkflow,
} from "@tailor-platform/sdk/cli";
import { parseExecutionResult } from "./execution-result";
import { loadSeedData } from "./jsonl";
import { hashChunkArgs, toRetryLabels } from "./retry-labels";
import { sortRecordsBySelfReference, topologicalSort } from "./topo-sort";
import { seedWorkflowName } from "./workflow-name";
import type {
  OperatorClient,
  RetainControls,
  RunScript,
  SeedBundleBuildOptions,
  SeedData,
  SeedNamespaceConfig,
  UseScriptWorkflow,
} from "@tailor-platform/sdk/cli";

export interface SeedExecutionContext {
  operatorClient: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
  appName: string;
}

interface CreateSeedExecutionParams {
  configPath: string | undefined;
  profile: string | undefined;
  workspaceId: string | undefined;
  machineUserName: string;
}

/**
 * Connect to the workspace and the application's auth namespace a seed run uses.
 * @param params - Where the run connects and as whom
 * @returns Client and identifiers for the run
 */
export async function createSeedExecution(
  params: CreateSeedExecutionParams,
): Promise<SeedExecutionContext> {
  const { configPath, profile, workspaceId, machineUserName } = params;
  const appInfo = await show({ configPath, profile, workspaceId });
  return {
    operatorClient: await initOperatorClient(await loadAccessToken({ profile })),
    workspaceId: await loadWorkspaceId({ workspaceId, profile }),
    authNamespace: appInfo.auth,
    machineUserName,
    appName: appInfo.name,
  };
}

const APPLY_LEFTOVER_NOTE = "It is removed by the next `tailor seed apply` for this namespace.";

function invokerOf(execution: SeedExecutionContext) {
  return {
    namespace: execution.authNamespace,
    machineUserName: execution.machineUserName,
  };
}

interface SeedWorkflowParams {
  execution: SeedExecutionContext;
  /** What the script seeds, e.g. `tailordb` or `idp-seed`. */
  kind: string;
  namespace: string;
  description: string;
  code: string;
}

/**
 * Run a seed script as a temporary workflow named `tailor-seed-<kind>--<namespace>`.
 * @param params - Script and the namespace it seeds
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export function withSeedWorkflow<T>(
  params: SeedWorkflowParams,
  use: UseScriptWorkflow<T>,
): Promise<T> {
  const { execution, kind, namespace, description, code } = params;
  return withScriptWorkflow(
    {
      client: execution.operatorClient,
      workspaceId: execution.workspaceId,
      name: seedWorkflowName(kind, namespace),
      description,
      code,
      invoker: invokerOf(execution),
      appName: execution.appName,
      leftoverNote: APPLY_LEFTOVER_NOTE,
    },
    use,
  );
}

interface KeptSeedWorkflowParams {
  execution: SeedExecutionContext;
  namespace: string;
  workflowId: string;
}

/**
 * Take up the TailorDB seed workflow of a namespace that a failed run kept.
 * @param params - The kept workflow and the namespace it seeds
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export function withKeptTailorDBSeedWorkflow<T>(
  params: KeptSeedWorkflowParams,
  use: UseScriptWorkflow<T>,
): Promise<T> {
  const { execution, namespace, workflowId } = params;
  return withKeptScriptWorkflow(
    {
      client: execution.operatorClient,
      workspaceId: execution.workspaceId,
      name: seedWorkflowName("tailordb", namespace),
      workflowId,
      invoker: invokerOf(execution),
      leftoverNote: APPLY_LEFTOVER_NOTE,
    },
    use,
  );
}

export interface NamespaceSeedPlan {
  namespace: string;
  sortedTypes: string[];
  data: SeedData;
  selfRefTypes: string[];
  selfRefFields: Record<string, string[]>;
  selfRefKeys: Record<string, Record<string, string>>;
}

interface NamespaceSeedPlanParams {
  nsConfig: SeedNamespaceConfig;
  typesToSeed: string[];
  dataDirs: string[];
  upsert: boolean;
}

export function createChunkProgressLogger(
  total: number,
  indent = "    ",
): (index: number, details: string) => void {
  if (total > 1) {
    logger.log(styles.dim(`${indent}Split into ${total} chunks`));
  }
  return (index, details) => {
    if (total > 1) {
      logger.log(styles.dim(`${indent}Chunk ${index + 1}/${total}: ${details}`));
    }
  };
}

export function buildNamespaceSeedPlan(params: NamespaceSeedPlanParams): NamespaceSeedPlan {
  const { nsConfig, typesToSeed, dataDirs, upsert } = params;
  const selfRefFields = nsConfig.selfRefFields ?? {};
  const selfRefKeys = nsConfig.selfRefKeys ?? {};
  const sortedTypes = topologicalSort(typesToSeed, nsConfig.dependencies);
  const data = loadSeedData(dataDirs, sortedTypes, {
    requireId: upsert,
    requiredFieldsByType: upsert ? nsConfig.requiredFields : {},
  });
  // Sort each self-referencing table's full record set before chunkSeedData
  // splits it by byte size, so a table split across script executions still
  // has its parents in the same or an earlier chunk than their children.
  for (const type of nsConfig.selfRefTypes) {
    const fields = selfRefFields[type];
    const records = data[type];
    if (records && fields && fields.length > 0) {
      data[type] = sortRecordsBySelfReference(records, fields, selfRefKeys[type]);
    }
  }
  return {
    namespace: nsConfig.namespace,
    sortedTypes,
    data,
    selfRefTypes: nsConfig.selfRefTypes,
    selfRefFields,
    selfRefKeys,
  };
}

export interface SeedResult {
  success: boolean;
  processed: Record<string, number>;
}

type ChunkArg = Parameters<RunScript>[0];

export interface NamespaceChunks {
  namespace: string;
  /** Tables that have data, in dependency order */
  tables: string[];
  /** Every chunk, in the order they run */
  chunks: { arg: ChunkArg; tables: string[] }[];
  /** Fingerprint of the argument of every chunk */
  hash: string;
}

interface BuildNamespaceChunksParams {
  plan: NamespaceSeedPlan;
  upsert: boolean;
}

/**
 * Split the data of a namespace into the chunks that run.
 * @param params - Plan of the namespace
 * @returns The chunks; undefined when the namespace has no data
 */
export function buildNamespaceChunks(
  params: BuildNamespaceChunksParams,
): NamespaceChunks | undefined {
  const { plan, upsert } = params;
  const { namespace, sortedTypes, data, selfRefTypes, selfRefFields, selfRefKeys } = plan;

  const tables = sortedTypes.filter((type) => data[type] && data[type].length > 0);
  if (tables.length === 0) return undefined;

  const split = chunkSeedData({ data, order: sortedTypes });
  if (split.length === 0) return undefined;

  const chunks = split.map((chunk) => ({
    arg: {
      data: chunk.data,
      order: chunk.order,
      selfRefTypes,
      selfRefFields,
      selfRefKeys,
      upsert,
    },
    tables: chunk.order,
  }));
  return { namespace, tables, chunks, hash: hashChunkArgs(chunks.map((chunk) => chunk.arg)) };
}

interface RunSeedChunksParams {
  built: NamespaceChunks;
  upsert: boolean;
  /** Index of the first chunk to run */
  startIndex: number;
  run: RunScript;
  retain: RetainControls["retain"];
  /** Rows confirmed so far per table, added to as chunks finish */
  processedTotals: Record<string, number>;
}

/**
 * Run the chunks one after another from `startIndex`, and stop at the first one that
 * fails, keeping the workflow with a record of where it stopped.
 * @param params - Chunks to run and where to start
 * @returns Whether every chunk from `startIndex` succeeded
 */
export async function runSeedChunks(params: RunSeedChunksParams): Promise<boolean> {
  const { built, upsert, startIndex, run, retain, processedTotals } = params;
  const total = built.chunks.length;
  const logChunkProgress = createChunkProgressLogger(total);

  for (const [index, chunk] of built.chunks.entries()) {
    if (index < startIndex) continue;
    logChunkProgress(index, chunk.tables.join(", "));

    const result = await run(chunk.arg);

    const { success, parsed, errors } = parseExecutionResult(result, "    ");
    const processed = (parsed.processed ?? {}) as Record<
      string,
      { inserted: number; updated: number; skipped: number }
    >;
    for (const [type, counts] of Object.entries(processed)) {
      processedTotals[type] = (processedTotals[type] ?? 0) + counts.inserted + counts.updated;
      const skippedSuffix = counts.skipped > 0 ? `, ${counts.skipped} skipped` : "";
      const message = upsert
        ? `${counts.inserted} inserted, ${counts.updated} updated${skippedSuffix}`
        : `${counts.inserted} rows inserted`;
      logger.log(styles.success(`    ✓ ${type}: ${message}`));
    }
    if (!success) {
      logger.error(`  Seed failed:\n      ${errors.join("\n      ")}`, { mode: "plain" });
      retain(
        toRetryLabels({
          chunkIndex: index,
          total,
          hash: built.hash,
          upsert,
          failedAt: Math.floor(Date.now() / 1000),
        }),
      );
      return false;
    }
  }
  return true;
}

interface SeedNamespaceParams {
  execution: SeedExecutionContext;
  plan: NamespaceSeedPlan;
  upsert: boolean;
  configDir: string;
  buildOptions: SeedBundleBuildOptions;
}

export async function seedNamespace(params: SeedNamespaceParams): Promise<SeedResult> {
  const { execution, plan, upsert, configDir, buildOptions } = params;
  const { namespace } = plan;
  const processedTotals: Record<string, number> = {};

  const built = buildNamespaceChunks({ plan, upsert });
  if (!built) {
    logger.log(styles.dim(`  [${namespace}] No data to seed`));
    return { success: true, processed: processedTotals };
  }

  logger.info(
    `  [${namespace}] Seeding ${built.tables.length} tables via Kysely batch ${upsert ? "upsert" : "insert"}...`,
    { mode: "plain" },
  );

  const bundled = await bundleSeedScript(namespace, built.tables, configDir, buildOptions);
  const success = await withSeedWorkflow(
    {
      execution,
      kind: "tailordb",
      namespace,
      description: `Temporary function for seeding TailorDB namespace ${namespace}`,
      code: bundled.bundledCode,
    },
    (run, { retain }) =>
      runSeedChunks({ built, upsert, startIndex: 0, run, retain, processedTotals }),
  );
  return { success, processed: processedTotals };
}
