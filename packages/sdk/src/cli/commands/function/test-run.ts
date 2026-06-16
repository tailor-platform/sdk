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
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient, type OperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { executeScript } from "@/cli/shared/script-executor";
import { formatErrorWithSourcemap } from "@/cli/shared/stack-trace";
import { assertDefined } from "@/utils/assert";
import { bundleForTestRun, type ResolvedMachineUser } from "./bundle";
import { detectFunctionType } from "./detect";

export const testRunCommand = defineAppCommand({
  name: "test-run",
  description: "Run a function on the Tailor Platform server without deploying.",
  args: z.object({
    ...workspaceArgs,
    file: arg(z.string(), {
      positional: true,
      description: "Path to the function file",
    }),
    name: arg(z.string().optional(), {
      alias: "n",
      description: "Workflow job name to run (matches the `name` field of createWorkflowJob)",
    }),
    arg: arg(z.string().optional(), {
      alias: "a",
      description: "JSON argument to pass to the function",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description: "Machine user name for authentication",
      env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
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
      cmd: 'resolvers/add.ts --arg \'{"a":1,"b":2}\'',
      desc: "Run a resolver with input arguments",
    },
    {
      cmd: "workflows/sample.ts --name validate-order",
      desc: "Run a specific workflow job by name",
    },
    {
      cmd: 'build/resolvers/add.js --arg \'{"a":1,"b":2}\'',
      desc: "Run a pre-bundled .js file directly",
    },
  ],
  run: async (args) => {
    const jsonOutput = logger.jsonMode;

    // 1. Resolve and validate file path
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // 2. Load config (required)
    const { config } = await loadConfig(args.config);

    // 3. Resolve auth, workspace, and machine user info (needed before bundling)
    const authNamespace = resolveAuthNamespace(config.auth);
    const machineUserName = resolveMachineUserName(args["machine-user"], config.auth);

    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const machineUser = await resolveMachineUser({
      client,
      workspaceId,
      authNamespace,
      machineUserName,
      authConfig: config.auth,
    });

    // 4. Resolve bundled code and script name
    const relativePath = path.relative(process.cwd(), filePath);
    const isPreBundled = filePath.endsWith(".js");
    let bundledCode: string;
    let scriptName: string;
    let functionType: string | undefined;
    let functionName: string | undefined;

    if (isPreBundled) {
      // Pre-bundled .js file
      scriptName = path.basename(filePath);
      bundledCode = fs.readFileSync(filePath, "utf-8");
      logger.info(`Using pre-bundled script ${styles.bold(scriptName)}`);
    } else {
      // Source file: detect type and bundle
      logger.info(`Detecting function type from ${styles.path(relativePath)}`);

      const detected = await detectFunctionType({
        filePath,
        jobName: args.name,
      });

      functionType = detected.type;
      functionName = detected.name;
      logger.info(`Detected: ${styles.bold(detected.type)} ${styles.info(`"${detected.name}"`)}`);

      if (detected.type === "resolver" && args.arg) {
        if (!detected.hasInput) {
          logger.warn(
            '--arg is ignored because this resolver has no input schema. Define "input" in your resolver to use --arg.',
          );
          args.arg = undefined;
        } else if (detected.inputSchema) {
          JSON.parse(args.arg);
        }
      }

      logger.info("Bundling...");
      ({ bundledCode, scriptName } = await bundleForTestRun({
        detected,
        sourceFile: filePath,
        env: config.env ?? {},
        inlineSourcemap: config.inlineSourcemap,
        logLevel: config.logLevel,
        machineUser,
        workspaceId,
      }));
      logger.info(`Bundled as ${styles.bold(scriptName)}`);
    }

    // 5. Execute via TestExecScript
    const authInvoker = create(AuthInvokerSchema, {
      namespace: authNamespace,
      machineUserName: machineUser.name,
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
    if (jsonOutput) {
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

      if (result.logs.trim()) {
        logger.log(styles.bold("\nLogs:"));
        for (const line of result.logs.split("\n")) {
          logger.log(`  ${line}`);
        }
      }

      if (result.result && result.success) {
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
        const formatted = formatErrorWithSourcemap(result.error, bundledCode, process.cwd());
        if (formatted) {
          logger.log(formatted);
        } else {
          logger.log(`  ${styles.error(result.error)}`);
        }
      }
    }

    if (!result.success) {
      process.exit(1);
    }
  },
});

/**
 * Resolve auth namespace from config.
 * @param authConfig - Auth configuration from tailor.config.ts
 * @returns Resolved auth namespace
 */
function resolveAuthNamespace(
  authConfig: { name: string; external?: boolean } | undefined,
): string {
  if (authConfig?.name) {
    return authConfig.name;
  }
  throw new Error("Auth namespace is required. Ensure tailor.config.ts has an auth config.");
}

/**
 * Resolve machine user name from CLI args or config. Priority: --machine-user > first key of config.auth.machineUsers
 * @param cliMachineUser - CLI --machine-user value
 * @param authConfig - Auth configuration from tailor.config.ts
 * @returns Resolved machine user name
 */
function resolveMachineUserName(
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
        return assertDefined(keys[0], "machine user key missing");
      }
    }
  }
  throw new Error(
    "Machine user is required. Provide --machine-user or ensure tailor.config.ts has machine users configured.",
  );
}

interface ResolveMachineUserOptions {
  client: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
  authConfig:
    | { name: string; external?: boolean; machineUsers?: Record<string, unknown> }
    | undefined;
}

/**
 * Resolve full machine user info: name, id (from API), and attributes (from config).
 * @param options - Options for resolving machine user
 * @returns Resolved machine user with id, attributes, and attributeList
 */
async function resolveMachineUser(
  options: ResolveMachineUserOptions,
): Promise<ResolvedMachineUser> {
  const { client, workspaceId, authNamespace, machineUserName, authConfig } = options;

  // Get machine user ID from the server
  let id = "00000000-0000-0000-0000-000000000000";
  try {
    const { machineUser } = await client.getAuthMachineUser({
      workspaceId,
      authNamespace,
      name: machineUserName,
    });
    if (machineUser?.id) {
      id = machineUser.id;
    }
  } catch {
    logger.debug(`Could not fetch machine user "${machineUserName}" from server, using nil UUID`);
  }

  // Get attributes from config
  const machineUserConfig = authConfig?.machineUsers?.[machineUserName];
  let attributes: Record<string, unknown> | null = null;
  let attributeList: unknown[] = [];
  if (machineUserConfig && typeof machineUserConfig === "object") {
    const cfg = machineUserConfig as {
      attributes?: Record<string, unknown>;
      attributeList?: unknown[];
    };
    attributes = cfg.attributes ?? null;
    attributeList = cfg.attributeList ?? [];
  }

  return { name: machineUserName, id, attributes, attributeList };
}
