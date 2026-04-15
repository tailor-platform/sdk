import { timestampDate } from "@bufbuild/protobuf/wkt";
import { FunctionExecution_Type } from "@tailor-proto/tailor/v1/function_resource_pb";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient, type OperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { formatKeyValueTable } from "@/cli/shared/format";
import { functionExecutionStatusToString } from "@/cli/shared/function-execution";
import {
  downloadFunctionScript,
  scriptNameToRegistryName,
} from "@/cli/shared/function-script-download";
import { logger, styles } from "@/cli/shared/logger";
import { formatErrorWithSourcemap } from "@/cli/shared/stack-trace";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

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
  const [headerLine, ...frameLines] = composed.split("\n");
  return [
    `  ${styles.error(headerLine ?? "")}`,
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

interface PrintFunctionExecutionDetailOptions {
  detail: FunctionExecutionDetailInfo;
  /** Bundled script content for sourcemap-based stack trace mapping (optional) */
  bundledCode?: string | null;
}

/**
 * Print function execution detail in a human-readable format.
 * @param options - Print options
 * @param options.detail - Function execution detail info
 * @param options.bundledCode - Downloaded bundled script content (used for sourcemap mapping)
 */
function printFunctionExecutionDetail(options: PrintFunctionExecutionDetailOptions) {
  const { detail, bundledCode } = options;
  const formatDate = (date: Date | null): string => (date ? date.toISOString() : "N/A");

  const summaryData: [string, string][] = [
    ["id", detail.id],
    ["scriptName", detail.scriptName],
    ["status", detail.status],
    ["type", detail.type],
    ["startedAt", formatDate(detail.startedAt)],
    ["finishedAt", formatDate(detail.finishedAt)],
  ];
  logger.out(formatKeyValueTable(summaryData));

  if (detail.logs) {
    logger.log(styles.bold("\nLogs:"));
    for (const line of detail.logs.split("\n")) {
      logger.log(`  ${line}`);
    }
  }

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
   * When the execution started. Used to detect redeploys that happened
   * after the execution: if the current registry entry's `updatedAt`
   * is strictly newer, the downloaded bundle may differ from what was
   * actually executed, so mapping is skipped to avoid misleading
   * source locations. `FunctionExecution` carries no bundle version
   * today, so this timestamp comparison is the best available signal.
   */
  executionStartedAt: Date | null;
}

/**
 * Download a deployed function script for sourcemap mapping. Logs a
 * debug message on failure but never throws. Error display falls back
 * to a plain-text format when the script cannot be retrieved or when
 * the current registry entry is stale relative to the execution.
 *
 * `FunctionExecution.scriptName` does not match the function registry
 * name directly; `scriptNameToRegistryName` translates between the two
 * formats.
 * @param options - Lookup options
 * @param options.client - Operator client instance
 * @param options.workspaceId - Workspace ID
 * @param options.scriptName - Script name (matches FunctionExecution.scriptName)
 * @param options.executionType - Execution type used to discriminate registry name translation
 * @param options.executionStartedAt - Execution start timestamp used for staleness check
 * @returns Bundled script content, or null when unavailable / stale
 */
export async function downloadScriptForMapping(
  options: DownloadScriptForMappingOptions,
): Promise<string | null> {
  const { client, workspaceId, scriptName, executionType, executionStartedAt } = options;
  const registryName = scriptNameToRegistryName(scriptName, executionType);
  if (registryName == null) {
    logger.debug(
      `Script "${scriptName}" is not a deployed registry script (e.g. test-run or seed); skipping sourcemap mapping.`,
    );
    return null;
  }
  const result = await downloadFunctionScript({ client, workspaceId, name: registryName });
  if (result == null) {
    logger.debug(
      `Could not download script "${scriptName}" (registry: "${registryName}") for stack trace mapping; showing raw stack trace.`,
    );
    return null;
  }
  if (
    executionStartedAt != null &&
    result.registryUpdatedAt != null &&
    result.registryUpdatedAt.getTime() > executionStartedAt.getTime()
  ) {
    logger.debug(
      `Registry script "${registryName}" was updated at ${result.registryUpdatedAt.toISOString()} after execution started at ${executionStartedAt.toISOString()}; skipping sourcemap mapping to avoid stale source locations.`,
    );
    return null;
  }
  return result.code;
}

export const logsCommand = defineAppCommand({
  name: "logs",
  description: "List or get function execution logs.",
  notes: `When viewing a specific execution that failed, the command displays error details with the stack trace mapped back to original source files via the inline sourcemap (clickable file links and code snippets, matching \`function test-run\` output).

When the deployed script cannot be downloaded or the function has been redeployed since the execution, the command falls back to a plain-text error display to avoid showing misleading source locations.`,
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
  ],
  args: z
    .object({
      ...workspaceArgs,
      executionId: arg(z.string().optional(), {
        positional: true,
        description: "Execution ID (if provided, shows details with logs)",
      }),
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (args.executionId) {
      const { execution } = await client.getFunctionExecution({
        workspaceId,
        executionId: args.executionId,
      });

      if (!execution) {
        throw new Error(`Function execution '${args.executionId}' not found.`);
      }

      const detail = toFunctionExecutionDetailInfo(execution);

      if (args.json) {
        logger.out(detail);
      } else {
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
              executionStartedAt: detail.startedAt,
            })
          : null;
        printFunctionExecutionDetail({ detail, bundledCode });
      }
    } else {
      const executions = await fetchAll(async (pageToken, maxPageSize) => {
        const { executions, nextPageToken } = await client.listFunctionExecutions({
          workspaceId,
          pageToken,
          pageSize: maxPageSize,
        });
        return [executions, nextPageToken];
      });

      const logs = executions.map(toFunctionExecutionListInfo);

      if (logs.length === 0 && !args.json) {
        logger.info("No function execution logs found.");
        return;
      }
      logger.out(logs);
    }
  },
});
