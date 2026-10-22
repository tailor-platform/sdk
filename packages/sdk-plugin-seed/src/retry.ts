import {
  arg,
  CLIError,
  defineAppCommand,
  deploymentArgs,
  inspectScriptWorkflow,
  loadSeedContext,
  logger,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import {
  allDatasetsArg,
  assertDatasetSelection,
  datasetArg,
  noBaseArg,
  selectDatasets,
} from "./datasets";
import { selectEntities } from "./entities";
import { assertSeedDataDirectory } from "./jsonl";
import { readRetryLabels } from "./retry-labels";
import {
  buildNamespaceChunks,
  buildNamespaceSeedPlan,
  createSeedExecution,
  runSeedChunks,
  withKeptTailorDBSeedWorkflow,
} from "./seed-tailordb";
import { seedWorkflowName } from "./workflow-name";
import type { RetryRecord } from "./retry-labels";
import type { SeedNamespaceConfig } from "@tailor-platform/sdk/cli";

interface KeptNamespace {
  nsConfig: SeedNamespaceConfig;
  workflowId: string;
  activeExecutionId: string | undefined;
  latestExecutionId: string | undefined;
  /** Undefined when the kept workflow holds no complete record of a failed chunk */
  record: RetryRecord | undefined;
}

export const seedRetryCommand = defineAppCommand({
  name: "retry",
  description:
    "Retry the TailorDB seed chunk that failed in the last `tailor seed apply`, then run the chunks after it.",
  args: z.strictObject({
    ...deploymentArgs,
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication (required unless machineUserName is configured in seedPlugin options)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Retry only the failure of the specified TailorDB namespace",
    }),
    ...datasetArg,
    ...allDatasetsArg,
    ...noBaseArg,
    entities: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Table names the failed `tailor seed apply` was limited to (default: all)",
    }),
  }),
  run: async (args) => {
    assertDatasetSelection(args.dataset, args["all-datasets"]);
    if (args["no-base"] && args.dataset.length === 0 && !args["all-datasets"]) {
      throw new Error("--no-base needs at least one --dataset or --all-datasets to retry.");
    }
    const context = await loadSeedContext({ configPath: args.config });
    const datasets = selectDatasets(context, args.dataset, args["all-datasets"]);

    const machineUserName = args["machine-user"] ?? context.machineUserName;
    if (!machineUserName) {
      throw new Error(
        "Machine user name is required. " +
          "Specify --machine-user <name> or configure machineUserName in seedPlugin options.",
      );
    }

    if (args.namespace && !context.namespaces.some((ns) => ns.namespace === args.namespace)) {
      throw new Error(`"${args.namespace}" is not a TailorDB namespace of this config.`);
    }
    const selection = selectEntities({
      namespaceTables: Object.fromEntries(context.namespaces.map((ns) => [ns.namespace, ns.types])),
      hasIdpUser: false,
      entities: args.entities,
      skipIdp: false,
    });
    const typesToSeedOf = (nsConfig: SeedNamespaceConfig) =>
      selection.entitiesToProcess
        ? nsConfig.types.filter((type) => selection.entitiesToProcess?.includes(type))
        : nsConfig.types;
    const namespaces = context.namespaces.filter(
      (ns) => (!args.namespace || ns.namespace === args.namespace) && typesToSeedOf(ns).length > 0,
    );

    const execution = await createSeedExecution({
      configPath: args.config,
      profile: args.profile,
      workspaceId: args["workspace-id"],
      machineUserName,
    });

    const kept: KeptNamespace[] = [];
    for (const nsConfig of namespaces) {
      const found = await inspectScriptWorkflow({
        client: execution.operatorClient,
        workspaceId: execution.workspaceId,
        name: seedWorkflowName("tailordb", nsConfig.namespace),
      });
      if (found) {
        kept.push({
          nsConfig,
          workflowId: found.workflowId,
          activeExecutionId: found.activeExecutionId,
          latestExecutionId: found.latestExecutionId,
          record: readRetryLabels(found.labels),
        });
      }
    }

    const failed = kept
      .filter((entry): entry is KeptNamespace & { record: RetryRecord } => !!entry.record)
      .toSorted((a, b) => b.record.failedAt - a.record.failedAt);
    const target = failed[0];
    if (!target) {
      const unrecorded = kept[0];
      if (unrecorded) {
        throw CLIError({
          code: "SEED_RETRY_NOT_RECORDED",
          message: `The temporary seed workflow of namespace '${unrecorded.nsConfig.namespace}' holds no record of a failed chunk.`,
          suggestion:
            "Wait for any seed that is still running, then check the data in the database. " +
            "Run `tailor seed apply --upsert` to seed again; its rows need the same ids as the rows that exist.",
          context: { namespace: unrecorded.nsConfig.namespace },
        });
      }
      throw CLIError({
        code: "SEED_RETRY_NOTHING_TO_RETRY",
        message: "There is no failed seed to retry.",
        suggestion: "Run `tailor seed apply` to seed the data.",
      });
    }
    const { nsConfig, record } = target;
    const { namespace } = nsConfig;
    for (const other of failed.slice(1)) {
      logger.info(
        `A failed seed of namespace '${other.nsConfig.namespace}' is kept as well; run \`tailor seed retry --namespace ${other.nsConfig.namespace}\` after this one.`,
      );
    }

    if (target.activeExecutionId) {
      throw CLIError({
        code: "SEED_RETRY_EXECUTION_ACTIVE",
        message: `The seed of namespace '${namespace}' has an execution that is still running (${target.activeExecutionId}).`,
        suggestion: "Wait for it to finish, then run `tailor seed retry` again.",
        context: { namespace, executionId: target.activeExecutionId },
      });
    }

    if (target.latestExecutionId !== record.executionId) {
      throw CLIError({
        code: "SEED_RETRY_INTERRUPTED",
        message: `The seed of namespace '${namespace}' ran again after the chunk failed, and it is not known whether that run applied the chunk.`,
        suggestion:
          "Check the data in the database, then run `tailor seed apply --upsert` to seed again.",
        context: { namespace, failedChunk: record.chunkIndex + 1, totalChunks: record.total },
      });
    }

    const dataDir = path.join(context.distPath, "data");
    assertSeedDataDirectory(dataDir);
    const dataDirs = [...(args["no-base"] ? [] : [dataDir]), ...datasets.dirs];
    const plan = buildNamespaceSeedPlan({
      nsConfig,
      typesToSeed: typesToSeedOf(nsConfig),
      dataDirs,
      upsert: record.upsert,
    });
    const built = buildNamespaceChunks({ plan, upsert: record.upsert });
    if (
      !built ||
      built.hash !== record.hash ||
      built.chunks.length !== record.total ||
      record.chunkIndex >= built.chunks.length
    ) {
      throw CLIError({
        code: "SEED_RETRY_DATA_CHANGED",
        message: `The seed data of namespace '${namespace}' differs from the run that failed, so its chunks are not the same.`,
        suggestion:
          "Pass the same table names and the same --dataset, --all-datasets and --no-base as the failed `tailor seed apply` and keep the seed data as it was. " +
          "If the data has to change, check which chunks the failed run applied, then run `tailor seed apply --upsert` (its rows need the same ids as the rows that exist) or truncate the tables first.",
        context: { namespace, failedChunk: record.chunkIndex + 1, totalChunks: record.total },
      });
    }

    logger.info(
      `  [${namespace}] Retrying from chunk ${record.chunkIndex + 1}/${record.total}...`,
      { mode: "plain" },
    );
    const processedTotals: Record<string, number> = {};
    const success = await withKeptTailorDBSeedWorkflow(
      { execution, namespace, workflowId: target.workflowId },
      (run, { retain }) =>
        runSeedChunks({
          built,
          upsert: record.upsert,
          startIndex: record.chunkIndex,
          run,
          retain,
          processedTotals,
        }),
    );

    logger.newline();
    if (args.json) {
      logger.out({ success, processed: processedTotals });
    }
    if (!success) {
      throw new Error("Seed retry completed with errors");
    }
    logger.success("Seed retry completed successfully");
  },
});
