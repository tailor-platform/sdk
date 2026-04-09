import { timestampDate } from "@bufbuild/protobuf/wkt";
import { FunctionExecution_Type } from "@tailor-proto/tailor/v1/function_resource_pb";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { formatKeyValueTable } from "@/cli/shared/format";
import { functionExecutionStatusToString } from "@/cli/shared/function-execution";
import { logger, styles } from "@/cli/shared/logger";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

interface FunctionExecutionListInfo {
  id: string;
  scriptName: string;
  status: string;
  type: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface FunctionExecutionDetailInfo {
  id: string;
  scriptName: string;
  status: string;
  type: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  logs: string;
  result: string;
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
    id: execution.id,
    scriptName: execution.scriptName,
    status: functionExecutionStatusToString(execution.status),
    type: functionExecutionTypeToString(execution.type),
    startedAt: execution.startedAt ? timestampDate(execution.startedAt) : null,
    finishedAt: execution.finishedAt ? timestampDate(execution.finishedAt) : null,
    logs: execution.logs,
    result: execution.result,
  };
}

/**
 * Print function execution detail in a human-readable format.
 * @param detail - Function execution detail info
 */
function printFunctionExecutionDetail(detail: FunctionExecutionDetailInfo) {
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
}

export const logsCommand = defineAppCommand({
  name: "logs",
  description: "List or get function execution logs.",
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
        printFunctionExecutionDetail(detail);
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
