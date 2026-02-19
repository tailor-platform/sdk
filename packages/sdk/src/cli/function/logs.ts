import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  FunctionExecution_Status,
  FunctionExecution_Type,
} from "@tailor-proto/tailor/v1/function_resource_pb";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

interface FunctionExecutionListInfo {
  id: string;
  scriptName: string;
  status: string;
  type: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface ListFunctionLogsOptions {
  workspaceId?: string;
  profile?: string;
}

/**
 * Convert function execution status enum to string.
 * @param status - Function execution status enum value
 * @returns Status string representation
 */
function functionExecutionStatusToString(status: FunctionExecution_Status): string {
  switch (status) {
    case FunctionExecution_Status.RUNNING:
      return "RUNNING";
    case FunctionExecution_Status.SUCCESS:
      return "SUCCESS";
    case FunctionExecution_Status.FAILED:
      return "FAILED";
    default:
      return "UNSPECIFIED";
  }
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
 * List function execution logs in the workspace and return CLI-friendly info.
 * @param options - Function log listing options
 * @returns List of function execution logs
 */
async function listFunctionLogs(
  options?: ListFunctionLogsOptions,
): Promise<FunctionExecutionListInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const executions = await fetchAll(async (pageToken) => {
    const { executions, nextPageToken } = await client.listFunctionExecutions({
      workspaceId,
      pageToken,
    });
    return [executions, nextPageToken];
  });

  return executions.map(toFunctionExecutionListInfo);
}

export const logsCommand = defineCommand({
  name: "logs",
  description: "List function execution logs.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  }),
  run: withCommonArgs(async (args) => {
    const logs = await listFunctionLogs({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (logs.length === 0) {
      logger.info("No function execution logs found.");
      return;
    }

    logger.out(logs);
  }),
});
