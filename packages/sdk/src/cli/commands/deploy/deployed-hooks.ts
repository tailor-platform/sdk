import * as nodeFs from "node:fs/promises";
import { stat } from "node:fs/promises";
import * as path from "pathe";
import { fetchPaged, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withTimeout } from "#/cli/shared/progress";
import { defineUnambiguousContextField } from "#/cli/shared/unambiguous-context-field";
import { withSpan } from "#/cli/telemetry/index";
import { assertDefined } from "#/utils/assert";
import { deployStaticWebsite, staticWebsiteDeployTimeoutError } from "../staticwebsite/deploy";
import { sourceApplicationName, type BuiltDeploymentTarget } from "./deployment-target";
import { execPluginCommand } from "./plugin-exec";
import type {
  DeployedApplication,
  DeployedContext,
  DeployedOAuth2Client,
  DeployedStaticWebsite,
  Plugin,
  PublishableStaticWebsite,
} from "#/plugin/types";
import type { JsonValue } from "#/types/helpers";

interface LoadDeployedApplicationsParams {
  client: OperatorClient;
  workspaceId: string;
  targets: readonly BuiltDeploymentTarget[];
}
interface RunDeployedHooksParams extends LoadDeployedApplicationsParams {
  deployed?: readonly DeployedTarget[] | undefined;
  profile?: string | undefined;
}

/** Deployed information of one target: its static websites and the applications it deploys. */
export interface DeployedTarget {
  staticWebsites: Record<string, DeployedStaticWebsite>;
  applications: DeployedApplication[];
}

interface DeployedHookOutput {
  /** Application whose defineConfig() config registers the hook; absent for a workspace config. */
  application?: string;
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
): Promise<DeployedTarget> {
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
  const staticWebsites = byName(sites);
  const applications = await Promise.all(
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
        staticWebsites,
        ...(authNamespace ? { auth: { namespace: authNamespace, oauth2Clients } } : {}),
      };
    }),
  );
  return { staticWebsites, applications };
}

/**
 * Load deployed URLs and public OAuth client IDs for each target and its applications in config order.
 * @param params - Deployed targets and workspace client
 * @returns Deployed information per target, without publish methods or client secrets
 */
export function loadDeployedTargets(
  params: LoadDeployedApplicationsParams,
): Promise<DeployedTarget[]> {
  const { client, workspaceId, targets } = params;
  const loadOAuth2Clients = oauth2ClientLoader(client, workspaceId);
  return Promise.all(
    targets.map((target) => loadDeployedTarget(client, workspaceId, target, loadOAuth2Clients)),
  );
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
    message: `Platform resources were applied successfully, but ${what}: ${reason}`,
    details: notRun.length ? `Hooks not run: ${notRun.join(", ")}` : undefined,
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

/** An onDeployed hook, named by its plugin and, for a defineConfig() config, its application. */
export interface DeployedHookRef {
  /** Application whose defineConfig() config registers the hook; absent for a workspace config. */
  application?: string;
  pluginId: string;
}

/**
 * Reference to an onDeployed hook of a target's plugin.
 * @param target - Target whose config registers the plugin
 * @param plugin - Plugin with the hook
 * @returns The plugin id, with the application for a defineConfig() config
 */
export function deployedHookRef(
  target: Pick<BuiltDeploymentTarget, "source">,
  plugin: Pick<Plugin, "id">,
): DeployedHookRef {
  const application = sourceApplicationName(target.source);
  return { ...(application !== undefined && { application }), pluginId: plugin.id };
}

/**
 * Label of an onDeployed hook for messages.
 * @param hook - The hook
 * @returns The plugin id with the application, or with "workspace config"
 */
export function deployedHookLabel(hook: DeployedHookRef): string {
  return `${hook.pluginId} (${hook.application === undefined ? "workspace config" : `app: ${hook.application}`})`;
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
      plugin.onDeployed
        ? [{ target, index, plugin, hook: plugin.onDeployed, ref: deployedHookRef(target, plugin) }]
        : [],
    ),
  );
  if (hooks.length === 0) return [];

  const deployed =
    params.deployed ??
    (await loadDeployedTargets(params).catch((error: unknown) => {
      throw deployedHookLoadFailure(
        error,
        hooks.map(({ ref }) => deployedHookLabel(ref)),
      );
    }));
  const publishableSites = (
    sites: Readonly<Partial<Record<string, DeployedStaticWebsite>>>,
  ): Record<string, PublishableStaticWebsite> =>
    byName(
      Object.values(sites).map((site) => {
        const { name, url } = assertDefined(site, "Deployed static website missing");
        return {
          name,
          url,
          publish: (dir: string) => publishStaticWebsite(client, workspaceId, name, dir),
        };
      }),
    );
  const applications = deployed.flatMap((entry) => entry.applications);
  const outputs: DeployedHookOutput[] = [];
  for (const [position, entry] of hooks.entries()) {
    const { target, index, plugin, hook, ref } = entry;
    const deployedTarget = assertDefined(deployed[index], "Deployed target missing");
    try {
      const result = await withSpan("deploy.onDeployed", async (span) => {
        span.setAttribute("plugin.id", plugin.id);
        if (ref.application !== undefined) span.setAttribute("app.name", ref.application);
        const context: DeployedContext = defineUnambiguousContextField(
          {
            workspaceId,
            ...(params.profile !== undefined && { profile: params.profile }),
            applications,
            staticWebsites: publishableSites(deployedTarget.staticWebsites),
            configPath: target.config.path,
            pluginConfig: plugin.pluginConfig,
            logger: { info: logger.info, warn: logger.warn, success: logger.success },
            exec: execPluginCommand,
            node: { fs: nodeFs, path },
          },
          {
            key: "application",
            candidates: byName(
              deployedTarget.applications.map((application) => ({
                ...application,
                staticWebsites: publishableSites(application.staticWebsites),
              })),
            ),
            candidatesLabel: "applications",
            replacement: ["applications", "staticWebsites"],
            required: true,
          },
        );
        return hook.call(plugin, context);
      });
      const hookOutputs = result?.outputs;
      if (hookOutputs !== undefined) {
        outputs.push({ ...ref, outputs: copyJsonOutputs(hookOutputs) });
      }
    } catch (error) {
      throw deployedHookFailure(
        `the onDeployed hook of plugin "${plugin.id}" failed for ${ref.application === undefined ? "the workspace config" : `app "${ref.application}"`}`,
        error,
        hooks.slice(position + 1).map((next) => deployedHookLabel(next.ref)),
      );
    }
  }
  return outputs;
}
