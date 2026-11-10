import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import * as path from "pathe";
import { resolveResolverDefaultPermissionForFile } from "#/cli/services/resolver/default-permission";
import { buildOptionsOf, projectSourcesOf } from "#/cli/shared/build-options";
import { effectiveDateDefault } from "#/cli/shared/date-default";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import {
  executeScriptReportingStart,
  type ScriptExecutionResult,
} from "#/cli/shared/script-executor";
import { formatErrorWithSourcemap } from "#/cli/shared/stack-trace";
import { bundleForRun, type ResolvedMachineUser } from "./bundle";
import { detectFunctionType } from "./detect";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { Jsonifiable } from "type-fest";

/** The function `function run` executes and the context it runs in */
export interface FunctionRunTarget {
  /** Absolute path of the function file */
  filePath: string;
  /** Workflow job name to run */
  jobName: string | undefined;
  /** Loaded application config */
  config: LoadedConfig;
  /** Operator client */
  client: OperatorClient;
  /** Workspace the function runs in */
  workspaceId: string;
  /** Auth namespace of the machine user */
  authNamespace: string;
  /** Machine user the function runs as */
  machineUser: ResolvedMachineUser;
}

/** An argument for the function and how the user gave it */
export interface FunctionArg {
  /** Parsed argument */
  value: Jsonifiable;
  /** `--arg`, or the argument file's path, for messages */
  label: string;
}

/** A function ready to execute */
export interface PreparedFunction {
  /** Name the script runs under */
  scriptName: string;
  /** Bundled script code */
  bundledCode: string;
  /** Detected function type; undefined for a pre-bundled `.js` file */
  functionType: string | undefined;
  /** Detected function name; undefined for a pre-bundled `.js` file */
  functionName: string | undefined;
  /** False for a resolver without an input schema */
  acceptsArg: boolean;
  /** Absolute paths of the project files the script was built from */
  sourceFiles: string[];
}

interface PrepareFunctionOptions {
  /** Function to prepare */
  target: FunctionRunTarget;
  /** Receives progress messages */
  progress: (message: string) => void;
}

interface ExecuteFunctionOptions {
  /** Function to execute */
  target: FunctionRunTarget;
  /** Prepared script */
  prepared: PreparedFunction;
  /** Argument passed to the function */
  arg: Jsonifiable | undefined;
  /** Called with the execution ID once the Platform accepts the script */
  onStart?: (executionId: string) => void;
}

/**
 * Show a path relative to the working directory when it is inside it, absolute otherwise.
 * @param filePath - Absolute path
 * @returns Path to show the user
 */
export function displayPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") ? filePath : relative;
}

const ARG_FLAG = "--arg";

/**
 * Parse the JSON given with `--arg`.
 * @param text - JSON text
 * @returns Parsed argument
 */
export function parseArgOption(text: string): FunctionArg {
  return { value: parseArgJson(text, `Invalid ${ARG_FLAG} JSON`), label: ARG_FLAG };
}

function parseArgJson(text: string, failure: string): Jsonifiable {
  try {
    return JSON.parse(text) as Jsonifiable;
  } catch (error) {
    throw CLIError({
      code: "FUNCTION_ARG_INVALID",
      message: `${failure}: ${error instanceof Error ? error.message : error}`,
      command: "function run",
      cause: error,
    });
  }
}

/**
 * Create the error for an argument file that does not exist.
 * @param filePath - Absolute path of the argument file
 * @param cause - Error that revealed the file is missing
 * @returns CLI error to throw
 */
export function argFileNotFoundError(filePath: string, cause?: unknown): CLIError {
  return CLIError({
    code: "FILE_NOT_FOUND",
    message: `Argument file not found: ${filePath}`,
    cause,
  });
}

/**
 * Read and parse an argument file.
 * @param filePath - Absolute path of the argument file
 * @returns Parsed argument
 */
export function readFunctionArgFile(filePath: string): FunctionArg {
  const label = displayPath(filePath);
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw argFileNotFoundError(filePath, error);
    }
    throw CLIError({
      code: "FUNCTION_ARG_FILE_UNREADABLE",
      message: `Cannot read argument file ${filePath}: ${error instanceof Error ? error.message : error}`,
      cause: error,
    });
  }
  return { value: parseArgJson(text, `Invalid JSON in ${label}`), label };
}

