import { defineCommand } from "citty";
import { table } from "table";
import {
  commonArgs,
  humanizeRelativeTime,
  jsonArgs,
  parseFormat,
  withCommonArgs,
} from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { type WorkflowListInfo, toWorkflowListInfo } from "./transform";

export interface WorkflowListOptions {
  workspaceId?: string;
  profile?: string;
}

export async function workflowList(
  options?: WorkflowListOptions,
): Promise<WorkflowListInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const workflows = await fetchAll(async (pageToken) => {
    const { workflows, nextPageToken } = await client.listWorkflows({
      workspaceId,
      pageToken,
    });
    return [workflows, nextPageToken];
  });

  return workflows.map(toWorkflowListInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all workflows",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parseFormat(args.json);

    const workflows = await workflowList({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (format === "json") {
      console.log(JSON.stringify(workflows));
    } else {
      if (workflows.length === 0) {
        console.log("No workflows found.");
        return;
      }
      const headers = ["name", "mainJob", "jobFunctions", "updatedAt"];
      const rows = workflows.map((w) => [
        w.name,
        w.mainJob,
        w.jobFunctions.toString(),
        humanizeRelativeTime(w.updatedAt),
      ]);
      process.stdout.write(table([headers, ...rows]));
    }
  }),
});
