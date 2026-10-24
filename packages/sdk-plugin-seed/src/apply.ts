import { createInterface } from "node:readline";
import {
  buildOptionsOf,
  bundleSeedScript,
  chunkSeedData,
  initOperatorClient,
  loadAccessToken,
  loadSeedContext,
  loadWorkspaceId,
  show,
  truncate,
  withScriptWorkflow,
  deploymentArgs,
  defineAppCommand,
  logger,
  styles,
  arg,
} from "@tailor-platform/sdk/cli";
import { renderFor } from "@tailor-platform/shared/color";
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
import { parseExecutionResult } from "./execution-result";
import { assertSeedDataDirectory, loadSeedData } from "./jsonl";
import { sortRecordsBySelfReference, topologicalSort } from "./topo-sort";
import { seedWorkflowName } from "./workflow-name";
import type {
  OperatorClient,
  RunScript,
  SeedBundleBuildOptions,
  SeedData,
  SeedIdpUserContext,
  SeedNamespaceConfig,
} from "@tailor-platform/sdk/cli";

interface SeedExecutionContext {
  operatorClient: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
  appName: string;
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
function withSeedWorkflow<T>(
  params: SeedWorkflowParams,
  use: (run: RunScript) => Promise<T>,
): Promise<T> {
  const { execution, kind, namespace, description, code } = params;
  return withScriptWorkflow(
    {
      client: execution.operatorClient,
      workspaceId: execution.workspaceId,
      name: seedWorkflowName(kind, namespace),
      description,
      code,
      invoker: {
        namespace: execution.authNamespace,
        machineUserName: execution.machineUserName,
      },
      appName: execution.appName,
      leftoverNote: "It is removed by the next `tailor seed apply` for this namespace.",
    },
    use,
  );
}

interface NamespaceSeedPlan {
  namespace: string;
  sortedTypes: string[];
  data: SeedData;
  selfRefTypes: string[];
  selfRefFields: Record<string, string[]>;
  selfRefKeys: Record<string, Record<string, string>>;
}

interface SeedNamespaceParams {
  execution: SeedExecutionContext;
  plan: NamespaceSeedPlan;
  upsert: boolean;
  configDir: string;
  buildOptions: SeedBundleBuildOptions;
}

interface NamespaceSeedPlanParams {
  nsConfig: SeedNamespaceConfig;
  typesToSeed: string[];
  dataDirs: string[];
  upsert: boolean;
}

function promptConfirmation(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    logger.warn("Interactive confirmation is not available; pass --yes to proceed.");
    return Promise.resolve(false);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(renderFor(process.stdout, styles.warning(question)), (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() === "y");
    });
  });
}

interface SeedResult {
  success: boolean;
  processed: Record<string, number>;
}

