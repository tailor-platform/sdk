import * as nodeFs from "node:fs/promises";
import { stat } from "node:fs/promises";
import * as path from "pathe";
import { fetchPaged, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withTimeout } from "#/cli/shared/progress";
import { withSpan } from "#/cli/telemetry/index";
import { assertDefined } from "#/utils/assert";
import { deployStaticWebsite, staticWebsiteDeployTimeoutError } from "../staticwebsite/deploy";
import { sourceApplicationName, type BuiltDeploymentTarget } from "./deployment-target";
import { execPluginCommand } from "./plugin-exec";
import type { LoadedConfigFile } from "#/cli/shared/config-loader";
import type { DeployedApplication, DeployedOAuth2Client, Plugin } from "#/plugin/types";
import type { JsonValue } from "#/types/helpers";

interface LoadDeployedApplicationsParams {
  client: OperatorClient;
  workspaceId: string;
  targets: readonly BuiltDeploymentTarget[];
}
interface RunDeployedHooksParams extends LoadDeployedApplicationsParams {
  applications?: readonly DeployedApplication[];
  profile?: string;
}

interface DeployedHookOutput {
  application: string;
  pluginId: string;
  outputs: Record<string, JsonValue>;
}

async function loadSiteUrl(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<string> {
  const response = await client.getStaticWebsite({ workspaceId, name });
  const deployed = assertDefined(
    response.staticwebsite,
    `Static website "${name}" not found after deploy`,
  );
  if (!deployed.url)
    throw CLIError({
      code: "STATIC_WEBSITE_URL_NOT_ASSIGNED",
      message: `Static website "${name}" has no URL assigned yet`,
      suggestion: "Re-run the deploy once the static website's URL is available.",
    });
  return deployed.url;
}

type LoadOAuth2Clients = (namespace: string) => Promise<DeployedOAuth2Client[]>;

function oauth2ClientLoader(client: OperatorClient, workspaceId: string): LoadOAuth2Clients {
  const byNamespace = new Map<string, Promise<DeployedOAuth2Client[]>>();
  return (namespace) => {
    let loaded = byNamespace.get(namespace);
    if (!loaded) {
      loaded = fetchPaged(async (pageToken, pageSize) => {
        const response = await client.listAuthOAuth2Clients({
          workspaceId,
          namespaceName: namespace,
          pageToken,
          pageSize,
        });
        return [response.oauth2Clients, response.nextPageToken];
      }).then((oauth2Clients) => oauth2Clients.map(({ name, clientId }) => ({ name, clientId })));
      byNamespace.set(namespace, loaded);
    }
    return loaded;
  };
}

function byName<T extends { name: string }>(items: readonly T[]): Record<string, T> {
  const record: Record<string, T> = Object.create(null);
  for (const item of items) record[item.name] = item;
  return record;
}

async function loadDeployedTarget(
  client: OperatorClient,
  workspaceId: string,
  target: BuiltDeploymentTarget,
  loadOAuth2Clients: LoadOAuth2Clients,
): Promise<DeployedApplication[]> {
  const [sites, gateways] = await Promise.all([
    Promise.all(
      target.application.staticWebsiteServices.map(async (site) => ({
        name: site.name,
        url: await loadSiteUrl(client, workspaceId, site.name),
      })),
    ),
    Promise.all(
      target.application.aiGatewayServices.map(async (gateway) => {
        const response = await getOrNull(() =>
          client.getAIGateway({ workspaceId, aigatewayName: gateway.name }),
        );
        const deployed = assertDefined(
          response?.aigateway,
          `AI Gateway "${gateway.name}" not found after deploy`,
        );
        return { name: gateway.name, url: deployed.url };
      }),
    ),
  ]);
  const id = target.owner.kind === "application" ? target.owner.id : undefined;
  return Promise.all(
    target.applications.map(async ({ name, subgraphs, authNamespace }) => {
      const [response, oauth2Clients] = await Promise.all([
        subgraphs.length
          ? client.getApplication({ workspaceId, applicationName: name })
          : getOrNull(() => client.getApplication({ workspaceId, applicationName: name })),
        authNamespace ? loadOAuth2Clients(authNamespace) : [],
      ]);
      const application = subgraphs.length
        ? assertDefined(response?.application, `Application "${name}" not found after deploy`)
        : response?.application;
      return {
        ...(id ? { id } : {}),
        name,
        configPath: target.config.path,
        ...(application ? { url: application.url, domain: application.domain } : {}),
        aiGateways: gateways,
        staticWebsites: byName(sites),
        ...(authNamespace ? { auth: { namespace: authNamespace, oauth2Clients } } : {}),
      };
    }),
  );
}

/**
 * Load deployed URLs and public OAuth client IDs for each application in config order.
 * @param params - Deployed targets and workspace client
 * @returns Deployed application information without publish methods or client secrets
 */
export async function loadDeployedApplications(
  params: LoadDeployedApplicationsParams,
): Promise<DeployedApplication[]> {
  const { client, workspaceId, targets } = params;
  const loadOAuth2Clients = oauth2ClientLoader(client, workspaceId);
  const loaded = await Promise.all(
    targets.map((target) => loadDeployedTarget(client, workspaceId, target, loadOAuth2Clients)),
  );
  return loaded.flat();
}

function ignoreMissingPath(error: unknown): undefined {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") return undefined;
  throw error;
}

async function publishStaticWebsite(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  dir: string,
) {
  const resolved = path.resolve(dir);
  const info = await stat(resolved).catch(ignoreMissingPath);
  if (!info?.isDirectory())
    throw CLIError({
      code: "DIRECTORY_NOT_FOUND",
      message: `Static website publish directory does not exist or is not a directory: ${resolved}`,
    });
  return withTimeout(
    deployStaticWebsite(client, workspaceId, name, resolved, !logger.jsonMode),
    10 * 60_000,
    staticWebsiteDeployTimeoutError,
  );
}

function deployedHookFailure(what: string, error: unknown, notRun: readonly string[]) {
  const reason = error instanceof Error ? error.message : String(error);
  return CLIError({
    code: "DEPLOYED_HOOK_FAILED",
    message: `Platform resources were applied successfully, but ${what}: ${reason}${notRun.length ? `. Hooks not run: ${notRun.join(", ")}` : ""}`,
    suggestion:
      "Fix the error and run `tailor deploy` again. Unchanged resources are not re-applied.",
    cause: error,
  });
}

export function deployedHookLoadFailure(error: unknown, notRun: readonly string[]) {
  return deployedHookFailure(
    "loading the deployed information for onDeployed hooks failed",
    error,
    notRun,
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function invalidOutputs(path: string) {
  return CLIError({
    code: "DEPLOYED_HOOK_OUTPUTS_INVALID",
    message: `outputs are not JSON-serializable: ${path} is not a JSON value`,
  });
}

function toJsonValue(value: unknown, path: string, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) throw invalidOutputs(path);
  if (!Array.isArray(value) && !isPlainObject(value)) throw invalidOutputs(path);
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return Array.from(value, (item: unknown, index) =>
        toJsonValue(item, `${path}[${index}]`, ancestors),
      );
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toJsonValue(item, `${path}.${key}`, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

interface HookOwner {
  target: BuiltDeploymentTarget;
  plugin: Plugin;
}

/**
 * Name of the application whose config registers an onDeployed hook.
 * @param target - Target whose plugins have the hook
 * @returns The application name
 */
export function hookApplicationName(target: Pick<BuiltDeploymentTarget, "source">): string {
  const name = sourceApplicationName(target.source);
  if (name === undefined) throw internalError("A workspace config runs no onDeployed hooks");
  return name;
}

function hookLabel(hook: HookOwner): string {
  return `${hook.plugin.id} (app: ${hookApplicationName(hook.target)})`;
}

/**
 * Stop a deploy whose workspace config registers plugins with onDeployed hooks, which workspace
 * configs do not run yet, before a workspace is resolved or anything is built.
 * @param configs - Loaded configs of the deploy
 */
export function assertNoWorkspaceDeployedHooks(configs: readonly LoadedConfigFile[]): void {
  const pluginIds = configs.flatMap((config) =>
    config.kind === "workspace"
      ? config.plugins.filter((plugin) => plugin.onDeployed).map((plugin) => plugin.id)
      : [],
  );
  if (pluginIds.length === 0) return;
  throw CLIError({
    code: "DEPLOYED_HOOKS_UNSUPPORTED",
    message: `A workspace config does not run onDeployed hooks yet, but these plugins have one: ${pluginIds.join(", ")}.`,
    suggestion: "Remove those plugins from the workspace config to deploy it.",
    context: { pluginIds },
  });
}

function copyJsonOutputs(outputs: unknown): Record<string, JsonValue> {
  if (typeof outputs !== "object" || outputs === null || !isPlainObject(outputs))
    throw CLIError({
      code: "DEPLOYED_HOOK_OUTPUTS_INVALID",
      message: "outputs must be a plain object",
    });
  return toJsonValue(outputs, "outputs", new Set()) as Record<string, JsonValue>;
}

/**
 * Run deploy hooks in config and plugin registration order after resources are applied.
 * @param params - Deployed targets and workspace client
 * @returns Outputs supplied by the hooks
 */
export async function runDeployedHooks(
  params: RunDeployedHooksParams,
): Promise<DeployedHookOutput[]> {
  const { client, workspaceId, targets } = params;
  const hooks = targets.flatMap((target, index) =>
    target.plugins.flatMap((plugin) =>
      plugin.onDeployed ? [{ target, index, plugin, hook: plugin.onDeployed }] : [],
    ),
  );
  if (hooks.length === 0) return [];

  const applications =
    params.applications ??
    (await loadDeployedApplications(params).catch((error: unknown) => {
      throw deployedHookLoadFailure(error, hooks.map(hookLabel));
    }));
  const publishable = (application: DeployedApplication) => ({
    ...application,
    staticWebsites: byName(
      Object.values(application.staticWebsites).map((site) => {
        const { name, url } = assertDefined(site, "Deployed static website missing");
        return {
          name,
          url,
          publish: (dir: string) => publishStaticWebsite(client, workspaceId, name, dir),
        };
      }),
    ),
  });
  const outputs: DeployedHookOutput[] = [];
  for (const [position, entry] of hooks.entries()) {
    const { target, index, plugin, hook } = entry;
    try {
      const result = await withSpan("deploy.onDeployed", async (span) => {
        span.setAttribute("plugin.id", plugin.id);
        span.setAttribute("app.name", hookApplicationName(target));
        return hook.call(plugin, {
          workspaceId,
          ...(params.profile !== undefined && { profile: params.profile }),
          application: publishable(
            assertDefined(applications[index], "Deployed application missing"),
          ),
          applications,
          configPath: target.config.path,
          pluginConfig: plugin.pluginConfig,
          logger: { info: logger.info, warn: logger.warn, success: logger.success },
          exec: execPluginCommand,
          node: { fs: nodeFs, path },
        });
      });
      const hookOutputs = result?.outputs;
      if (hookOutputs !== undefined) {
        outputs.push({
          application: hookApplicationName(target),
          pluginId: plugin.id,
          outputs: copyJsonOutputs(hookOutputs),
        });
      }
    } catch (error) {
      throw deployedHookFailure(
        `the onDeployed hook of plugin "${plugin.id}" failed for app "${hookApplicationName(target)}"`,
        error,
        hooks.slice(position + 1).map(hookLabel),
      );
    }
  }
  return outputs;
}
