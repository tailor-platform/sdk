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
import chalk from "chalk";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { selectEntities } from "./entities";
import { loadSeedData } from "./jsonl";
import { deploymentArgs } from "./shared/args";
import { defineAppCommand } from "./shared/command";
import { logger } from "./shared/logger";
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
}

function promptConfirmation(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    logger.warn("Interactive confirmation is not available; pass --yes to proceed.");
    return Promise.resolve(false);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.yellow(question), (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() === "y");
    });
  });
}

function logExecutionLogs(logs: string | undefined, indent: string): void {
  if (!logs) return;
  for (const line of logs.split("\n").filter(Boolean)) {
    logger.log(chalk.dim(`${indent}${line}`));
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
    return { success: false, parsed: {}, errors: [result.error ?? "Script execution failed"] };
  }

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(result.result || "{}");
    parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, parsed: {}, errors: [`Failed to parse result: ${message}`] };
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

async function seedNamespace(params: SeedNamespaceParams): Promise<boolean> {
  const { execution, namespace, typesToSeed, dependencies, selfRefTypes } = params;
  const sortedTypes = topologicalSort(typesToSeed, dependencies);
  const data = loadSeedData(execution.dataDir, sortedTypes);

  const typesWithData = sortedTypes.filter((type) => data[type] && data[type].length > 0);
  if (typesWithData.length === 0) {
    logger.log(chalk.dim(`  [${namespace}] No data to seed`));
    return true;
  }

  logger.info(`  [${namespace}] Seeding ${typesWithData.length} types via Kysely batch insert...`, {
    mode: "plain",
  });

  const bundled = await bundleSeedScript(namespace, typesWithData);
  const chunks = chunkSeedData({
    data,
    order: sortedTypes,
    codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
  });

  if (chunks.length === 0) {
    logger.log(chalk.dim(`  [${namespace}] No data to seed`));
    return true;
  }
  if (chunks.length > 1) {
    logger.log(chalk.dim(`    Split into ${chunks.length} chunks`));
  }

  let success = true;
  for (const chunk of chunks) {
    if (chunks.length > 1) {
      logger.log(
        chalk.dim(`    Chunk ${chunk.index + 1}/${chunk.total}: ${chunk.order.join(", ")}`),
      );
    }

    const result = await executeScript({
      client: execution.operatorClient,
      workspaceId: execution.workspaceId,
      name: `seed-${namespace}.ts`,
      code: bundled.bundledCode,
      arg: { data: chunk.data, order: chunk.order, selfRefTypes },
      invoker: {
        namespace: execution.authNamespace,
        machineUserName: execution.machineUserName,
      },
    });

    const { success: chunkSuccess, parsed, errors } = parseExecutionResult(result, "    ");
    const processed = (parsed.processed ?? {}) as Record<string, number>;
    for (const [type, count] of Object.entries(processed)) {
      logger.log(chalk.green(`    ✓ ${type}: ${count} rows inserted`));
    }
    if (!chunkSuccess) {
      logger.error(`  Seed failed:\n      ${errors.join("\n      ")}`, { mode: "plain" });
      success = false;
    }
  }
  return success;
}

interface IdpScriptRun {
  execution: SeedExecutionContext;
  scriptCode: string;
  scriptName: string;
  arg?: { users: SeedData[string] };
  indent: string;
  reportSuccess: (parsed: Record<string, unknown>) => void;
}

async function runIdpScript(params: IdpScriptRun): Promise<boolean> {
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
  return success;
}

async function seedIdpUser(execution: SeedExecutionContext, scriptCode: string): Promise<boolean> {
  logger.info("  Seeding _User via tailor.idp.Client...", { mode: "plain" });

  const rows = loadSeedData(execution.dataDir, ["_User"])._User ?? [];
  if (rows.length === 0) {
    logger.log(chalk.dim("    No _User data to seed"));
    return true;
  }
  logger.log(chalk.dim(`    Processing ${rows.length} _User records...`));

  return await runIdpScript({
    execution,
    scriptCode,
    scriptName: "seed-idp-user.ts",
    arg: { users: rows },
    indent: "    ",
    reportSuccess: (parsed) => {
      if (typeof parsed.processed === "number") {
        logger.log(chalk.green(`    ✓ _User: ${parsed.processed} rows processed`));
      }
    },
  });
}

async function truncateIdpUser(
  execution: SeedExecutionContext,
  scriptCode: string,
): Promise<boolean> {
  logger.info("Truncating _User via tailor.idp.Client...", { mode: "plain" });

  return await runIdpScript({
    execution,
    scriptCode,
    scriptName: "truncate-idp-user.ts",
    indent: "  ",
    reportSuccess: (parsed) => {
      if (typeof parsed.deleted === "number") {
        logger.log(chalk.green(`  ✓ _User: ${parsed.deleted} users deleted`));
      }
    },
  });
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
      description: "Seed all types in the specified TailorDB namespace (excludes _User)",
    }),
    "skip-idp": arg(z.boolean().default(false), {
      description: "Skip the IdP user (_User) entity",
    }),
    truncate: arg(z.boolean().default(false), {
      description: "Truncate target tables before seeding",
    }),
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Skip confirmation prompts (for --truncate)",
    }),
    types: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Type names to seed (default: all types)",
    }),
  }),
  run: async (args) => {
    const context = await loadSeedContext({ configPath: args.config });

    const machineUserName = args["machine-user"] ?? context.machineUserName;
    if (!machineUserName) {
      throw new Error(
        "Machine user name is required. " +
          "Specify --machine-user <name> or configure machineUserName in seedPlugin options.",
      );
    }

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
      logger.log(chalk.dim(`Entities: ${(selection.entitiesToProcess ?? []).join(", ")}`));
    } else if (args.types.length > 0) {
      logger.info(`Filtering by types: ${(selection.entitiesToProcess ?? []).join(", ")}`);
    }

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
      dataDir: path.join(context.distPath, "data"),
    };

    if (args.truncate) {
      const confirmed =
        args.yes || (await promptConfirmation("Are you sure you want to truncate? (y/n): "));
      if (!confirmed) {
        logger.warn("Truncate cancelled.");
        return;
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
            types: typesToTruncate,
          });
        } else {
          logger.log(chalk.dim("No TailorDB types to truncate (only _User was specified)."));
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
      logger.log(chalk.dim("  Skipping IdP user (_User)"));
    }

    let allSuccess = true;

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
      });
      if (!seeded) {
        allSuccess = false;
      }
    }

    const shouldSeedUser =
      hasIdpUser &&
      !args["skip-idp"] &&
      (!selection.entitiesToProcess || selection.entitiesToProcess.includes("_User"));
    if (shouldSeedUser && context.idpUser) {
      const seeded = await seedIdpUser(execution, context.idpUser.seedScriptCode);
      if (!seeded) {
        allSuccess = false;
      }
    }

    logger.newline();
    if (!allSuccess) {
      throw new Error("Seed data generation completed with errors");
    }
    logger.success("Seed data generation completed successfully");
  },
});
