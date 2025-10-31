import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "citty";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "./args";
import { initOperatorClient } from "./client";
import { loadConfig } from "./config-loader";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "./context";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

interface AppInfo {
  name: string;
  domain: string;
  url: string;
  auth: string;
  cors: string[];
  allowedIpAddresses: string[];
  disableIntrospection: boolean;
  createdAt: string;
  updatedAt: string;
}

function appInfo(app: Application): AppInfo {
  return {
    name: app.name,
    domain: app.domain,
    url: app.url,
    auth: app.authNamespace,
    cors: app.cors,
    allowedIpAddresses: app.allowedIpAddresses,
    disableIntrospection: app.disableIntrospection,
    createdAt: app.createTime
      ? timestampDate(app.createTime).toISOString()
      : "N/A",
    updatedAt: app.updateTime
      ? timestampDate(app.updateTime).toISOString()
      : "N/A",
  };
}

export const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show applied application information",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
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
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    // Initialize client
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);

    // Get application info
    const { config } = await loadConfig(loadConfigPath(args.config));
    const resp = await client.getApplication({
      workspaceId,
      applicationName: config.name,
    });

    // Show application info
    printWithFormat(appInfo(resp.application!), format);
  }),
});
