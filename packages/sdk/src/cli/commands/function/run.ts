/**
 * `tailor function run` command
 *
 * Bundles and executes a function on the Tailor Platform server
 * without deploying (applying) the application.
 */

import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { arg } from "@politty/zod";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import * as path from "pathe";
import { z } from "zod";
import {
  configArg,
  durationArg,
  formatConfigArg,
  parseDuration,
  readEnvFileArgs,
  recoveryContextArgs,
  resolveMachineUserInputSource,
  type EnvFileArgs,
  type MachineUserInputSource,
  workspaceArgs,
} from "#/cli/shared/args";
import { type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  configOf,
  machineUserAuths,
  machineUserConfig as machineUserConfigOf,
} from "#/cli/shared/config-file";
import { loadConfigFile, type LoadedConfigFile } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { CLIError, formatCommandHint, isCLIError } from "#/cli/shared/errors";
import { exitAfterOutput } from "#/cli/shared/exit-after-output";
import {
  awaitFunctionAsyncRun,
  startFunctionAsyncRun,
  type FunctionAsyncRunOutcome,
  type StartedFunctionAsyncRun,
} from "#/cli/shared/function-async-run";
import { logger, styles } from "#/cli/shared/logger";
import { resolveMachineUser } from "#/cli/shared/machine-user";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertPollInterval, assertWaitTimeout, pruneHint } from "#/cli/shared/workflow-run";
import { createRunId, createRunIdSuffix } from "#/cli/shared/workflow-run-labels";
import { sweepBeforeRun } from "#/cli/shared/workflow-run-sweep";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { type ResolvedMachineUser } from "./bundle";
import {
  argFileNotFoundError,
  argumentToSend,
  executeFunction,
  executionRecord,
  type ArgCommandName,
  type FunctionArg,
  type FunctionRunTarget,
  type PreparedFunction,
  parseArgOption,
  prepareFunction,
  printExecutionDetails,
  readFunctionArgFile,
  warnStartedJobsSkipped,
} from "./run-function";
import {
  SCRIPT_SNAPSHOT_FILE_NAME,
  loadScriptSchemaSnapshot,
  verifyScriptSchemaSnapshot,
} from "./script-scaffold";
import type { ScriptExecutionResult } from "#/cli/shared/script-executor";
import type { Jsonifiable } from "type-fest";

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
      description:
        "Deprecated: use `tailor workflow run --job`. Workflow job name to run (matches the `name` field of createWorkflowJob)",
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
    async: arg(z.boolean().default(false), {
      description:
        "Run the function as an asynchronous job, which is not bound by the time limit of a synchronous run, and wait for it to finish",
    }),
    interval: arg(durationArg.optional(), {
      alias: "i",
      description:
        "With --async, the polling interval while waiting, at most 1m (e.g., '3s', '500ms', '1m'); 3s when omitted",
    }),
    timeout: arg(durationArg.optional(), {
      alias: "t",
      description:
        "With --async, the maximum time to wait for the run, not a limit on the function; waits without a limit when omitted (e.g., '30s', '10m')",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication, or `<auth>/<name>` to name its Auth service too. Falls back to the active profile's default machine user.",
      env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
    }),
    ...configArg,
    "allow-schema-drift": arg(z.boolean().default(false), {
      description: "Run a scaffolded script even when its schema snapshot no longer matches",
    }),
  }),
  notes: `You can pass either a source file (\`.ts\`) or a pre-bundled file (\`.js\`).
When a \`.js\` file is provided, detection and bundling are skipped and the file is executed as-is.

A script scaffolded by \`function scaffold\` with a generated \`db.ts\` is checked against its \`db.snapshot.json\` before execution and refused on schema drift; pass \`--allow-schema-drift\` to run it anyway. The check compares table and field structure; hook and validator code changes are not detected.

\`--arg-file\` reads the argument from a JSON file instead of \`--arg\`; the two cannot be combined.

\`--watch\` runs the function, then runs it again each time you save the function file, a project file it imports, or the argument file. Without \`--arg-file\`, it creates a temporary argument file holding \`--arg\` (or \`{}\`), prints its path, and deletes it when you stop the command with Ctrl+C or close the terminal; edit that file to run the function with a new argument. An \`--arg-file\` must exist when the command starts, and its content is read on every run. With \`--watch\`, an argument file holding \`{}\` counts as no argument, so a resolver without an input schema runs without the warning that the argument is ignored.

Each run prints a \`-->\` line when the Platform accepts it and a \`<--\` line with \`[OK]\` or \`[FAILED]\` when it finishes, followed by its logs and result. Both lines carry the execution ID, which \`function logs\` accepts. When reading the argument file, loading or bundling the function, or the request to the Platform fails, the command prints an \`[ERROR]\` line and keeps watching. Until the function loads and bundles again, adding a file anywhere in the project also starts a run, so a file that an import names can be created after the import. A save during a run starts one more run after it finishes. With \`--json\`, each run writes one JSON object per line to stdout, including its \`executionId\`, and each failure writes an error object to stderr.

A synchronous run is stopped by the Platform when it takes too long. \`--async\` runs the function as an asynchronous job instead, which the Platform ends after 5 minutes. The command registers the function as a temporary resource, starts it, waits for it to finish, prints its logs and result the way a synchronous run does, and removes the temporary resource; when the Platform does not answer that removal within 30 seconds, the command gives up on it and warns that the resource may remain. \`--timeout\` limits how long the command waits, not how long the function may run; \`--interval\` sets how often it checks. When the wait stops (\`--timeout\` elapsed, or Ctrl+C), the function keeps running and its temporary resource stays in place: the command prints the run ID and the execution ID, \`tailor function logs <execution ID>\` reads the outcome, and \`tailor workflow prune\` removes the resource of runs that have finished. A function that is given no argument receives an empty object, as in a synchronous run. \`--async\` cannot be combined with \`--watch\` or \`--name\`; \`--timeout\` and \`--interval\` need \`--async\`.

Changes to \`tailor.config.ts\`, \`tsconfig.json\`, \`package.json\`, env files, and installed packages are not picked up; restart the command after changing them.

\`test-run\` is a deprecated alias of this command and will be removed in v3.

\`--name\` is deprecated and will be removed in v3. Use \`tailor workflow run <file> --job <name>\`, which also runs the jobs the job starts with \`.start()\`.

> [!WARNING]
> Workflow job \`.start()\` calls do not work in this mode, with or without \`--name\`.
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
      cmd: 'scripts/backfill.ts --async --arg \'{"from":"2026-01-01"}\'',
      desc: "Run a long script as an asynchronous job and wait for it to finish",
    },
    {
      cmd: "resolvers/add.ts --watch",
      desc: "Run a resolver again on every save, with its argument in a temporary file",
    },
    {
      cmd: 'build/resolvers/add.js --arg \'{"a":1,"b":2}\'',
      desc: "Run a pre-bundled .js file directly",
    },
  ],
  run: async (args) => {
    if (args.$invocation?.name === "test-run") {
      logger.warn(
        "`tailor function test-run` is deprecated and will be removed in v3. Use `tailor function run` instead.",
      );
    }

    const asyncWait = args.async ? await prepareAsyncRun(args) : undefined;
    assertAsyncOptionsAreAsync(args);

    if (args.name !== undefined) {
      logger.warn(
        "`tailor function run --name` is deprecated and will be removed in v3. Use `tailor workflow run <file> --job <name>` instead.",
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
      command: "function run",
    });

    // 2. Load config (required)
    const loaded = await loadConfigFile(args.config);
    const config = configOf(loaded);
    const { plugins } = loaded;

    // 3. Resolve workspace and machine user info (needed before bundling)
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    const { authNamespace, machineUser } = await resolveRunMachineUser({
      client,
      workspaceId,
      loaded,
      cliMachineUser: args["machine-user"],
      cliMachineUserSource: resolveMachineUserInputSource(args["machine-user"]),
      profile: args.profile,
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
            loaded,
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
    warnStartedJobsSkipped(target, prepared);
    const argValue = argumentToSend(prepared, functionArg);
    if (asyncWait) {
      await runAsync({
        target,
        prepared,
        arg: argValue,
        file: args.file,
        profile: args.profile,
        ...asyncWait,
      });
      return;
    }
    logger.info(`Executing on workspace ${styles.dim(workspaceId)}...`);
    const result = await executeFunction({ target, prepared, arg: argValue });

    // 6. Display result
    const suggestion =
      isTimeoutFailure(result) && args.name === undefined && (await isWritableProfile(args.profile))
        ? asyncRunSuggestion({
            file: fileForHint(filePath, args.file),
            ...readEnvFileArgs(process.argv.slice(2)),
            arg: args.arg,
            argFile: args["arg-file"],
            machineUser: args["machine-user"],
            allowSchemaDrift: args["allow-schema-drift"],
            config: args.config,
            workspaceId: args["workspace-id"],
            profile: args.profile,
          })
        : undefined;
    if (jsonOutput) {
      logger.out({ ...executionRecord(prepared, result), ...(suggestion && { suggestion }) });
    } else {
      if (result.success) {
        logger.success("Execution succeeded");
      } else {
        logger.error("Execution failed");
      }
      printExecutionDetails(prepared, result);
      if (suggestion) logger.info(suggestion);
    }

    if (!result.success) await exitAfterOutput(1);
  },
});

async function isWritableProfile(profile: string | undefined): Promise<boolean> {
  try {
    await assertWritable({ profile });
    return true;
  } catch (error) {
    if (isCLIError(error) && error.code === "PROFILE_READONLY") return false;
    throw error;
  }
}

function fileForHint(filePath: string, given: string): string {
  const relative = path.relative(process.cwd(), filePath) || given;
  return relative.startsWith("-") ? `./${relative}` : relative;
}

const TIMEOUT_ERROR = /Execution timed out after \d+ seconds?/i;

function isTimeoutFailure(result: ScriptExecutionResult): boolean {
  return !result.success && TIMEOUT_ERROR.test(result.error ?? "");
}

interface AsyncRunSuggestionParams extends EnvFileArgs {
  /** File given to the command, as the user can pass it again */
  file: string;
  arg: string | undefined;
  argFile: string | undefined;
  machineUser: string | undefined;
  allowSchemaDrift: boolean;
  config: string | undefined;
  workspaceId: string | undefined;
  profile: string | undefined;
}

/**
 * Build the hint that points a run stopped by the synchronous time limit to `--async`.
 * @param params - Options of the stopped run
 * @returns Hint text naming the command line to run again
 */
function asyncRunSuggestion(params: AsyncRunSuggestionParams): string {
  const configArg = formatConfigArg(params.config);
  const args = [
    "function",
    "run",
    params.file,
    "--async",
    ...params.envFiles.map((file) => `--env-file=${file}`),
    ...params.envFilesIfExists.map((file) => `--env-file-if-exists=${file}`),
    ...(params.arg === undefined ? [] : [`--arg=${params.arg}`]),
    ...(params.argFile === undefined ? [] : [`--arg-file=${params.argFile}`]),
    ...(params.machineUser === undefined ? [] : [`--machine-user=${params.machineUser}`]),
    ...(params.allowSchemaDrift ? ["--allow-schema-drift"] : []),
    ...(configArg === undefined ? [] : [configArg]),
    ...recoveryContextArgs({ workspaceId: params.workspaceId, profile: params.profile }),
  ];
  return `The Platform stops a synchronous run that takes too long. \`--async\` runs the function as an asynchronous job, which may run longer: ${formatCommandHint({ command: "tailor", args })}`;
}

