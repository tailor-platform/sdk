import { createInterface } from "node:readline";
import {
  bundleSeedScript,
  chunkSeedData,
  executeScript,
  initOperatorClient,
  loadAccessToken,
  loadSeedContext,
  loadWorkspaceId,
  show,
  truncate,
} from "@tailor-platform/sdk/cli";
import { deploymentArgs } from "@tailor-platform/shared/args";
import { renderFor } from "@tailor-platform/shared/color";
import { defineAppCommand } from "@tailor-platform/shared/command";
import { logger, styles } from "@tailor-platform/shared/logger";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { selectEntities } from "./entities";
import { assertSeedDataDirectory, loadSeedData } from "./jsonl";
import { topologicalSort } from "./topo-sort";
import type { OperatorClient, ScriptExecutionResult, SeedData } from "@tailor-platform/sdk/cli";

interface SeedExecutionContext {
  operatorClient: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
  dataDir: string;
}

interface SeedNamespaceParams {
  execution: SeedExecutionContext;
  namespace: string;
  typesToSeed: string[];
  dependencies: Record<string, string[]>;
  selfRefTypes: string[];
  requiredFields: Record<string, string[]>;
  upsert: boolean;
  configDir: string;
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

function logExecutionLogs(logs: string | undefined, indent: string): void {
  if (!logs) return;
  for (const line of logs.split("\n").filter(Boolean)) {
    logger.log(styles.dim(`${indent}${line}`));
  }
}

function parseExecutionResult(
  result: ScriptExecutionResult,
  indent: string,
): {
  success: boolean;
  parsed: Record<string, unknown>;
  errors: string[];
} {
  logExecutionLogs(result.logs, indent);

  if (!result.success) {
    return {
      success: false,
      parsed: {},
      errors: [result.error ?? "Script execution failed"],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(result.result || "{}");
    parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      parsed: {},
      errors: [`Failed to parse result: ${message}`],
    };
  }

  if (!parsed.success) {
    const errors = Array.isArray(parsed.errors) ? (parsed.errors as string[]) : [];
    return {
      success: false,
      parsed,
      errors: errors.length > 0 ? errors : ["Script reported failure"],
    };
  }

  return { success: true, parsed, errors: [] };
}

interface SeedResult {
  success: boolean;
  processed: Record<string, number>;
}

async function seedNamespace(params: SeedNamespaceParams): Promise<SeedResult> {
  const {
    execution,
    namespace,
    typesToSeed,
    dependencies,
    selfRefTypes,
    requiredFields,
    upsert,
    configDir,
  } = params;
  const sortedTypes = topologicalSort(typesToSeed, dependencies);
  const data = loadSeedData(execution.dataDir, sortedTypes, {
    requireId: upsert,
    requiredFieldsByType: upsert ? requiredFields : {},
  });
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

  const bundled = await bundleSeedScript(namespace, typesWithData, configDir);
  const chunks = chunkSeedData({
    data,
    order: sortedTypes,
    codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
  });

  if (chunks.length === 0) {
    logger.log(styles.dim(`  [${namespace}] No data to seed`));
    return { success: true, processed: processedTotals };
  }
  if (chunks.length > 1) {
    logger.log(styles.dim(`    Split into ${chunks.length} chunks`));
  }

  let success = true;
  for (const chunk of chunks) {
    if (chunks.length > 1) {
      logger.log(
        styles.dim(`    Chunk ${chunk.index + 1}/${chunk.total}: ${chunk.order.join(", ")}`),
      );
    }

    const result = await executeScript({
      client: execution.operatorClient,
      workspaceId: execution.workspaceId,
      name: `seed-${namespace}.ts`,
      code: bundled.bundledCode,
      arg: { data: chunk.data, order: chunk.order, selfRefTypes, upsert },
      invoker: {
        namespace: execution.authNamespace,
        machineUserName: execution.machineUserName,
      },
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
    }
  }
  return { success, processed: processedTotals };
}

interface IdpScriptRun {
  execution: SeedExecutionContext;
  scriptCode: string;
  scriptName: string;
  arg?: { users: SeedData[string]; upsert?: boolean };
  indent: string;
  reportSuccess: (parsed: Record<string, unknown>) => void;
}

async function runIdpScript(
  params: IdpScriptRun,
): Promise<{ success: boolean; parsed: Record<string, unknown> }> {
  const { execution, scriptCode, scriptName, arg, indent, reportSuccess } = params;

  const result = await executeScript({
    client: execution.operatorClient,
    workspaceId: execution.workspaceId,
    name: scriptName,
    code: scriptCode,
    ...(arg ? { arg } : {}),
    invoker: {
      namespace: execution.authNamespace,
      machineUserName: execution.machineUserName,
    },
  });

  const { success, parsed, errors } = parseExecutionResult(result, indent);
  reportSuccess(parsed);
  if (!success) {
    for (const error of errors) {
      logger.error(`${indent}${error}`, { mode: "plain" });
    }
  }
  return { success, parsed };
}

async function seedIdpUser(
  execution: SeedExecutionContext,
  scriptCode: string,
  upsert: boolean,
): Promise<{ success: boolean; processed: number }> {
  logger.info("  Seeding _User via tailor.idp.Client...", { mode: "plain" });

  const rows = loadSeedData(execution.dataDir, ["_User"])._User ?? [];
  if (rows.length === 0) {
    logger.log(styles.dim("    No _User data to seed"));
    return { success: true, processed: 0 };
  }
  logger.log(styles.dim(`    Processing ${rows.length} _User records...`));

  const { success, parsed } = await runIdpScript({
    execution,
    scriptCode,
    scriptName: "seed-idp-user.ts",
    arg: { users: rows, upsert },
    indent: "    ",
    reportSuccess: (result) => {
      const created = typeof result.created === "number" ? result.created : 0;
      const updated = typeof result.updated === "number" ? result.updated : 0;
      const skipped = typeof result.skipped === "number" ? result.skipped : 0;
      const processed = typeof result.processed === "number" ? result.processed : 0;
      if (created === 0 && updated === 0 && skipped === 0) {
        return;
      }
      const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : "";
      const message = upsert
        ? `${created} created, ${updated} updated${skippedSuffix}`
        : `${processed} rows processed`;
      logger.log(styles.success(`    ✓ _User: ${message}`));
    },
  });
  return {
    success,
    processed: typeof parsed.processed === "number" ? parsed.processed : 0,
  };
}

async function truncateIdpUser(
  execution: SeedExecutionContext,
  scriptCode: string,
): Promise<boolean> {
  logger.info("Truncating _User via tailor.idp.Client...", { mode: "plain" });

  const { success } = await runIdpScript({
    execution,
    scriptCode,
    scriptName: "truncate-idp-user.ts",
    indent: "  ",
    reportSuccess: (result) => {
      if (typeof result.deleted === "number") {
        logger.log(styles.success(`  ✓ _User: ${result.deleted} users deleted`));
      }
    },
  });
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
    types: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Entity names to seed, including _User (default: all)",
    }),
  }),
  run: async (args) => {
    const context = await loadSeedContext({ configPath: args.config });

    const namespaceEntities = Object.fromEntries(
      context.namespaces.map((ns) => [ns.namespace, ns.types]),
    );
    const hasIdpUser = context.idpUser !== null;
    const selection = selectEntities({
      namespaceEntities,
      hasIdpUser,
      namespace: args.namespace,
      types: args.types,
      skipIdp: args["skip-idp"],
    });
    for (const warning of selection.warnings) {
      logger.warn(warning);
    }
    if (args.namespace) {
      logger.info(`Filtering by namespace: ${args.namespace}`);
      logger.log(styles.dim(`Entities: ${(selection.entitiesToProcess ?? []).join(", ")}`));
    } else if (args.types.length > 0) {
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
      dataDir,
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
      } else if (args.types.length > 0) {
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
        (args.types.length === 0 || (selection.entitiesToProcess ?? []).includes("_User"));
      if (shouldTruncateUser && context.idpUser) {
        const truncated = await truncateIdpUser(execution, context.idpUser.truncateScriptCode);
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

    const namespacesToProcess = args.namespace
      ? [args.namespace]
      : context.namespaces.map((ns) => ns.namespace);
    for (const namespace of namespacesToProcess) {
      const nsConfig = context.namespaces.find((ns) => ns.namespace === namespace);
      if (!nsConfig) continue;

      const typesToSeed = selection.entitiesToProcess
        ? nsConfig.types.filter((type) => selection.entitiesToProcess?.includes(type))
        : nsConfig.types;
      if (typesToSeed.length === 0) continue;

      const seeded = await seedNamespace({
        execution,
        namespace,
        typesToSeed,
        dependencies: nsConfig.dependencies,
        selfRefTypes: nsConfig.selfRefTypes,
        requiredFields: nsConfig.requiredFields,
        upsert: args.upsert,
        configDir: path.dirname(context.config.path),
      });
      for (const [type, count] of Object.entries(seeded.processed)) {
        allProcessed[type] = (allProcessed[type] ?? 0) + count;
      }
      if (!seeded.success) {
        allSuccess = false;
      }
    }

    const shouldSeedUser =
      hasIdpUser &&
      !args["skip-idp"] &&
      (!selection.entitiesToProcess || selection.entitiesToProcess.includes("_User"));
    if (shouldSeedUser && context.idpUser) {
      const seeded = await seedIdpUser(execution, context.idpUser.seedScriptCode, args.upsert);
      if (seeded.processed > 0) {
        allProcessed._User = seeded.processed;
      }
      if (!seeded.success) {
        allSuccess = false;
      }
    }

    logger.newline();
    if (args.json) {
      logger.out({ success: allSuccess, processed: allProcessed });
    }
    if (!allSuccess) {
      throw new Error("Seed data generation completed with errors");
    }
    logger.success("Seed data generation completed successfully");
  },
});
