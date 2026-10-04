import { stat } from "node:fs/promises";
import * as path from "pathe";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { fetchPaged, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withTimeout } from "#/cli/shared/progress";
import { withSpan } from "#/cli/telemetry/index";
import { assertDefined } from "#/utils/assert";
import { deployStaticWebsite } from "../staticwebsite/deploy";
import { execPluginCommand } from "./plugin-exec";
import type { DeployedApplication, DeployedOAuth2Client, Plugin } from "#/plugin/types";
import type { JsonValue } from "#/types/helpers";
import type { BuiltDeploymentTarget } from "./deployment-target";

interface LoadDeployedApplicationsParams {
  client: OperatorClient;
  workspaceId: string;
  targets: readonly BuiltDeploymentTarget[];
}
interface RunDeployedHooksParams extends LoadDeployedApplicationsParams {
  applications?: readonly DeployedApplication[];
}

interface DeployedHookOutput {
  application: string;
  pluginId: string;
  outputs: Record<string, JsonValue>;
}

interface LoadedTarget {
  application: DeployedApplication;
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
        for (const oauth2Client of response.oauth2Clients)
          logger.registerSecret(oauth2Client.clientSecret);
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
): Promise<LoadedTarget> {
  const name = target.application.name;
  const namespace = getApplicationAuthNamespace({
    authService: target.application.authService,
    config: target.config,
  });
  const [response, sites, gateways, oauth2Clients] = await Promise.all([
    target.application.subgraphs.length
      ? client.getApplication({ workspaceId, applicationName: name })
      : getOrNull(() => client.getApplication({ workspaceId, applicationName: name })),
    Promise.all(
      target.application.staticWebsiteServices.map(async (site) => ({
        name: site.name,
        url: await loadSiteUrl(client, workspaceId, site.name),
      })),
    ),
    Promise.all(
      (target.config.aiGateways ?? []).map(async (gateway) => {
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
    namespace ? loadOAuth2Clients(namespace) : [],
  ]);
  const application = target.application.subgraphs.length
    ? assertDefined(response?.application, `Application "${name}" not found after deploy`)
    : response?.application;
  return {
    application: {
      ...(target.application.id ? { id: target.application.id } : {}),
      name,
      configPath: target.config.path,
      ...(application ? { url: application.url, domain: application.domain } : {}),
      aiGateways: gateways,
      staticWebsites: byName(sites),
      ...(namespace
        ? {
            auth: {
              namespace,
              oauth2Clients,
            },
          }
        : {}),
    },
  };
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
  return loaded.map(({ application }) => application);
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
    "Deployment timed out after 10 minutes.",
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

function hookLabel(hook: HookOwner): string {
  return `${hook.plugin.id} (app: ${hook.target.application.name})`;
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
      throw deployedHookFailure(
        "loading the deployed information for onDeployed hooks failed",
        error,
        hooks.map(hookLabel),
      );
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
        span.setAttribute("app.name", target.application.name);
        return hook.call(plugin, {
          workspaceId,
          application: publishable(
            assertDefined(applications[index], "Deployed application missing"),
          ),
          applications,
          configPath: target.config.path,
          pluginConfig: plugin.pluginConfig,
          logger: { info: logger.info, warn: logger.warn, success: logger.success },
          exec: execPluginCommand,
        });
      });
      const hookOutputs = result?.outputs;
      if (hookOutputs !== undefined) {
        outputs.push({
          application: target.application.name,
          pluginId: plugin.id,
          outputs: copyJsonOutputs(hookOutputs),
        });
      }
    } catch (error) {
      throw deployedHookFailure(
        `the onDeployed hook of plugin "${plugin.id}" failed for app "${target.application.name}"`,
        error,
        hooks.slice(position + 1).map(hookLabel),
      );
    }
  }
  return outputs;
}