/**
 * Detect and bundle the function, or read a pre-bundled `.js` file as is.
 * @param options - Function to prepare and where progress goes
 * @returns The script to execute
 */
export async function prepareFunction(options: PrepareFunctionOptions): Promise<PreparedFunction> {
  const { target, progress } = options;
  const { filePath, config } = target;

  if (filePath.endsWith(".js")) {
    const scriptName = path.basename(filePath);
    progress(`Using pre-bundled script ${styles.bold(scriptName)}`);
    return {
      scriptName,
      bundledCode: fs.readFileSync(filePath, "utf-8"),
      functionType: undefined,
      functionName: undefined,
      acceptsArg: true,
      sourceFiles: [filePath],
    };
  }

  progress(`Detecting function type from ${styles.path(displayPath(filePath))}`);
  const detected = await detectFunctionType({ filePath, jobName: target.jobName });
  progress(`Detected: ${styles.bold(detected.type)} ${styles.info(`"${detected.name}"`)}`);

  progress("Bundling...");
  const buildOptions = buildOptionsOf(config);
  const baseDir = path.dirname(config.path);
  const { bundledCode, scriptName, sourceFiles } = await bundleForRun({
    detected,
    sourceFile: filePath,
    baseDir,
    defaultPermission:
      detected.type === "resolver"
        ? resolveResolverDefaultPermissionForFile({
            config: config.resolver,
            filePath,
            baseDir,
            configPath: config.path,
          })
        : undefined,
    env: config.env ?? {},
    inlineSourcemap: buildOptions.inlineSourcemap,
    inlineSourcemapDependencySources: buildOptions.inlineSourcemapDependencySources,
    inlineSourcemapProjectSources: projectSourcesOf({ buildOptions, baseDir }),
    logLevel: buildOptions.logLevel,
    treeshake: buildOptions.treeshake,
    dateDefault: effectiveDateDefault(config),
    machineUser: target.machineUser,
    workspaceId: target.workspaceId,
  });
  progress(`Bundled as ${styles.bold(scriptName)}`);

  return {
    scriptName,
    bundledCode,
    functionType: detected.type,
    functionName: detected.name,
    acceptsArg: detected.type !== "resolver" || detected.hasInput === true,
    sourceFiles,
  };
}

/**
 * Decide the argument to send, warning when the function drops one the user gave.
 * @param prepared - Prepared script
 * @param arg - Argument the user gave
 * @returns The argument to send
 */
export function argumentToSend(
  prepared: PreparedFunction,
  arg: FunctionArg | undefined,
): Jsonifiable | undefined {
  if (!arg) return undefined;
  if (prepared.acceptsArg) return arg.value;
  logger.warn(
    `${arg.label} is ignored because this resolver has no input schema. Define "input" in your resolver to use ${arg.label}.`,
  );
  return undefined;
}

/**
 * Execute a prepared script on the Platform and wait for it to finish.
 * @param options - Script, argument, and start callback
 * @returns Execution result
 */
export async function executeFunction(
  options: ExecuteFunctionOptions,
): Promise<ScriptExecutionResult> {
  const { target, prepared, arg, onStart } = options;
  return await executeScriptReportingStart({
    client: target.client,
    workspaceId: target.workspaceId,
    name: prepared.scriptName,
    code: prepared.bundledCode,
    arg,
    invoker: create(AuthInvokerSchema, {
      namespace: target.authNamespace,
      machineUserName: target.machineUser.name,
    }),
    onStart,
  });
}

/**
 * Build the JSON output record of an execution.
 * @param prepared - Prepared script
 * @param result - Execution result
 * @returns Record written with `--json`
 */
export function executionRecord(prepared: PreparedFunction, result: ScriptExecutionResult) {
  return {
    success: result.success,
    scriptName: prepared.scriptName,
    functionType: prepared.functionType,
    functionName: prepared.functionName,
    logs: result.logs,
    result: result.result,
    error: result.error,
  };
}

/**
 * Print the logs, result, and error of an execution.
 * @param prepared - Prepared script, whose code maps the error's stack back to the sources
 * @param result - Execution result
 */
export function printExecutionDetails(
  prepared: PreparedFunction,
  result: ScriptExecutionResult,
): void {
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
    const formatted = formatErrorWithSourcemap(result.error, prepared.bundledCode, process.cwd());
    if (formatted) {
      logger.log(formatted);
    } else {
      logger.log(`  ${styles.error(result.error)}`);
    }
  }
}
