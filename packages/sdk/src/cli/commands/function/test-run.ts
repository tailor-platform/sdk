/**
 * `tailor-sdk function test-run` command
 *
 * Bundles and executes a function on the Tailor Platform server
 * without deploying (applying) the application.
 */

import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { AuthInvokerSchema } from "@tailor-proto/tailor/v1/auth_resource_pb";
import * as path from "pathe";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { executeScript } from "@/cli/shared/script-executor";
import { bundleForTestRun } from "./bundle";
import { detectFunctionType, type FunctionType } from "./detect";

export const testRunCommand = defineCommand({
  name: "test-run",
  description: "Run a function on the Tailor Platform server without deploying.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    file: arg(z.string(), {
      positional: true,
      description: "Path to the function file",
    }),
    name: arg(z.string().optional(), {
      alias: "n",
      description: "Workflow job name to run (matches the `name` field of createWorkflowJob)",
    }),
    type: arg(z.enum(["resolver", "executor", "workflow-job", "plain"]).optional(), {
      alias: "t",
      description: "Function type (auto-detected if not specified)",
    }),
    arg: arg(z.string().optional(), {
      alias: "a",
      description: "JSON argument to pass to the function",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description: "Machine user name for authentication",
    }),
    "auth-namespace": arg(z.string().optional(), {
      description: "Auth namespace (defaults to config auth name)",
    }),
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
  }),
  notes: `You can pass either a source file (\`.ts\`) or a pre-bundled file (\`.js\`).
When a \`.js\` file is provided, detection and bundling are skipped and the file is executed as-is.

> [!WARNING]
> Workflow job \`.trigger()\` calls do not work in test-run mode.
> Triggered jobs are not executed; only the target job's \`body\` function runs in isolation.`,
  examples: [
    {
      cmd: 'resolvers/add.ts --arg \'{"input":{"a":1,"b":2}}\'',
      desc: "Run a resolver with input arguments",
    },
    {
      cmd: "workflows/sample.ts --name validate-order",
      desc: "Run a specific workflow job by name",
    },
    {
      cmd: '.tailor-sdk/resolvers/add.js --arg \'{"input":{"a":1,"b":2}}\'',
      desc: "Run a pre-bundled .js file directly",
    },
  ],
  run: withCommonArgs(async (args) => {
    // 1. Resolve and validate file path
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // 2. Load config (required)
    const { config } = await loadConfig(args.config);

    // 3. Resolve bundled code and script name
    const relativePath = path.relative(process.cwd(), filePath);
    const isPreBundled = filePath.endsWith(".js");
    let bundledCode: string;
    let scriptName: string;
    let functionType: string | undefined;
    let functionName: string | undefined;

    if (isPreBundled) {
      // Pre-bundled .js file (e.g., from .tailor-sdk/resolvers/add.js)
      scriptName = path.basename(filePath);
      bundledCode = fs.readFileSync(filePath, "utf-8");
      logger.info(`Using pre-bundled script ${styles.bold(scriptName)}`);
    } else {
      // Source file: detect type and bundle
      logger.info(`Detecting function type from ${styles.path(relativePath)}`);

      const detected = await detectFunctionType({
        filePath,
        jobName: args.name,
        typeOverride: args.type as FunctionType | undefined,
      });

      functionType = detected.type;
      functionName = detected.name;
      logger.info(`Detected: ${styles.bold(detected.type)} ${styles.info(`"${detected.name}"`)}`);

      logger.info("Bundling...");
      ({ bundledCode, scriptName } = await bundleForTestRun({
        detected,
        sourceFile: filePath,
        env: config.env ?? {},
      }));
      logger.info(`Bundled as ${styles.bold(scriptName)}`);
    }

    // 5. Resolve auth info
    const authNamespace = resolveAuthNamespace(args["auth-namespace"], config.auth);
    const machineUserName = resolveMachineUser(args["machine-user"], config.auth);

    // 6. Execute via TestExecScript
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const authInvoker = create(AuthInvokerSchema, {
      namespace: authNamespace,
      machineUserName,
    });

    logger.info(`Executing on workspace ${styles.dim(workspaceId)}...`);

    const result = await executeScript({
      client,
      workspaceId,
      name: scriptName,
      code: bundledCode,
      arg: args.arg,
      invoker: authInvoker,
    });

    // 7. Display result
    if (args.json) {
      logger.out({
        success: result.success,
        scriptName,
        functionType,
        functionName,
        logs: result.logs,
        result: result.result,
        error: result.error,
      });
    } else {
      if (result.success) {
        logger.success("Execution succeeded");
      } else {
        logger.error("Execution failed");
      }

      if (result.logs?.trim()) {
        logger.log(styles.bold("\nLogs:"));
        for (const line of result.logs.split("\n")) {
          logger.log(`  ${line}`);
        }
      }

      if (result.result) {
        logger.log(styles.bold("\nResult:"));
        try {
          const parsed = JSON.parse(result.result);
          logger.log(`  ${JSON.stringify(parsed, null, 2).split("\n").join("\n  ")}`);
        } catch {
          logger.log(`  ${result.result}`);
        }
      }

      if (result.error && !result.success) {
        logger.log(styles.bold("\nError:"));
        logger.log(`  ${styles.error(result.error)}`);
      }
    }

    if (!result.success) {
      process.exit(1);
    }
  }),
});

/**
 * Resolve auth namespace from CLI args or config. Priority: --auth-namespace > config.auth.name
 * @param cliAuthNamespace - CLI --auth-namespace value
 * @param authConfig - Auth configuration from tailor.config.ts
 * @returns Resolved auth namespace
 */
function resolveAuthNamespace(
  cliAuthNamespace: string | undefined,
  authConfig: { name: string; external?: boolean } | undefined,
): string {
  if (cliAuthNamespace) {
    return cliAuthNamespace;
  }
  if (authConfig?.name) {
    return authConfig.name;
  }
  throw new Error(
    "Auth namespace is required. Provide --auth-namespace or ensure tailor.config.ts has an auth config.",
  );
}

/**
 * Resolve machine user name from CLI args or config. Priority: --machine-user > first key of config.auth.machineUsers
 * @param cliMachineUser - CLI --machine-user value
 * @param authConfig - Auth configuration from tailor.config.ts
 * @returns Resolved machine user name
 */
function resolveMachineUser(
  cliMachineUser: string | undefined,
  authConfig:
    | { name: string; external?: boolean; machineUsers?: Record<string, unknown> }
    | undefined,
): string {
  if (cliMachineUser) {
    return cliMachineUser;
  }
  if (authConfig && !("external" in authConfig && authConfig.external)) {
    const machineUsers = authConfig.machineUsers;
    if (machineUsers) {
      const keys = Object.keys(machineUsers);
      if (keys.length > 0) {
        return keys[0];
      }
    }
  }
  throw new Error(
    "Machine user is required. Provide --machine-user or ensure tailor.config.ts has machine users configured.",
  );
}
