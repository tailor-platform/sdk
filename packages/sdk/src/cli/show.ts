import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs } from "./args";
import { initOperatorClient } from "./client";
import { loadConfig } from "./config-loader";
import { loadAccessToken, loadWorkspaceId } from "./context";
import { logger } from "./utils/logger";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

export interface ShowOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export interface WorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  workspaceRegion?: string;
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

export interface ShowInfo extends ApplicationInfo, WorkspaceInfo {}

function applicationInfo(app: Application): ApplicationInfo {
  return {
    name: app.name,
    domain: app.domain,
    url: app.url,
    auth: app.authNamespace,
    cors: app.cors,
    allowedIpAddresses: app.allowedIpAddresses,
    disableIntrospection: app.disableIntrospection,
    createdAt: app.createTime ? timestampDate(app.createTime).toISOString() : "N/A",
    updatedAt: app.updateTime ? timestampDate(app.updateTime).toISOString() : "N/A",
  };
}

/**
 * Show applied application information for the current workspace.
 * @param options - Show options
 * @returns Application information
 */
export async function show(options?: ShowOptions): Promise<ShowInfo> {
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

  const { config } = await loadConfig(options?.configPath);
  const [workspaceResp, resp] = await Promise.all([
    client.getWorkspace({
      workspaceId,
    }),
    client.getApplication({
      workspaceId,
      applicationName: config.name,
    }),
  ]);
  const appInfo = applicationInfo(resp.application!);

  return {
    name: appInfo.name,
    workspaceId,
    workspaceName: workspaceResp.workspace?.name ?? "",
    workspaceRegion: workspaceResp.workspace?.region ?? "",
    domain: appInfo.domain,
    url: appInfo.url,
    auth: appInfo.auth,
    cors: appInfo.cors,
    allowedIpAddresses: appInfo.allowedIpAddresses,
    disableIntrospection: appInfo.disableIntrospection,
    createdAt: appInfo.createdAt,
    updatedAt: appInfo.updatedAt,
  };
}

export const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show applied application information",
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
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
  },
  run: withCommonArgs(async (args) => {
    // Execute show logic
    const appInfo = await show({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.out(appInfo);
  }),
});
