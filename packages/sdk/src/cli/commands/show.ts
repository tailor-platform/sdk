import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { deploymentArgs } from "#/cli/shared/args";
import { fetchAllTolerant, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { type LoadedConfig, loadConfig } from "#/cli/shared/config-loader";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertDefined } from "#/utils/assert";
import { createWorkspaceNameTransformer, resolveWorkspaceFolderName } from "./workspace/transform";
import type { Application } from "@tailor-platform/tailor-proto/application_resource_pb";
import type { AuthOAuth2Client } from "@tailor-platform/tailor-proto/auth_resource_pb";

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

export interface ShowStaticWebsiteInfo {
  name: string;
  url: string;
  description: string;
}

export interface ShowOAuth2ClientInfo {
  name: string;
  clientId: string;
}

export interface ShowInfo extends ApplicationInfo, WorkspaceInfo {
  aiGateways: AIGatewayInfo[];
  staticWebsites: ShowStaticWebsiteInfo[];
  oauth2Clients: ShowOAuth2ClientInfo[];
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
      const resp = await getOrNull(() => client.getAIGateway({ workspaceId, aigatewayName: name }));
      return resp?.aigateway ? { name: resp.aigateway.name, url: resp.aigateway.url } : undefined;
    }),
  );
  return gateways.filter((gateway): gateway is AIGatewayInfo => gateway !== undefined);
}

async function fetchStaticWebsites(
  client: OperatorClient,
  workspaceId: string,
  names: string[],
): Promise<ShowStaticWebsiteInfo[]> {
  const websites = await Promise.all(
    names.map(async (name) => {
      const resp = await getOrNull(() => client.getStaticWebsite({ workspaceId, name }));
      const website = resp?.staticwebsite;
      return website
        ? { name: website.name, url: website.url, description: website.description }
        : undefined;
    }),
  );
  return websites.filter((website): website is ShowStaticWebsiteInfo => website !== undefined);
}

function oauth2ClientNames(auth: LoadedConfig["auth"]): string[] {
  if (!auth || "external" in auth) {
    return [];
  }
  return Object.keys(auth.oauth2Clients ?? {});
}

async function fetchOAuth2Clients(
  client: OperatorClient,
  workspaceId: string,
  namespaceName: string,
  names: string[],
): Promise<ShowOAuth2ClientInfo[]> {
  if (!namespaceName || names.length === 0) {
    return [];
  }
  let deployed: AuthOAuth2Client[];
  try {
    deployed = await fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [oauth2Clients, nextPageToken];
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.PermissionDenied) {
      logger.warn(
        `The current credentials cannot list OAuth2 clients in auth namespace "${namespaceName}", so none are shown.`,
      );
      return [];
    }
    throw error;
  }
  const clientIds = new Map<string, string>();
  for (const oauth2Client of deployed) {
    logger.registerSecret(oauth2Client.clientSecret);
    clientIds.set(oauth2Client.name, oauth2Client.clientId);
  }
  return names.flatMap((name) => {
    const clientId = clientIds.get(name);
    return clientId === undefined ? [] : [{ name, clientId }];
  });
}

/**
 * Show applied application information for the current workspace.
 * @param options - Show options
 * @returns Deployed application, workspace, AI Gateway, static website, and OAuth2 client information
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
  const staticWebsiteNames = config.staticWebsites?.length
    ? [...new Set(config.staticWebsites.map((website) => website.name))]
    : [];
  const applicationRequest = client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  const [workspaceResp, resp, aiGateways, staticWebsites, oauth2Clients] = await Promise.all([
    client.getWorkspace({
      workspaceId,
    }),
    applicationRequest,
    fetchAIGateways(client, workspaceId, aiGatewayNames),
    fetchStaticWebsites(client, workspaceId, staticWebsiteNames),
    applicationRequest.then(({ application }) =>
      fetchOAuth2Clients(
        client,
        workspaceId,
        application?.authNamespace ?? "",
        oauth2ClientNames(config.auth),
      ),
    ),
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
    staticWebsites,
    oauth2Clients,
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