interface AsyncOptions {
  async: boolean;
  watch: boolean;
  name?: string | undefined;
  interval?: string | undefined;
  timeout?: string | undefined;
  profile?: string | undefined;
}

interface AsyncWait {
  /** Poll interval in milliseconds */
  pollInterval: number;
  /** Longest wait in milliseconds; infinity waits until the run ends */
  timeoutMs: number;
}

function optionsConflict(message: string, suggestion: string) {
  return CLIError({
    code: "FUNCTION_RUN_OPTIONS_CONFLICT",
    message,
    suggestion,
    command: "function run",
  });
}

/**
 * Refuse a combination `--async` does not support, and check the wait it was given, before
 * anything is loaded or created.
 * @param options - Options of the command
 * @returns How often to poll and how long to wait
 */
async function prepareAsyncRun(options: AsyncOptions): Promise<AsyncWait> {
  if (options.watch) {
    throw optionsConflict(
      "Options --async and --watch are mutually exclusive.",
      "Use --watch for a synchronous run that repeats on every save, or --async for one long run.",
    );
  }
  if (options.name !== undefined) {
    throw optionsConflict(
      "Options --async and --name are mutually exclusive.",
      "Run a workflow job with `tailor workflow run <file> --job <name>`, which also runs the jobs it starts.",
    );
  }
  const pollInterval = parseDuration(options.interval ?? "3s");
  assertPollInterval(pollInterval, "function run");
  const timeoutMs =
    options.timeout === undefined ? Number.POSITIVE_INFINITY : parseDuration(options.timeout);
  assertWaitTimeout(timeoutMs, "function run");
  await assertWritable({ profile: options.profile });
  return { pollInterval, timeoutMs };
}

