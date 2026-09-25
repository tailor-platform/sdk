import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { deploymentArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertDefined } from "#/utils/assert";
import { createWorkspaceNameTransformer, resolveWorkspaceFolderName } from "./workspace/transform";
import type { OperatorClient } from "#/cli/shared/client";
import type { Application } from "@tailor-platform/tailor-proto/application_resource_pb";

export interface ShowOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

interface WorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  workspaceFolderName?: string;
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
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AIGatewayInfo {
  name: string;
  url: string;
}

export interface ShowInfo extends ApplicationInfo, WorkspaceInfo {
  aiGateways: AIGatewayInfo[];
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
    createdAt: app.createTime ? timestampDate(app.createTime) : null,
    updatedAt: app.updateTime ? timestampDate(app.updateTime) : null,
  };
}

async function fetchAIGateways(
  client: OperatorClient,
  workspaceId: string,
  names: string[],
): Promise<AIGatewayInfo[]> {
  const gateways = await Promise.all(
    names.map(async (name) => {
      try {
        const { aigateway } = await client.getAIGateway({ workspaceId, aigatewayName: name });
        return aigateway ? { name: aigateway.name, url: aigateway.url } : undefined;
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return undefined;
        }
        throw error;
      }
    }),
  );
  return gateways.filter((gateway): gateway is AIGatewayInfo => gateway !== undefined);
}

/**
 * Show applied application information for the current workspace.
 * @param options - Show options
 * @returns Deployed application, workspace, and AI Gateway information
 */
export async function show(options?: ShowOptions): Promise<ShowInfo> {
  // Load and validate options
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });

  const { config } = await loadConfig(options?.configPath);
  const aiGatewayNames = config.aiGateways?.length
    ? [...new Set(config.aiGateways.map((gateway) => gateway.name))]
    : [];
  const [workspaceResp, resp, aiGateways] = await Promise.all([
    client.getWorkspace({
      workspaceId,
    }),
    client.getApplication({
      workspaceId,
      applicationName: config.name,
    }),
    fetchAIGateways(client, workspaceId, aiGatewayNames),
  ]);
  const { name, ...appInfo } = applicationInfo(
    assertDefined(resp.application, `application "${config.name}" not found in workspace`),
  );
  const workspace = workspaceResp.workspace;
  const workspaceFolderName = workspace ? await resolveWorkspaceFolderName(client, workspace) : "";

  return {
    name,
    workspaceId,
    workspaceName: workspace?.name ?? "",
    ...(workspaceFolderName ? { workspaceFolderName } : {}),
    workspaceRegion: workspace?.region ?? "",
    ...appInfo,
    aiGateways,
  };
}

const showWorkspaceNameTransformer = createWorkspaceNameTransformer(
  "workspaceName",
  "workspaceFolderName",
);

export const showCommand = defineAppCommand({
  name: "show",
  description: "Show information about the deployed application.",
  args: z.strictObject({
    ...deploymentArgs,
  }),
  run: async (args) => {
    // Execute show logic
    const appInfo = await show({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.out(appInfo, {
      display: { workspaceName: showWorkspaceNameTransformer, workspaceFolderName: null },
    });
  },
});
