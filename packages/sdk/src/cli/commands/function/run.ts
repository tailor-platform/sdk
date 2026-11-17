/**
 * `tailor function run` command
 *
 * Bundles and executes a function on the Tailor Platform server
 * without deploying (applying) the application.
 */

import * as fs from "node:fs";
import { arg, extractFields } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import {
  commonArgs,
  configArg,
  resolveMachineUserInputSource,
  flagTokensOf,
  type MachineUserInputSource,
  workspaceArgs,
} from "#/cli/shared/args";
import { type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { assertDefined } from "#/utils/assert";
import { type ResolvedMachineUser } from "./bundle";
import {
  argFileNotFoundError,
  argumentToSend,
  executeFunction,
  executionRecord,
  type FunctionArg,
  type FunctionRunTarget,
  parseArgOption,
  prepareFunction,
  printExecutionDetails,
  readFunctionArgFile,
} from "./run-function";
import {
  SCRIPT_SNAPSHOT_FILE_NAME,
  loadScriptSchemaSnapshot,
  verifyScriptSchemaSnapshot,
} from "./script-scaffold";

export const runFunctionCommand = defineAppCommand({
  name: "run",
  aliases: ["test-run"],
  description: "Run a function on the Tailor Platform server without deploying.",
  // strip unknown keys
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
    "arg-file": arg(z.string().optional(), {
      description: "Path to a JSON file holding the argument to pass to the function",
    }),
    watch: arg(z.boolean().default(false), {
      description:
        "Run the function again each time the file, a file it imports, or the argument file changes",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication. Falls back to the active profile's default machine user.",
      env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
    }),
    ...configArg,
    "allow-schema-drift": arg(z.boolean().default(false), {
      description: "Run a scaffolded script even when its schema snapshot no longer matches",
    }),
  }),
  notes: `You can pass either a source file (\`.ts\`) or a pre-bundled file (\`.js\`).
When a \`.js\` file is provided, detection and bundling are skipped and the file is executed as-is.

A script scaffolded by \`function script\` with a generated \`db.ts\` is checked against its \`db.snapshot.json\` before execution and refused on schema drift; pass \`--allow-schema-drift\` to run it anyway. The check compares table and field structure; hook and validator code changes are not detected.

\`--arg-file\` reads the argument from a JSON file instead of \`--arg\`; the two cannot be combined.

\`--watch\` runs the function, then runs it again each time you save the function file, a project file it imports, or the argument file. Without \`--arg-file\`, it creates a temporary argument file holding \`--arg\` (or \`{}\`), prints its path, and deletes it when you stop the command with Ctrl+C or close the terminal; edit that file to run the function with a new argument. An \`--arg-file\` must exist when the command starts, and its content is read on every run. With \`--watch\`, an argument file holding \`{}\` counts as no argument, so a resolver without an input schema runs without the warning that the argument is ignored.

Each run prints a \`-->\` line when the Platform accepts it and a \`<--\` line with \`[OK]\` or \`[FAILED]\` when it finishes, followed by its logs and result. Both lines carry the execution ID, which \`function logs\` accepts. When reading the argument file, loading or bundling the function, or the request to the Platform fails, the command prints an \`[ERROR]\` line and keeps watching. Until the function loads and bundles again, adding a file anywhere in the project also starts a run, so a file that an import names can be created after the import. A save during a run starts one more run after it finishes. With \`--json\`, each run writes one JSON object per line to stdout, including its \`executionId\`, and each failure writes an error object to stderr.

Changes to \`tailor.config.ts\`, \`tsconfig.json\`, \`package.json\`, env files, and installed packages are not picked up; restart the command after changing them.

\`test-run\` is a deprecated alias of this command and will be removed in v3.

> [!WARNING]
> Workflow job \`.start()\` calls do not work in this mode.
> Started jobs are not executed; only the target job's \`body\` function runs in isolation.`,
  examples: [
    {
      cmd: 'resolvers/add.ts --arg \'{"a":1,"b":2}\'',
      desc: "Run a resolver with input arguments",
    },
    {
      cmd: "resolvers/add.ts --arg-file args/add.json",
      desc: "Run a resolver with input arguments read from a JSON file",
    },
    {
      cmd: "resolvers/add.ts --watch",
      desc: "Run a resolver again on every save, with its argument in a temporary file",
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
    if (invokedViaTestRunAlias(process.argv)) {
      logger.warn(
        "`tailor function test-run` is deprecated and will be removed in v3. Use `tailor function run` instead.",
      );
    }

    const jsonOutput = logger.jsonMode;

    // 1. Resolve and validate file path
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      throw CLIError({ code: "FILE_NOT_FOUND", message: `File not found: ${filePath}` });
    }
    const { arg: functionArg, argFile } = resolveArgOptions({
      arg: args.arg,
      argFile: args["arg-file"],
      watch: args.watch,
    });

    // 2. Load config (required)
    const { config, plugins } = await loadConfig(args.config);

    // 3. Resolve auth, workspace, and machine user info (needed before bundling)
    const authNamespace = resolveAuthNamespace(config.auth);
    const machineUserName = await resolveMachineUserName({
      cliMachineUser: args["machine-user"],
      cliMachineUserSource: resolveMachineUserInputSource(args["machine-user"]),
      profile: args.profile,
      authConfig: config.auth,
    });

    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    const machineUser = await resolveMachineUser({
      client,
      workspaceId,
      authNamespace,
      machineUserName,
      authConfig: config.auth,
    });

    // 4. Check a scaffolded script's schema snapshot
    if (!filePath.endsWith(".js")) {
      if (args["allow-schema-drift"]) {
        if (fs.existsSync(path.join(path.dirname(filePath), SCRIPT_SNAPSHOT_FILE_NAME))) {
          logger.warn("Skipping the schema snapshot check (--allow-schema-drift).");
        }
      } else {
        const sidecar = loadScriptSchemaSnapshot(filePath);
        if (sidecar) {
          logger.info("Checking the script's schema snapshot for drift...");
          await verifyScriptSchemaSnapshot({
            client,
            workspaceId,
            config,
            configArgValue: args.config,
            scriptArgValue: args.file,
            profileArgValue: args.profile,
            sidecar,
          });
        }
      }
    }

    const target: FunctionRunTarget = {
      filePath,
      jobName: args.name,
      config,
      kyselyTemporal: resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false,
      client,
      workspaceId,
      authNamespace,
      machineUser,
    };

    if (args.watch) {
      const { startFunctionRunWatch } = await import("./watch");
      const watch = await startFunctionRunWatch({
        target,
        argFile,
        initialArg: functionArg?.value,
      });
      await watch.closed;
      return;
    }

    // 5. Bundle and execute
    const prepared = await prepareFunction({ target, progress: (message) => logger.info(message) });
    const argValue = argumentToSend(prepared, functionArg);
    logger.info(`Executing on workspace ${styles.dim(workspaceId)}...`);
    const result = await executeFunction({ target, prepared, arg: argValue });

    // 6. Display result
    if (jsonOutput) {
      logger.out(executionRecord(prepared, result));
    } else {
      if (result.success) {
        logger.success("Execution succeeded");
      } else {
        logger.error("Execution failed");
      }
      printExecutionDetails(prepared, result);
    }

    if (!result.success) {
      process.exit(1);
    }
  },
});