function createChunkProgressLogger(
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

function buildNamespaceSeedPlan(params: NamespaceSeedPlanParams): NamespaceSeedPlan {
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

async function seedNamespace(params: SeedNamespaceParams): Promise<SeedResult> {
  const { execution, plan, upsert, configDir, buildOptions } = params;
  const { namespace, sortedTypes, data, selfRefTypes, selfRefFields, selfRefKeys } = plan;
  const processedTotals: Record<string, number> = {};

  const typesWithData = sortedTypes.filter((type) => data[type] && data[type].length > 0);
  if (typesWithData.length === 0) {
    logger.log(styles.dim(`  [${namespace}] No data to seed`));
    return { success: true, processed: processedTotals };
  }

  logger.info(
    `  [${namespace}] Seeding ${typesWithData.length} tables via Kysely batch ${upsert ? "upsert" : "insert"}...`,
    { mode: "plain" },
  );

  const bundled = await bundleSeedScript(namespace, typesWithData, configDir, buildOptions);
  const chunks = chunkSeedData({ data, order: sortedTypes });

  if (chunks.length === 0) {
    logger.log(styles.dim(`  [${namespace}] No data to seed`));
    return { success: true, processed: processedTotals };
  }
  const logChunkProgress = createChunkProgressLogger(chunks.length);

  let success = true;
  await withSeedWorkflow(
    {
      execution,
      kind: "tailordb",
      namespace,
      description: `Temporary function for seeding TailorDB namespace ${namespace}`,
      code: bundled.bundledCode,
    },
    async (runScript) => {
      for (const chunk of chunks) {
        logChunkProgress(chunk.index, chunk.order.join(", "));

        const result = await runScript({
          data: chunk.data,
          order: chunk.order,
          selfRefTypes,
          selfRefFields,
          selfRefKeys,
          upsert,
        });

        const { success: chunkSuccess, parsed, errors } = parseExecutionResult(result, "    ");
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
        if (!chunkSuccess) {
          logger.error(`  Seed failed:\n      ${errors.join("\n      ")}`, {
            mode: "plain",
          });
          success = false;
          break;
        }
      }
    },
  );
  return { success, processed: processedTotals };
}

type IdpUserRef = { id: string; name: string };

interface IdpScriptRun {
  runScript: RunScript;
  arg: {
    users?: SeedData[string] | IdpUserRef[];
    upsert?: boolean;
    offset?: number;
    total?: number;
  };
  indent: string;
  reportSuccess?: (parsed: Record<string, unknown>) => void;
}

async function runIdpScript(
  params: IdpScriptRun,
): Promise<{ success: boolean; parsed: Record<string, unknown>; outcomeUnknown: boolean }> {
  const { runScript, arg, indent, reportSuccess } = params;

  const result = await runScript(arg);

  const { success, parsed, errors, outcomeUnknown } = parseExecutionResult(result, indent);
  reportSuccess?.(parsed);
  if (!success) {
    for (const error of errors) {
      logger.error(`${indent}${error}`, { mode: "plain" });
    }
  }
  return { success, parsed, outcomeUnknown };
}

// The generated IdP scripts upsert or delete users one call at a time (about a
// second or more per row), so each script execution must carry few enough rows
// to finish well within a workflow job's execution time limit, and to keep the
// rows an interrupted chunk may have applied few. Byte-size chunking cannot
// capture this.
const IDP_USER_CHUNK_SIZE = 25;

function chunkIdpUsers<T>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += IDP_USER_CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + IDP_USER_CHUNK_SIZE));
  }
  return chunks;
}

function readCount(result: Record<string, unknown>, key: string): number {
  const value = result[key];
  return typeof value === "number" ? value : 0;
}

interface SeedIdpUserParams {
  execution: SeedExecutionContext;
  idpNamespace: string;
  scriptCode: string;
  rows: SeedData[string];
  upsert: boolean;
}

async function hookIdpUserRows(
  schemaDir: string,
  rows: SeedData[string] | undefined,
): Promise<SeedData[string]> {
  const { hookSeedRows } = await import("@tailor-platform/sdk/seed");
  const source = rows ?? [];
  const hooked = (await hookSeedRows({
    schemaDir,
    table: "_User",
    rows: source,
  })) as SeedData[string];
  // A password the schema hook supplied (not one written in _User.jsonl) only applies when the
  // user is created, so --upsert does not reset the password of a user that already exists.
  return hooked.map((row, index) => {
    const written = source[index]?.password;
    if (written !== undefined && written !== null) return row;
    const { password, ...rest } = row;
    return password === undefined ? row : { ...rest, initialPassword: password };
  });
}

async function seedIdpUser(
  params: SeedIdpUserParams,
): Promise<{ success: boolean; processed: number; transportError?: unknown }> {
  const { execution, idpNamespace, scriptCode, rows, upsert } = params;
  logger.info("  Seeding _User via tailor.idp.Client...", { mode: "plain" });

  if (rows.length === 0) {
    logger.log(styles.dim("    No _User data to seed"));
    return { success: true, processed: 0 };
  }
  logger.log(styles.dim(`    Processing ${rows.length} _User records...`));

  const chunks = chunkIdpUsers(rows);
  const logChunkProgress = createChunkProgressLogger(chunks.length);

  const reportChunkCounts = (result: Record<string, unknown>) => {
    const created = readCount(result, "created");
    const updated = readCount(result, "updated");
    const skipped = readCount(result, "skipped");
    const processed = readCount(result, "processed");
    if (created === 0 && updated === 0 && skipped === 0) {
      return;
    }
    const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : "";
    const message = upsert
      ? `${created} created, ${updated} updated${skippedSuffix}`
      : `${processed} rows processed`;
    logger.log(styles.success(`    ✓ _User: ${message}`));
  };

  let success = true;
  const totals = { processed: 0, created: 0, updated: 0 };
  const warnInterruptedChunk = () => {
    logger.warn(
      `    _User: ${totals.processed}/${rows.length} rows confirmed processed before the failure ` +
        `(${totals.created} created, ${totals.updated} updated). ` +
        "The interrupted chunk may still have been applied server-side; " +
        "re-run the same command narrowed to `_User` with `--upsert` to retry safely.",
      { mode: "plain" },
    );
  };
  let interrupted: { transportError?: unknown } | undefined;
  try {
    interrupted = await withSeedWorkflow(
      {
        execution,
        kind: "idp-seed",
        namespace: idpNamespace,
        description: `Temporary function for seeding IdP namespace ${idpNamespace}`,
        code: scriptCode,
      },
      async (runScript) => {
        for (const [index, chunk] of chunks.entries()) {
          logChunkProgress(index, `${chunk.length} rows`);
          let run: { success: boolean; parsed: Record<string, unknown>; outcomeUnknown: boolean };
          try {
            run = await runIdpScript({
              runScript,
              arg: {
                users: chunk,
                upsert,
                offset: index * IDP_USER_CHUNK_SIZE,
                total: rows.length,
              },
              indent: "    ",
              reportSuccess: reportChunkCounts,
            });
          } catch (error) {
            warnInterruptedChunk();
            return { transportError: error };
          }
          if (run.outcomeUnknown) {
            warnInterruptedChunk();
            return {};
          }
          totals.processed += readCount(run.parsed, "processed");
          totals.created += readCount(run.parsed, "created");
          totals.updated += readCount(run.parsed, "updated");
          if (!run.success) {
            success = false;
          }
        }
        return undefined;
      },
    );
  } catch (error) {
    return { success: false, processed: totals.processed, transportError: error };
  }
  if (interrupted) {
    return { success: false, processed: totals.processed, ...interrupted };
  }
  return { success, processed: totals.processed };
}

