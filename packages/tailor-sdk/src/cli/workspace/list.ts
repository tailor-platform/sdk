import { defineCommand } from "citty";
import { consola } from "consola";
import { table } from "table";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";
import { readTailorctlConfig } from "../tailorctl";
import { fetchAll, initOperatorClient } from "../client";

interface WorkspaceInfo {
  id: string;
  name: string;
  region: string;
  created: string;
  updated: string;
}

const workspaceInfo = (ws: Workspace): WorkspaceInfo => {
  return {
    id: ws.id,
    name: ws.name,
    region: ws.region,
    created: ws.createTime ? timestampDate(ws.createTime).toISOString() : "N/A",
    updated: ws.updateTime ? timestampDate(ws.updateTime).toISOString() : "N/A",
  };
};

const validateFormat = (format: string) => {
  const validFormats = ["table", "json"];
  if (!validFormats.includes(format)) {
    return `Format must be one of: ${validFormats.join(", ")}`;
  }
};

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all Tailor Platform workspaces",
  },
  args: {
    format: {
      type: "string",
      description: "Output format (table, json)",
      alias: "f",
      default: "table",
    },
  },
  async run({ args }) {
    const tailorctlConfig = readTailorctlConfig();
    const client = await initOperatorClient(tailorctlConfig);

    // Validate inputs
    const formatError = validateFormat(args.format);
    if (formatError) {
      consola.error(`Invalid format: ${formatError}`);
      process.exit(1);
    }

    const workspaces = await fetchAll(async (pageToken) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
      });
      return [workspaces, nextPageToken];
    });
    const workspaceInfos = workspaces.map(workspaceInfo);
    switch (args.format) {
      case "table":
        workspaceInfos.forEach((ws) => {
          const t = table(
            Object.entries(ws).map(([key, value]) => [
              key.toUpperCase(),
              value,
            ]),
          );
          process.stdout.write(t);
        });
        break;
      case "json":
        console.log(JSON.stringify(workspaceInfos));
        break;
    }
  },
});