/**
 * Global option tokens that consume the following argv token as their value.
 * politty accepts both the kebab-case and camelCase spelling of every name.
 */
const valueTakingGlobalFlags: ReadonlySet<string> = new Set(
  extractFields(z.strictObject(commonArgs))
    .fields.filter((field) => field.type !== "boolean")
    .flatMap(flagTokensOf),
);

/**
 * Detect whether the command was invoked through the deprecated `test-run`
 * alias. politty resolves aliases before dispatch, so the invoked name is only
 * observable from the raw argv. Global options may sit anywhere before the
 * subcommand (`tailor function --json test-run`), so option tokens and any
 * values they consume are skipped; an option value is never read as a command
 * name.
 * @param argv - Process argv tokens
 * @returns true when `test-run` was the subcommand name under `function`
 */
function invokedViaTestRunAlias(argv: readonly string[]): boolean {
  const names: string[] = [];
  // argv[0] is the node binary and argv[1] the CLI entry point.
  for (let i = 2; i < argv.length && names.length < 2; i++) {
    const token = argv[i];
    if (token === undefined || token === "--") break;
    if (!token.startsWith("-")) {
      names.push(token);
      continue;
    }
    if (!token.includes("=") && valueTakingGlobalFlags.has(token)) i++;
  }
  return names[0] === "function" && names[1] === "test-run";
}