function isIdpUserRef(user: unknown): user is IdpUserRef {
  return (
    typeof user === "object" &&
    user !== null &&
    typeof (user as { id?: unknown }).id === "string" &&
    typeof (user as { name?: unknown }).name === "string"
  );
}

function readListedUsers(parsed: Record<string, unknown>): IdpUserRef[] | undefined {
  if (!Array.isArray(parsed.users) || !parsed.users.every(isIdpUserRef)) {
    return undefined;
  }
  return parsed.users;
}

async function truncateIdpUser(
  execution: SeedExecutionContext,
  scripts: Pick<SeedIdpUserContext, "idpNamespace" | "listScriptCode" | "truncateScriptCode">,
): Promise<boolean> {
  logger.info("Truncating _User via tailor.idp.Client...", { mode: "plain" });

  // Only an older @tailor-platform/sdk omits the listing script.
  if (!scripts.listScriptCode) {
    throw new Error(
      "The installed @tailor-platform/sdk does not provide the IdP user listing script. " +
        "Update it to the version @tailor-platform/sdk-plugin-seed requires.",
    );
  }

  const listed = await withSeedWorkflow(
    {
      execution,
      kind: "idp-list",
      namespace: scripts.idpNamespace,
      description: `Temporary function for listing the users of IdP namespace ${scripts.idpNamespace}`,
      code: scripts.listScriptCode,
    },
    (runScript) => runIdpScript({ runScript, arg: {}, indent: "  " }),
  );
  if (!listed.success) {
    return false;
  }
  const users = readListedUsers(listed.parsed);
  if (!users) {
    logger.error("  list-idp-user.ts returned no user list.", { mode: "plain" });
    return false;
  }
  if (users.length === 0) {
    logger.log(styles.dim("  No _User records to delete"));
    return true;
  }
  logger.log(styles.dim(`  Deleting ${users.length} _User records...`));

  const chunks = chunkIdpUsers(users);
  const logChunkProgress = createChunkProgressLogger(chunks.length, "  ");

  let success = true;
  const totals = { deleted: 0, notFound: 0 };
  const warnInterruptedChunk = () => {
    const confirmed = totals.deleted + totals.notFound;
    logger.warn(
      `  _User: ${confirmed}/${users.length} users confirmed deleted before the failure ` +
        `(${totals.deleted} deleted, ${totals.notFound} already deleted). ` +
        "The interrupted chunk may still have been applied server-side; " +
        "re-run the same command to retry safely.",
      { mode: "plain" },
    );
  };
  const completed = await withSeedWorkflow(
    {
      execution,
      kind: "idp-truncate",
      namespace: scripts.idpNamespace,
      description: `Temporary function for deleting the users of IdP namespace ${scripts.idpNamespace}`,
      code: scripts.truncateScriptCode,
    },
    async (runScript) => {
      for (const [index, chunk] of chunks.entries()) {
        logChunkProgress(index, `${chunk.length} users`);
        let run: { success: boolean; parsed: Record<string, unknown>; outcomeUnknown: boolean };
        try {
          run = await runIdpScript({
            runScript,
            arg: { users: chunk, offset: index * IDP_USER_CHUNK_SIZE, total: users.length },
            indent: "  ",
          });
        } catch (error) {
          warnInterruptedChunk();
          throw error;
        }
        if (run.outcomeUnknown) {
          warnInterruptedChunk();
          return false;
        }
        totals.deleted += readCount(run.parsed, "deleted");
        totals.notFound += readCount(run.parsed, "notFound");
        if (!run.success) {
          success = false;
        }
      }
      return true;
    },
  );
  if (!completed) return false;
  const notFoundSuffix = totals.notFound > 0 ? `, ${totals.notFound} already deleted` : "";
  const summary = `${totals.deleted} users deleted${notFoundSuffix}`;
  if (success) {
    logger.log(styles.success(`  ✓ _User: ${summary}`));
  } else {
    const failed = users.length - totals.deleted - totals.notFound;
    logger.warn(`  _User: ${summary}, ${failed} failed; re-run the command to retry.`, {
      mode: "plain",
    });
  }
  return success;
}

