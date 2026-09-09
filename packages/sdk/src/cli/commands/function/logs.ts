import { setTimeout } from "node:timers/promises";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { arg } from "@politty/zod";
import {
  type FunctionExecution,
  type FunctionExecution_Status,
  FunctionExecution_Type,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { z } from "zod";
import {
  durationArg,
  pagedLogArgs,
  parseDuration,
  toPageDirection,
  workspaceArgs,
} from "#/cli/shared/args";
import { fetchPaged, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { formatKeyValueTable } from "#/cli/shared/format";
import {
  colorizeFunctionExecutionStatus,
  formatFunctionLogEntry,
  formatFunctionLogLines,
  functionExecutionStatusToString,
  type FunctionLogEntryInfo,
  isFunctionExecutionTerminalStatus,
  toFunctionLogEntryInfo,
} from "#/cli/shared/function-execution";
import {
  downloadFunctionScript,
  scriptNameToRegistryName,
} from "#/cli/shared/function-script-download";
import { logger, styles } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { formatErrorWithSourcemap } from "#/cli/shared/stack-trace";
import { formatWaitError, isRetryableWaitError } from "#/cli/shared/wait-error";

interface FunctionExecutionListInfo {
  id: string;
  scriptName: string;
  status: string;
  type: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface FunctionExecutionErrorDisplay {
  name: string;
  message: string;
  stackTrace: string;
}

interface FunctionExecutionDetailInfo extends FunctionExecutionListInfo {
  logs: string;
  logEntries: FunctionLogEntryInfo[];
  result: string;
  error: FunctionExecutionErrorDisplay | null;
}

/**
 * Convert function execution type enum to string.
 * @param type - Function execution type enum value
 * @returns Type string representation
 */
function functionExecutionTypeToString(type: FunctionExecution_Type): string {
  switch (type) {
    case FunctionExecution_Type.STANDARD:
      return "STANDARD";
    case FunctionExecution_Type.JOB:
      return "JOB";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Transform FunctionExecution to FunctionExecutionListInfo for list display.
 * @param execution - FunctionExecution from proto
 * @returns Function execution list info
 */
function toFunctionExecutionListInfo(execution: FunctionExecution): FunctionExecutionListInfo {
  return {
    id: execution.id,
    scriptName: execution.scriptName,
    status: functionExecutionStatusToString(execution.status),
    type: functionExecutionTypeToString(execution.type),
    startedAt: execution.startedAt ? timestampDate(execution.startedAt) : null,
    finishedAt: execution.finishedAt ? timestampDate(execution.finishedAt) : null,
  };
}

/**
 * Transform FunctionExecution to FunctionExecutionDetailInfo for detail display.
 * @param execution - FunctionExecution from proto
 * @returns Function execution detail info
 */
function toFunctionExecutionDetailInfo(execution: FunctionExecution): FunctionExecutionDetailInfo {
  return {
    ...toFunctionExecutionListInfo(execution),
    logs: execution.logs,
    logEntries: execution.logEntries.map(toFunctionLogEntryInfo),
    result: execution.result,
    error: execution.error
      ? {
          name: execution.error.name,
          message: execution.error.message,
          stackTrace: execution.error.stackTrace,
        }
      : null,
  };
}

/**
 * Compose a V8-style error string from a FunctionErrorInfo so that it
 * can be parsed by `parseStackTrace`.
 *
 * `Error.prototype.stack` in V8 begins with `Name: message`, but the
 * platform may store only the frame lines; in that case prepend the
 * message line. When `stackTrace` is empty, return only `Name: message`.
 * @param error - Function error info from FunctionExecution
 * @returns Error string suitable for parseStackTrace
 */
export function composeExecutionErrorString(error: FunctionExecutionErrorDisplay): string {
  const { name, message, stackTrace } = error;
  if (!stackTrace) return `${name}: ${message}`;
  const firstLine = stackTrace.split("\n", 1)[0] ?? "";
  if (/^\s+at\s+/.test(firstLine)) {
    return `${name}: ${message}\n${stackTrace}`;
  }
  return stackTrace;
}

/**
 * Plain-text fallback used when sourcemap mapping is unavailable.
 * Shows `Name: message` then the raw stack trace lines (dimmed).
 *
 * Uses `composeExecutionErrorString` to produce a canonical
 * `Name: message\n<frames>` string first, so the header is never
 * duplicated when `stackTrace` already begins with `Name: message`.
 * @param error - Function error info from FunctionExecution
 * @returns Formatted fallback string for display
 */
function formatExecutionErrorFallback(error: FunctionExecutionErrorDisplay): string {
  const composed = composeExecutionErrorString(error);
  const [headerLine = "", ...frameLines] = composed.split("\n");
  return [
    `  ${styles.error(headerLine)}`,
    ...frameLines.map((line) => `  ${styles.dim(line)}`),
  ].join("\n");
}

/**
 * Format an execution error for display, applying sourcemap mapping
 * when bundled code is available.
 * @param error - Function error info from FunctionExecution
 * @param bundledCode - Downloaded bundled script content (may be null)
 * @returns Formatted error string for display
 */
export function formatExecutionError(
  error: FunctionExecutionErrorDisplay,
  bundledCode: string | null,
): string {
  if (bundledCode && error.stackTrace) {
    const errorString = composeExecutionErrorString(error);
    const formatted = formatErrorWithSourcemap(errorString, bundledCode, process.cwd());
    if (formatted) return formatted;
  }
  return formatExecutionErrorFallback(error);
}

const formatDate = (date: Date | null): string => (date ? date.toISOString() : "N/A");

/**
 * Print the execution summary table.
 * @param info - Function execution list info
 */
function printFunctionExecutionSummary(info: FunctionExecutionListInfo): void {
  const summaryData: [string, string][] = [
    ["id", info.id],
    ["scriptName", info.scriptName],
    ["status", info.status],
    ["type", info.type],
    ["startedAt", formatDate(info.startedAt)],
    ["finishedAt", formatDate(info.finishedAt)],
  ];
  logger.out(formatKeyValueTable(summaryData));
}

/**
 * Print the logs section.
 * @param detail - Function execution detail info
 */
function printFunctionExecutionLogs(detail: FunctionExecutionDetailInfo): void {
  const lines = formatFunctionLogLines(detail.logEntries, detail.logs);
  if (lines.length === 0) return;
  logger.log(styles.bold("\nLogs:"));
  for (const line of lines) {
    logger.log(`  ${line}`);
  }
}

interface PrintFunctionExecutionOutcomeOptions {
  detail: FunctionExecutionDetailInfo;
  /** Bundled script content for sourcemap-based stack trace mapping (optional) */
  bundledCode?: string | null;
}

/**
 * Print the result and error sections.
 * @param options - Print options
 * @param options.detail - Function execution detail info
 * @param options.bundledCode - Downloaded bundled script content (used for sourcemap mapping)
 */
function printFunctionExecutionOutcome(options: PrintFunctionExecutionOutcomeOptions): void {
  const { detail, bundledCode } = options;

  if (detail.result) {
    logger.log(styles.bold("\nResult:"));
    try {
      const parsed = JSON.parse(detail.result);
      logger.log(`  ${JSON.stringify(parsed, null, 2).split("\n").join("\n  ")}`);
    } catch {
      logger.log(`  ${detail.result}`);
    }
  }

  if (detail.error) {
    logger.log(styles.bold("\nError:"));
    logger.log(formatExecutionError(detail.error, bundledCode ?? null));
  }
}

interface FetchFunctionExecutionOptions {
  client: OperatorClient;
  workspaceId: string;
  executionId: string;
  /** Aborts the request, e.g. when a follow deadline passes mid-request */
  signal?: AbortSignal;
}

async function fetchFunctionExecution(
  options: FetchFunctionExecutionOptions,
): Promise<FunctionExecution> {
  const { execution } = await options.client.getFunctionExecution(
    { workspaceId: options.workspaceId, executionId: options.executionId },
    { signal: options.signal },
  );
  if (!execution) {
    throw new Error(`Function execution '${options.executionId}' not found.`);
  }
  return execution;
}

interface FollowFunctionExecutionOptions extends FetchFunctionExecutionOptions {
  /** Polling interval in milliseconds */
  interval: number;
  /** Maximum time to keep polling in milliseconds; unbounded when omitted */
  timeout?: number;
  /** Print the summary, new log entries, and status changes as they arrive */
  showProgress: boolean;
}

interface FollowFunctionExecutionResult {
  execution: FunctionExecution;
  /** Number of log entries already printed while following */
  printedEntries: number;
  /** Whether at least one poll was needed before the execution completed */
  followed: boolean;
}

/**
 * Poll a function execution until it reaches a terminal status, printing
 * newly arrived log entries on each poll. Log entries are cumulative, so
 * entries past the count already printed are the new ones.
 * @param options - Follow options
 * @returns Final execution and how many entries were printed
 */
async function followFunctionExecution(
  options: FollowFunctionExecutionOptions,
): Promise<FollowFunctionExecutionResult> {
  const { interval, timeout, showProgress } = options;
  const startedAt = Date.now();
  let printedEntries = 0;
  let lastStatus: FunctionExecution_Status | undefined;

  const remainingMs = (): number | undefined =>
    timeout === undefined ? undefined : timeout - (Date.now() - startedAt);
  const timedOut = (): boolean => {
    const remaining = remainingMs();
    return remaining !== undefined && remaining <= 0;
  };
  const timeoutError = (): Error => {
    const lastStatusText =
      lastStatus === undefined ? "unknown" : functionExecutionStatusToString(lastStatus);
    return new Error(
      `Timed out waiting for function execution '${options.executionId}' to complete. Last status: ${lastStatusText}.`,
    );
  };
  const sleep = async (): Promise<void> => {
    const remaining = remainingMs();
    if (remaining === undefined) {
      await setTimeout(interval);
      return;
    }
    if (remaining <= 0) throw timeoutError();
    await setTimeout(Math.min(interval, remaining));
  };

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const budget = remainingMs();
    if (budget !== undefined && budget <= 0) throw timeoutError();

    let execution: FunctionExecution;
    try {
      execution = await fetchFunctionExecution({
        ...options,
        signal: budget === undefined ? undefined : AbortSignal.timeout(budget),
      });
    } catch (error) {
      if (timedOut()) throw timeoutError();
      if (!isRetryableWaitError(error)) {
        throw error;
      }
      logger.warn(`Retrying function execution poll: ${formatWaitError(error)}`, {
        mode: "stream",
      });
      await sleep();
      continue;
    }

    if (showProgress) {
      if (lastStatus === undefined) {
        printFunctionExecutionSummary(toFunctionExecutionListInfo(execution));
        if (!isFunctionExecutionTerminalStatus(execution.status)) {
          logger.info("Following log entries until the execution completes (Ctrl+C to stop)", {
            mode: "stream",
          });
        }
      }
      if (execution.logEntries.length > printedEntries) {
        if (printedEntries === 0) {
          logger.log(styles.bold("\nLogs:"));
        }
        for (const entry of execution.logEntries.slice(printedEntries)) {
          logger.log(`  ${formatFunctionLogEntry(toFunctionLogEntryInfo(entry))}`);
        }
        printedEntries = execution.logEntries.length;
      }
      if (lastStatus !== undefined && execution.status !== lastStatus) {
        const status = colorizeFunctionExecutionStatus(
          functionExecutionStatusToString(execution.status),
        );
        logger.info(`Status: ${status}`, { mode: "stream" });
      }
    }
    const followed = lastStatus !== undefined;
    lastStatus = execution.status;

    if (isFunctionExecutionTerminalStatus(execution.status)) {
      return { execution, printedEntries, followed };
    }
    await sleep();
  }
}

interface DownloadScriptForMappingOptions {
  client: OperatorClient;
  workspaceId: string;
  /** FunctionExecution.scriptName (not the function registry name) */
  scriptName: string;
  /**
   * FunctionExecution.type. Used as the discriminator for the registry
   * name translation so that workflow job names containing dots are
   * not misread as resolver / seed scripts.
   */
  executionType: FunctionExecution_Type;
  /**
   * FunctionExecution.contentHash. When non-empty, the registry
   * download is pinned to this exact bundle so the stack trace maps
   * against the code that actually ran, regardless of subsequent
   * redeploys. Empty values cannot be mapped safely.
   */
  executionContentHash: string;
}

/**
 * Download a deployed function script for sourcemap mapping. Logs a
 * debug message on failure but never throws. Error display falls back
 * to a plain-text format when the script cannot be retrieved.
 *
 * When `executionContentHash` is non-empty, the download is pinned to
 * that exact bundle so mapping stays correct across redeploys. When
 * empty, mapping is skipped because the exact bundle cannot be
 * identified.
 *
 * `FunctionExecution.scriptName` does not match the function registry
 * name directly; `scriptNameToRegistryName` translates between the two
 * formats.
 * @param options - Lookup options
 * @param options.client - Operator client instance
 * @param options.workspaceId - Workspace ID
 * @param options.scriptName - Script name (matches FunctionExecution.scriptName)
 * @param options.executionType - Execution type used to discriminate registry name translation
 * @param options.executionContentHash - Content hash of the bundle that ran; pins the download when non-empty
 * @returns Bundled script content, or null when unavailable
 */
export async function downloadScriptForMapping(
  options: DownloadScriptForMappingOptions,
): Promise<string | null> {
  const { client, workspaceId, scriptName, executionType, executionContentHash } = options;
  const registryName = scriptNameToRegistryName(scriptName, executionType);
  if (registryName == null) {
    logger.debug(
      `Script "${scriptName}" is not a deployed registry script (e.g. function run or seed); skipping sourcemap mapping.`,
    );
    return null;
  }

  if (executionContentHash === "") {
    logger.debug(
      `Function execution "${scriptName}" has no contentHash; skipping sourcemap mapping because the exact bundle cannot be identified.`,
    );
    return null;
  }

  const pinned = await downloadFunctionScript({
    client,
    workspaceId,
    name: registryName,
    contentHash: executionContentHash,
  });
  if (pinned == null) {
    logger.debug(
      `Could not download pinned script "${scriptName}" (registry: "${registryName}", contentHash: "${executionContentHash}") for stack trace mapping; showing raw stack trace.`,
    );
    return null;
  }
  return pinned.code;
}

export const logsCommand = defineAppCommand({
  name: "logs",
  description: "List or get function execution logs.",
  notes: `Execution details include \`logEntries\`, the structured log lines (message, severity, timestamp) recorded while the function ran. They are available while the execution is still running, whereas the flat \`logs\` string is filled in only after completion. The human-readable view shows the structured entries when present and falls back to \`logs\` otherwise.

Use \`--follow\` to keep polling a running execution and print new log entries as they arrive until it completes. Polling continues while the execution is suspended at a wait point, and indefinitely unless \`--timeout\` is set. On environments where no structured entries are returned, \`--follow\` shows the flat \`logs\` string once the execution completes. With \`--json\`, \`--follow\` waits for completion and then emits the final execution details once.

When viewing a specific execution that failed, the command displays error details with the stack trace mapped back to your original source files (clickable file links and code snippets, matching \`function run\` output).

Stack traces are mapped only when the execution includes a content hash for the exact build that ran. If the content hash is missing or the build is no longer available, the command falls back to a plain-text error display.`,
  examples: [
    {
      cmd: "",
      desc: "List all function execution logs",
    },
    {
      cmd: "<execution-id>",
      desc: "Get execution details with logs",
    },
    {
      cmd: "--json",
      desc: "Output as JSON",
    },
    {
      cmd: "<execution-id> --json",
      desc: "Get execution details as JSON",
    },
    {
      cmd: "<execution-id> --follow",
      desc: "Stream log entries of a running execution until it completes",
    },
  ],
  args: z.strictObject({
    ...workspaceArgs,
    ...pagedLogArgs,
    "execution-id": arg(z.string().optional(), {
      positional: true,
      description: "Execution ID (if provided, shows details with logs)",
    }),
    follow: arg(z.boolean().default(false), {
      alias: "f",
      description:
        "Keep polling a running execution and print new log entries as they arrive (detail mode only)",
    }),
    interval: arg(durationArg.default("3s"), {
      alias: "i",
      description: "Polling interval for --follow (e.g., '3s', '500ms', '1m')",
    }),
    timeout: arg(durationArg.optional(), {
      alias: "t",
      description: "Maximum time to keep following (e.g., '30s', '10m'); unbounded by default",
    }),
  }),
  run: async (args) => {
    if (args.follow && !args.executionId) {
      throw new Error("--follow requires an execution ID.");
    }

    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    if (args.executionId) {
      const jsonOutput = logger.jsonMode || args.json;
      const fetchOptions = { client, workspaceId, executionId: args.executionId };
      const { execution, printedEntries, followed } = args.follow
        ? await followFunctionExecution({
            ...fetchOptions,
            interval: parseDuration(args.interval),
            timeout: args.timeout === undefined ? undefined : parseDuration(args.timeout),
            showProgress: !jsonOutput,
          })
        : {
            execution: await fetchFunctionExecution(fetchOptions),
            printedEntries: 0,
            followed: false,
          };

      const detail = toFunctionExecutionDetailInfo(execution);

      if (jsonOutput) {
        logger.out(detail);
        return;
      }

      if (!args.follow || followed) {
        printFunctionExecutionSummary(detail);
      }
      if (printedEntries === 0) {
        printFunctionExecutionLogs(detail);
      }
      // Download the deployed script when an error is present so the
      // stack trace can be mapped back to original sources via the
      // inline sourcemap. Failure (script removed, no permission, etc.)
      // is non-fatal; we fall back to a plain-text error display.
      const bundledCode = detail.error
        ? await downloadScriptForMapping({
            client,
            workspaceId,
            scriptName: detail.scriptName,
            executionType: execution.type,
            executionContentHash: execution.contentHash,
          })
        : null;
      printFunctionExecutionOutcome({ detail, bundledCode });
    } else {
      const pageDirection = toPageDirection(args.order);
      const executions = await fetchPaged(
        async (pageToken, pageSize) => {
          const { executions, nextPageToken } = await client.listFunctionExecutions({
            workspaceId,
            pageToken,
            pageSize,
            pageDirection,
          });
          return [executions, nextPageToken];
        },
        { limit: args.limit },
      );

      const logs = executions.map(toFunctionExecutionListInfo);

      if (logs.length === 0 && !args.json) {
        logger.info("No function execution logs found.");
        return;
      }
      logger.out(logs);
    }
  },
});