interface ArgOptions {
  /** `--arg` value */
  arg: string | undefined;
  /** `--arg-file` value */
  argFile: string | undefined;
  /** Whether `--watch` is set, which reads the argument file on every run instead */
  watch: boolean;
}

interface ResolvedArgOptions {
  /** Argument parsed from `--arg`, or from `--arg-file` outside watch mode */
  arg: FunctionArg | undefined;
  /** Absolute path of `--arg-file` */
  argFile: string | undefined;
}

/**
 * Validate `--arg` and `--arg-file` before anything contacts the Platform.
 * @param options - Raw option values
 * @returns The parsed argument and the argument file's absolute path
 */
function resolveArgOptions(options: ArgOptions): ResolvedArgOptions {
  if (options.arg !== undefined && options.argFile !== undefined) {
    throw CLIError({
      code: "FUNCTION_RUN_OPTIONS_CONFLICT",
      message: "Options --arg and --arg-file are mutually exclusive.",
      suggestion: "Pass the argument with only one of them.",
      command: "function run",
    });
  }
  if (options.arg !== undefined) {
    return { arg: parseArgOption(options.arg), argFile: undefined };
  }
  if (options.argFile === undefined) {
    return { arg: undefined, argFile: undefined };
  }
  const argFile = path.resolve(options.argFile);
  if (!options.watch) {
    return { arg: readFunctionArgFile(argFile), argFile };
  }
  if (!fs.existsSync(argFile)) {
    throw argFileNotFoundError(argFile);
  }
  return { arg: undefined, argFile };
}

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
  throw CLIError({
    code: "AUTH_CONFIG_REQUIRED",
    message: "Auth namespace is required.",
    suggestion: "Ensure tailor.config.ts has an auth config.",
  });
}

type ResolveMachineUserNameOptions = {
  cliMachineUser: string | undefined;
  cliMachineUserSource: MachineUserInputSource | undefined;
  profile: string | undefined;
  authConfig:
    | { name: string; external?: boolean; machineUsers?: Record<string, unknown> }
    | undefined;
};

/**
 * Resolve machine user name from CLI args, profile default, or config.
 * Priority: --machine-user / env > profile default > first key of config.auth.machineUsers > error
 * @param options - Resolution options
 * @returns Resolved machine user name
 */
async function resolveMachineUserName(options: ResolveMachineUserNameOptions): Promise<string> {
  const { cliMachineUser, cliMachineUserSource, profile, authConfig } = options;

  const resolved = await loadMachineUserName({
    machineUser: cliMachineUser,
    machineUserSource: cliMachineUserSource,
    profile,
  });
  if (resolved) {
    return resolved;
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
  throw CLIError({
    code: "MACHINE_USER_REQUIRED",
    message: "Machine user is required.",
    suggestion:
      "Provide --machine-user, set TAILOR_PLATFORM_MACHINE_USER_NAME, set a profile default with 'tailor profile update <profile> --machine-user <name>', or ensure tailor.config.ts has machine users configured.",
  });
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