export const seedApplyCommand = defineAppCommand({
  name: "apply",
  description: "Seed TailorDB (and IdP `_User`) data from generated JSONL files.",
  args: z.strictObject({
    ...deploymentArgs,
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication (required unless machineUserName is configured in seedPlugin options)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Seed all tables in the specified TailorDB namespace (excludes _User)",
    }),
    "skip-idp": arg(z.boolean().default(false), {
      description: "Skip the IdP user (_User) entity",
    }),
    truncate: arg(z.boolean().default(false), {
      description: "Truncate target tables before seeding",
    }),
    upsert: arg(z.boolean().default(false), {
      description: "Update existing rows instead of failing on duplicate ids",
    }),
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Skip confirmation prompts (for --truncate)",
    }),
    ...datasetArg,
    ...allDatasetsArg,
    ...noBaseArg,
    entities: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Entity names to seed, including _User (default: all)",
    }),
  }),
  run: async (args) => {
    assertDatasetSelection(args.dataset, args["all-datasets"]);
    if (args["no-base"] && args.dataset.length === 0 && !args["all-datasets"]) {
      throw new Error("--no-base needs at least one --dataset or --all-datasets to apply.");
    }
    const context = await loadSeedContext({ configPath: args.config });
    const datasets = selectDatasets(context, args.dataset, args["all-datasets"]);

    const namespaceTables = Object.fromEntries(
      context.namespaces.map((ns) => [ns.namespace, ns.types]),
    );
    const hasIdpUser = context.idpUser !== null;
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser,
      namespace: args.namespace,
      entities: args.entities,
      skipIdp: args["skip-idp"],
    });
    for (const warning of selection.warnings) {
      logger.warn(warning);
    }
    if (args.namespace) {
      logger.info(`Filtering by namespace: ${args.namespace}`);
      logger.log(styles.dim(`Entities: ${(selection.entitiesToProcess ?? []).join(", ")}`));
    } else if (args.entities.length > 0) {
      logger.info(`Filtering by entities: ${(selection.entitiesToProcess ?? []).join(", ")}`);
    }

    if (!selection.hasEntitiesToProcess) {
      if (args.json) {
        logger.out({ success: true, processed: {} });
      }
      logger.success("No seed targets found.");
      return;
    }

    const machineUserName = args["machine-user"] ?? context.machineUserName;
    if (!machineUserName) {
      throw new Error(
        "Machine user name is required. " +
          "Specify --machine-user <name> or configure machineUserName in seedPlugin options.",
      );
    }

    const dataDir = path.join(context.distPath, "data");
    assertSeedDataDirectory(dataDir);
    const dataDirs = [...(args["no-base"] ? [] : [dataDir]), ...datasets.dirs];
    if (datasets.names.length > 0) {
      logger.info(
        `Datasets: ${datasets.names.join(", ")}` +
          (args["no-base"] ? " (without the base seed data)" : ""),
      );
    }

    const namespacesToProcess = args.namespace
      ? [args.namespace]
      : context.namespaces.map((ns) => ns.namespace);
    const plans = namespacesToProcess.flatMap((namespace) => {
      const nsConfig = context.namespaces.find((ns) => ns.namespace === namespace);
      if (!nsConfig) return [];
      const typesToSeed = selection.entitiesToProcess
        ? nsConfig.types.filter((type) => selection.entitiesToProcess?.includes(type))
        : nsConfig.types;
      if (typesToSeed.length === 0) return [];
      return [buildNamespaceSeedPlan({ nsConfig, typesToSeed, dataDirs, upsert: args.upsert })];
    });
    const shouldSeedUser =
      hasIdpUser &&
      !args["skip-idp"] &&
      (!selection.entitiesToProcess || selection.entitiesToProcess.includes("_User"));
    const idpUserRows = shouldSeedUser
      ? await hookIdpUserRows(
          dataDir,
          loadSeedData(dataDirs, ["_User"], { keyField: "name" })._User,
        )
      : [];

    const appInfo = await show({
      configPath: args.config,
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });
    const execution: SeedExecutionContext = {
      operatorClient: await initOperatorClient(await loadAccessToken({ profile: args.profile })),
      workspaceId: await loadWorkspaceId({
        workspaceId: args["workspace-id"],
        profile: args.profile,
      }),
      authNamespace: appInfo.auth,
      machineUserName,
      appName: appInfo.name,
    };

    if (args.truncate) {
      const confirmed =
        args.yes || (await promptConfirmation("Are you sure you want to truncate? (y/n): "));
      if (!confirmed) {
        if (args.json) {
          logger.out({ success: false, cancelled: true, processed: {} });
        }
        throw new Error("Truncate cancelled.");
      }

      logger.info("Truncating tables...");
      if (args.namespace) {
        await truncate({
          configPath: args.config,
          profile: args.profile,
          workspaceId: args["workspace-id"],
          namespace: args.namespace,
        });
      } else if (args.entities.length > 0) {
        const typesToTruncate = (selection.entitiesToProcess ?? []).filter(
          (type) => type !== "_User",
        );
        if (typesToTruncate.length > 0) {
          await truncate({
            configPath: args.config,
            profile: args.profile,
            workspaceId: args["workspace-id"],
            tables: typesToTruncate,
          });
        } else {
          logger.log(styles.dim("No TailorDB tables to truncate (only _User was specified)."));
        }
      } else {
        await truncate({
          configPath: args.config,
          profile: args.profile,
          workspaceId: args["workspace-id"],
          all: true,
        });
      }

      const shouldTruncateUser =
        hasIdpUser &&
        !args["skip-idp"] &&
        !args.namespace &&
        (args.entities.length === 0 || (selection.entitiesToProcess ?? []).includes("_User"));
      if (shouldTruncateUser && context.idpUser) {
        const truncated = await truncateIdpUser(execution, context.idpUser);
        if (!truncated) {
          throw new Error("IdP user truncation failed.");
        }
      }
      logger.success("Truncate completed.");
    }

    logger.newline();
    logger.info("Starting seed data generation...");
    if (args["skip-idp"]) {
      logger.log(styles.dim("  Skipping IdP user (_User)"));
    }

    let allSuccess = true;
    const allProcessed: Record<string, number> = {};
    let transportFailure: { error: unknown } | undefined;

    for (const plan of plans) {
      const seeded = await seedNamespace({
        execution,
        plan,
        upsert: args.upsert,
        configDir: path.dirname(context.config.path),
        buildOptions: buildOptionsOf(context.config),
      });
      for (const [type, count] of Object.entries(seeded.processed)) {
        allProcessed[type] = (allProcessed[type] ?? 0) + count;
      }
      if (!seeded.success) {
        allSuccess = false;
      }
    }

    if (shouldSeedUser && context.idpUser) {
      const seeded = await seedIdpUser({
        execution,
        idpNamespace: context.idpUser.idpNamespace,
        scriptCode: context.idpUser.seedScriptCode,
        rows: idpUserRows,
        upsert: args.upsert,
      });
      if (seeded.processed > 0) {
        allProcessed._User = seeded.processed;
      }
      if (!seeded.success) {
        allSuccess = false;
      }
      if ("transportError" in seeded) {
        transportFailure = { error: seeded.transportError };
      }
    }

    logger.newline();
    if (args.json) {
      logger.out({
        success: allSuccess,
        processed: allProcessed,
        ...(datasets.names.length > 0 ? { datasets: datasets.names } : {}),
      });
    }
    if (transportFailure) {
      throw transportFailure.error;
    }
    if (!allSuccess) {
      throw new Error("Seed data generation completed with errors");
    }
    logger.success("Seed data generation completed successfully");
  },
});
