import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand, arg } from "politty";
import { z } from "zod";
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
    createdAt: app.createTime ? timestampDate(app.createTime).toISOString() : "N/A",
    updatedAt: app.updateTime ? timestampDate(app.updateTime).toISOString() : "N/A",
  };
}

/**
 * Show applied application information for the current workspace.
 * @param options - Show options
 * @returns Application information
 */
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

  // Get application
  const { config } = await loadConfig(options?.configPath);
  const resp = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  return applicationInfo(resp.application!);
}

export const showCommand = defineCommand({
  name: "show",
  description: "Show applied application information",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    "workspace-id": arg(z.string().optional(), {
      alias: "w",
      description: "Workspace ID",
    }),
    profile: arg(z.string().optional(), {
      alias: "p",
      description: "Workspace profile",
    }),
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
  }),
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
