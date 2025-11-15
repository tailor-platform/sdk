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

export interface ShowOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export interface ApplicationInfo {
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

function applicationInfo(app: Application): ApplicationInfo {
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

export async function show(options?: ShowOptions): Promise<ApplicationInfo> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });
  const configPath = loadConfigPath(options?.configPath);

  // Get application
  const { config } = await loadConfig(configPath);
  const resp = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  return applicationInfo(resp.application!);
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
    // Validate cli specific args
    const format = parseFormat(args.format);

    // Execute show logic
    const appInfo = await show({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    // Show application
    printWithFormat(appInfo, format);
  }),
});
