import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type Application,
  Subgraph_ServiceType,
} from "@tailor-platform/tailor-proto/application_resource_pb";
import { z } from "zod";
import { appArg, deploymentArgs, formatConfigArg, recoveryContextArgs } from "#/cli/shared/args";
import { fetchAllTolerant, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  type ConfigApplication,
  type ConfigApplications,
  configApplications,
  requireApplication,
  selectApplication,
} from "#/cli/shared/config-applications";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { formatCommandHint } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertDefined } from "#/utils/assert";
import { createWorkspaceNameTransformer, resolveWorkspaceFolderName } from "./workspace/transform";
import type { AuthOAuth2ClientSummary } from "@tailor-platform/tailor-proto/auth_resource_pb";

export interface ShowOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  /** Application to show when the config defines several. Defaults to the only application. */
  app?: string;
}

interface WorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  workspaceFolderName?: string;
  workspaceRegion?: string;
}

/** A service the application's GraphQL API exposes. */
export interface ShowSubgraphInfo {
  /** Kind of service: `tailordb`, `pipeline` (resolvers), `auth`, `idp`, `stateflow`, `ai`, or `unspecified`. */
  type: string;
  /** Name of the service. */
  namespace: string;
}

export interface ApplicationInfo {
  name: string;
  domain: string;
  url: string;
  auth: string;
  /** Services the application's GraphQL API exposes. */
  subgraphs: ShowSubgraphInfo[];
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

interface ShowApplicationInfo extends ApplicationInfo {
  aiGateways: AIGatewayInfo[];
  staticWebsites: ShowStaticWebsiteInfo[];
  /** `null` when the current credentials cannot list OAuth2 clients. */
  oauth2Clients: ShowOAuth2ClientInfo[] | null;
}

export interface ShowInfo extends ShowApplicationInfo, WorkspaceInfo {}

interface WorkspaceShowInfo extends WorkspaceInfo {
  applications: ShowApplicationInfo[];
}

const SUBGRAPH_TYPES = {
  [Subgraph_ServiceType.UNSPECIFIED]: "unspecified",
  [Subgraph_ServiceType.PIPELINE]: "pipeline",
  [Subgraph_ServiceType.STATEFLOW]: "stateflow",
  [Subgraph_ServiceType.TAILORDB]: "tailordb",
  [Subgraph_ServiceType.AUTH]: "auth",
  [Subgraph_ServiceType.AI]: "ai",
  [Subgraph_ServiceType.IDP]: "idp",
} as const satisfies Record<Subgraph_ServiceType, string>;

function subgraphType(serviceType: Subgraph_ServiceType): string {
  return serviceType in SUBGRAPH_TYPES ? SUBGRAPH_TYPES[serviceType] : "unspecified";
}

function applicationInfo(app: Application): ApplicationInfo {
  return {
    name: app.name,
    domain: app.domain,
    url: app.url,
    auth: app.authNamespace,
    subgraphs: app.subgraphs.map((subgraph) => ({
      type: subgraphType(subgraph.serviceType),
      namespace: subgraph.serviceNamespace,
    })),
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

type OAuth2ClientLister = (namespaceName: string) => Promise<AuthOAuth2ClientSummary[] | null>;

async function listOAuth2Clients(
  client: OperatorClient,
  workspaceId: string,
  namespaceName: string,
): Promise<AuthOAuth2ClientSummary[] | null> {
  try {
    return await fetchAllTolerant(async (pageToken, maxPageSize) => {
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
        `The current credentials cannot list OAuth2 clients in auth namespace "${namespaceName}", so oauth2Clients is null.`,
      );
      return null;
    }
    throw error;
  }
}

function oauth2ClientLister(client: OperatorClient, workspaceId: string): OAuth2ClientLister {
  const listed = new Map<string, Promise<AuthOAuth2ClientSummary[] | null>>();
  return (namespaceName) => {
    let clients = listed.get(namespaceName);
    if (clients === undefined) {
      clients = listOAuth2Clients(client, workspaceId, namespaceName);
      listed.set(namespaceName, clients);
    }
    return clients;
  };
}

async function fetchOAuth2Clients(
  listClients: OAuth2ClientLister,
  namespaceName: string,
  names: string[],
): Promise<ShowOAuth2ClientInfo[] | null> {
  if (!namespaceName || names.length === 0) {
    return [];
  }
  const deployed = await listClients(namespaceName);
  if (deployed === null) {
    return null;
  }
  const clientIds = new Map<string, string>();
  for (const oauth2Client of deployed) {
    clientIds.set(oauth2Client.name, oauth2Client.clientId);
  }
  return names.flatMap((name) => {
    const clientId = clientIds.get(name);
    return clientId === undefined ? [] : [{ name, clientId }];
  });
}

interface ShowTarget {
  client: OperatorClient;
  workspaceId: string;
  config: ConfigApplications;
  options: ShowOptions | undefined;
}

async function loadShowTarget(options?: ShowOptions): Promise<ShowTarget> {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });
  const config = configApplications(await loadConfigFile(options?.configPath));
  return { client, workspaceId, config, options };
}

async function fetchWorkspaceInfo(
  client: OperatorClient,
  workspaceId: string,
): Promise<WorkspaceInfo> {
  const { workspace } = await client.getWorkspace({ workspaceId });
  const workspaceFolderName = workspace ? await resolveWorkspaceFolderName(client, workspace) : "";
  return {
    workspaceId,
    workspaceName: workspace?.name ?? "",
    ...(workspaceFolderName ? { workspaceFolderName } : {}),
    workspaceRegion: workspace?.region ?? "",
  };
}

type SharedServices = Pick<ShowApplicationInfo, "aiGateways" | "staticWebsites">;

async function fetchSharedServices(target: ShowTarget): Promise<SharedServices> {
  const { client, workspaceId, config } = target;
  const [aiGateways, staticWebsites] = await Promise.all([
    fetchAIGateways(client, workspaceId, config.aiGatewayNames),
    fetchStaticWebsites(client, workspaceId, config.staticWebsiteNames),
  ]);
  return { aiGateways, staticWebsites };
}

interface FetchedApplication {
  info: ApplicationInfo;
  oauth2Clients: ShowApplicationInfo["oauth2Clients"];
}

async function getDeployedApplication(target: ShowTarget, name: string): Promise<Application> {
  const { client, workspaceId } = target;
  const resp = await client.getApplication({ workspaceId, applicationName: name });
  return assertDefined(resp.application, `application "${name}" not found in workspace`);
}

async function fetchApplication(
  deployed: Application,
  application: ConfigApplication,
  listClients: OAuth2ClientLister,
): Promise<FetchedApplication> {
  const oauth2Clients = await fetchOAuth2Clients(
    listClients,
    deployed.authNamespace,
    application.oauth2ClientNames,
  );
  return { info: applicationInfo(deployed), oauth2Clients };
}

async function showApplication(
  target: ShowTarget,
  application: ConfigApplication,
): Promise<ShowInfo> {
  const { client, workspaceId } = target;
  const [workspace, shared, fetched] = await Promise.all([
    fetchWorkspaceInfo(client, workspaceId),
    fetchSharedServices(target),
    getDeployedApplication(target, application.name).then((deployed) =>
      fetchApplication(deployed, application, oauth2ClientLister(client, workspaceId)),
    ),
  ]);
  const { name, ...info } = fetched.info;
  return { name, ...workspace, ...info, ...shared, oauth2Clients: fetched.oauth2Clients };
}

async function fetchIfDeployed(
  target: ShowTarget,
  application: ConfigApplication,
  listClients: OAuth2ClientLister,
): Promise<FetchedApplication | undefined> {
  const deployed = await getOrNull(() => getDeployedApplication(target, application.name));
  return deployed && fetchApplication(deployed, application, listClients);
}

function deployHint(target: ShowTarget): string {
  const configArg = formatConfigArg(target.options?.configPath);
  return formatCommandHint({
    command: "tailor",
    args: [
      "deploy",
      ...recoveryContextArgs({
        workspaceId: target.workspaceId,
        profile: target.options?.profile,
      }),
      ...(configArg ? [configArg] : []),
    ],
  });
}

async function showWorkspace(target: ShowTarget): Promise<WorkspaceShowInfo> {
  const { client, workspaceId } = target;
  const listClients = oauth2ClientLister(client, workspaceId);
  const [workspace, shared, applications] = await Promise.all([
    fetchWorkspaceInfo(client, workspaceId),
    fetchSharedServices(target),
    Promise.all(
      target.config.applications.map(async (application) => ({
        name: application.name,
        fetched: await fetchIfDeployed(target, application, listClients),
      })),
    ),
  ]);
  for (const { name, fetched } of applications) {
    if (fetched === undefined) {
      logger.warn(
        `Skipped application "${name}": it is not deployed yet, or the current credentials cannot read it. To deploy it, run ${deployHint(target)}.`,
      );
    }
  }
  return {
    ...workspace,
    applications: applications.flatMap(({ fetched }) =>
      fetched === undefined
        ? []
        : [{ ...fetched.info, ...shared, oauth2Clients: fetched.oauth2Clients }],
    ),
  };
}

/**
 * Show applied application information for the current workspace.
 * @param options - Show options
 * @returns Deployed application with its subgraphs, workspace, AI Gateway, static website, and OAuth2 client information
 */
export async function show(options?: ShowOptions): Promise<ShowInfo> {
  const target = await loadShowTarget(options);
  return showApplication(
    target,
    requireApplication({ config: target.config, name: options?.app, option: "the app option" }),
  );
}

const showWorkspaceNameTransformer = createWorkspaceNameTransformer(
  "workspaceName",
  "workspaceFolderName",
);
const workspaceDisplay = { workspaceName: showWorkspaceNameTransformer, workspaceFolderName: null };

export const showCommand = defineAppCommand({
  name: "show",
  description: "Show information about the deployed application.",
  args: z.strictObject({
    ...deploymentArgs,
    ...appArg("every deployed application"),
  }),
  run: async (args) => {
    const target = await loadShowTarget({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });
    const application = selectApplication(target.config, args.app);
    if (application) {
      logger.out(await showApplication(target, application), { display: workspaceDisplay });
      return;
    }

    const info = await showWorkspace(target);
    if (logger.jsonMode) {
      logger.out(info);
      return;
    }
    const { applications, ...workspace } = info;
    logger.out(workspace, { display: workspaceDisplay });
    for (const app of applications) {
      logger.out(app);
    }
  },
});