/**
 * Refuse the options that only mean something to an asynchronous run when it is not one.
 * @param options - Options of the command
 */
function assertAsyncOptionsAreAsync(options: AsyncOptions): void {
  if (options.async) return;
  for (const [flag, value] of [
    ["--timeout", options.timeout],
    ["--interval", options.interval],
  ] as const) {
    if (value !== undefined) {
      throw optionsConflict(
        `Option ${flag} needs --async.`,
        `Add --async to run the function as an asynchronous job, which ${flag} applies to.`,
      );
    }
  }
}

interface RunAsyncOptions extends AsyncWait {
  target: FunctionRunTarget;
  prepared: PreparedFunction;
  /** Argument to send, after the resolver's missing input schema has been taken into account */
  arg: Jsonifiable | undefined;
  /** File given to the command, named in the description of the registered function */
  file: string;
  profile: string | undefined;
}

/**
 * Run the prepared script as an asynchronous job, wait for it, and print its outcome.
 * @param options - What to run and how long to wait
 */
async function runAsync(options: RunAsyncOptions): Promise<void> {
  const { target, prepared } = options;
  const { client, workspaceId } = target;
  await sweepBeforeRun({ client, workspaceId, profile: options.profile });
  const runId = createRunId(new Date(), createRunIdSuffix());
  logger.info(`Starting run ${runId} on workspace ${styles.dim(workspaceId)}...`);

  const context = recoveryContextArgs({ workspaceId, profile: options.profile });
  const prune = pruneHint({ workspaceId, profile: options.profile });
  const pruneUnlabeled = pruneHint({
    workspaceId,
    profile: options.profile,
    includeUnlabeled: true,
  });
  const readHint = (executionId: string) =>
    formatCommandHint({ command: "tailor", args: ["function", "logs", executionId, ...context] });
  let inspect: string | undefined;
  const onInterrupt = () => {
    logger.warn(
      inspect === undefined
        ? `Stopped before the Platform confirmed run ${runId}. It may be running; ${pruneUnlabeled} removes its temporary resource once it has finished, even if it was stopped before the resource was labeled.`
        : `Stopped waiting. Run ${runId} keeps running; read it with ${inspect}, then ${prune}.`,
    );
    void exitAfterOutput(130);
  };
  process.once("SIGINT", onInterrupt);
  let started: StartedFunctionAsyncRun;
  let outcome: FunctionAsyncRunOutcome;
  try {
    started = await startFunctionAsyncRun({
      client,
      workspaceId,
      runId,
      code: prepared.bundledCode,
      description: `tailor function run --async ${path.basename(options.file)}`,
      invoker: create(AuthInvokerSchema, {
        namespace: target.authNamespace,
        machineUserName: target.machineUser.name,
      }),
      arg: options.arg,
    });
    logger.info(`Run ID: ${started.runId}  Execution ID: ${started.executionId}`);
    inspect = readHint(started.executionId);
    outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId,
      started,
      pollInterval: options.pollInterval,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
  }

  const runContext = { runId: started.runId, executionId: started.executionId };
  const read = readHint(started.executionId);
  if (outcome.state === "timedOut") {
    throw CLIError({
      code: "FUNCTION_RUN_WAIT_TIMEOUT",
      message: `Stopped waiting for run ${started.runId}; the function is still running.`,
      suggestion: `Read the outcome with ${read}. Afterwards, ${prune} removes the temporary resource.`,
      context: runContext,
    });
  }
  if (outcome.state === "outcomeUnavailable") {
    throw CLIError({
      code: "FUNCTION_RUN_OUTCOME_UNAVAILABLE",
      message: `Run ${started.runId} could not be read to its end: ${outcome.reason}`,
      suggestion: `Read it with ${read}. Afterwards, ${prune} removes the temporary resource.`,
      context: runContext,
    });
  }

  const { result } = outcome;
  if (logger.jsonMode) {
    logger.out({ ...executionRecord(prepared, result), ...runContext });
  } else {
    if (result.success) logger.success("Execution succeeded");
    else logger.error("Execution failed");
    printExecutionDetails(prepared, result);
  }
  if (!result.success) await exitAfterOutput(1);
}

