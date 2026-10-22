import {
  arg,
  buildOptionsOf,
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
import { assertSeedDataDirectory } from "./jsonl";
import { readRetryLabels } from "./retry-labels";
import {
  buildNamespaceSeedPlan,
  createSeedExecution,
  prepareNamespaceSeed,
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

    const namespaces = args.namespace
      ? context.namespaces.filter((ns) => ns.namespace === args.namespace)
      : context.namespaces;
    if (args.namespace && namespaces.length === 0) {
      throw new Error(`"${args.namespace}" is not a TailorDB namespace of this config.`);
    }

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
            "Run `tailor seed apply` again, which removes the leftover workflow before it seeds.",
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

    const dataDir = path.join(context.distPath, "data");
    assertSeedDataDirectory(dataDir);
    const dataDirs = [...(args["no-base"] ? [] : [dataDir]), ...datasets.dirs];
    const plan = buildNamespaceSeedPlan({
      nsConfig,
      typesToSeed: nsConfig.types,
      dataDirs,
      upsert: record.upsert,
    });
    const prepared = await prepareNamespaceSeed({
      plan,
      upsert: record.upsert,
      configDir: path.dirname(context.config.path),
      buildOptions: buildOptionsOf(context.config),
    });
    if (
      !prepared ||
      prepared.hash !== record.hash ||
      prepared.chunkArgs.length !== record.total ||
      record.chunkIndex >= prepared.chunkArgs.length
    ) {
      throw CLIError({
        code: "SEED_RETRY_DATA_CHANGED",
        message: `The seed data of namespace '${namespace}' differs from the run that failed, so its chunks are not the same.`,
        suggestion:
          "Pass the same --dataset, --all-datasets and --no-base flags as the failed `tailor seed apply` and keep the seed data as it was, or run `tailor seed apply` again.",
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
          prepared,
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