interface ArgOptions {
  /** `--arg` value */
  arg: string | undefined;
  /** `--arg-file` value */
  argFile: string | undefined;
  /** Whether `--watch` is set, which reads the argument file on every run instead */
  watch: boolean;
  /** Command the options belong to, named in the conflict error */
  command: ArgCommandName;
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
export function resolveArgOptions(options: ArgOptions): ResolvedArgOptions {
  if (options.arg !== undefined && options.argFile !== undefined) {
    throw CLIError({
      code:
        options.command === "function run"
          ? "FUNCTION_RUN_OPTIONS_CONFLICT"
          : "WORKFLOW_RUN_OPTIONS_CONFLICT",
      message: "Options --arg and --arg-file are mutually exclusive.",
      suggestion: "Pass the argument with only one of them.",
      command: options.command,
    });
  }
  if (options.arg !== undefined) {
    return { arg: parseArgOption(options.arg, options.command), argFile: undefined };
  }
  if (options.argFile === undefined) {
    return { arg: undefined, argFile: undefined };
  }
  const argFile = path.resolve(options.argFile);
  if (!options.watch) {
    return { arg: readFunctionArgFile(argFile, options.command), argFile };
  }
  if (!fs.existsSync(argFile)) {
    throw argFileNotFoundError(argFile);
  }
  return { arg: undefined, argFile };
}

type ResolveRunMachineUserOptions = {
  client: OperatorClient;
  workspaceId: string;
  loaded: LoadedConfigFile;
  cliMachineUser: string | undefined;
  cliMachineUserSource: MachineUserInputSource | undefined;
  profile: string | undefined;
};

/** A machine user a function or workflow runs as, with its Auth service. */
export interface RunMachineUser {
  authNamespace: string;
  machineUser: ResolvedMachineUser;
}

function defaultMachineUser(loaded: LoadedConfigFile): string | undefined {
  const [only, ...others] = machineUserAuths(loaded);
  return only && others.length === 0 ? only.machineUsers?.[0] : undefined;
}

/**
 * Resolve the machine user a function or workflow runs as: the one given by `--machine-user`, the
 * environment, or the profile default, or else the first machine user of the config's only Auth
 * service. Its id comes from the Platform and its attributes from the config.
 * @param options - Machine user sources and the loaded config
 * @returns The machine user with its Auth service
 */
export async function resolveRunMachineUser(
  options: ResolveRunMachineUserOptions,
): Promise<RunMachineUser> {
  const { client, workspaceId, loaded, cliMachineUser, cliMachineUserSource, profile } = options;
  const value =
    (await loadMachineUserName({
      machineUser: cliMachineUser,
      machineUserSource: cliMachineUserSource,
      profile,
    })) ?? defaultMachineUser(loaded);
  if (!value) {
    const sources =
      "Provide --machine-user, set TAILOR_PLATFORM_MACHINE_USER_NAME, or set a profile default with 'tailor profile update <profile> --machine-user <name>'";
    throw CLIError({
      code: "MACHINE_USER_REQUIRED",
      message: "Machine user is required.",
      suggestion:
        machineUserAuths(loaded).length > 1
          ? `${sources}: the config defines several Auth services, so none of their machine users runs by default.`
          : `${sources}, or ensure tailor.config.ts has machine users configured.`,
    });
  }
  const { namespace: authNamespace, machineUserName: name } = resolveMachineUser({
    value,
    auths: machineUserAuths(loaded),
  });

  let id = "00000000-0000-0000-0000-000000000000";
  try {
    const { machineUser } = await client.getAuthMachineUser({
      workspaceId,
      authNamespace,
      name,
    });
    if (machineUser?.id) {
      id = machineUser.id;
    }
  } catch {
    logger.debug(`Could not fetch machine user "${name}" from server, using nil UUID`);
  }

  const machineUserConfig = machineUserConfigOf(loaded, authNamespace, name);
  let attributes: Record<string, unknown> | null = null;
  let attributeList: unknown[] = [];
  if (machineUserConfig && typeof machineUserConfig === "object") {
    const cfg = machineUserConfig as {
      attributes?: Record<string, unknown> | undefined;
      attributeList?: unknown[] | undefined;
    };
    attributes = cfg.attributes ?? null;
    attributeList = cfg.attributeList ?? [];
  }

  return { authNamespace, machineUser: { name, id, attributes, attributeList } };
}
