import { stat } from "node:fs/promises";
import * as path from "pathe";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { fetchPaged, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withTimeout } from "#/cli/shared/progress";
import { withSpan } from "#/cli/telemetry/index";
import { assertDefined } from "#/utils/assert";
import { deployStaticWebsite } from "../staticwebsite/deploy";
import type {
  DeployedApplication,
  DeployedOAuth2Client,
  DeployedStaticWebsite,
} from "#/plugin/types";
import type { JsonValue } from "#/types/helpers";
import type { BuiltDeploymentTarget } from "./deployment-target";

interface RunDeployedHooksParams {
  client: OperatorClient;
  workspaceId: string;
  targets: readonly BuiltDeploymentTarget[];
}
interface DeployedHookOutput {
  application: string;
  pluginId: string;
  outputs: Record<string, JsonValue>;
}

interface LoadedTarget {
  application: DeployedApplication;
  siteUrls: { name: string; url: string }[];
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
  const [response, siteUrls, gateways, oauth2Clients] = await Promise.all([
    client.getApplication({ workspaceId, applicationName: name }),
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
  const application = assertDefined(
    response.application,
    `Application "${name}" not found after deploy`,
  );
  return {
    application: {
      ...(target.application.id ? { id: target.application.id } : {}),
      name,
      configPath: target.config.path,
      url: application.url,
      domain: application.domain,
      aiGateways: gateways,
      ...(namespace
        ? {
            auth: {
              namespace,
              oauth2Clients,
            },
          }
        : {}),
    },
    siteUrls,
  };
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

function findNonJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : path;
  if (typeof value !== "object" || ancestors.has(value)) return path;
  if (!Array.isArray(value) && !isPlainObject(value)) return path;
  const entries = Array.isArray(value)
    ? Array.from(value, (item: unknown, index) => [`${path}[${index}]`, item] as const)
    : Object.entries(value).map(([key, item]) => [`${path}.${key}`, item] as const);
  ancestors.add(value);
  try {
    for (const [itemPath, item] of entries) {
      const found = findNonJsonValue(item, itemPath, ancestors);
      if (found) return found;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

function invalidOutputs(path: string) {
  return CLIError({
    code: "DEPLOYED_HOOK_OUTPUTS_INVALID",
    message: `outputs are not JSON-serializable: ${path} is not a JSON value`,
  });
}

function copyJsonOutputs(outputs: Record<string, JsonValue>): Record<string, JsonValue> {
  let copy: Record<string, JsonValue>;
  try {
    copy = structuredClone(outputs);
  } catch {
    throw invalidOutputs(findNonJsonValue(outputs, "outputs", new Set()) ?? "outputs");
  }
  const path = findNonJsonValue(copy, "outputs", new Set());
  if (path) throw invalidOutputs(path);
  return copy;
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

  const loadOAuth2Clients = oauth2ClientLoader(client, workspaceId);
  const loaded = await Promise.all(
    targets.map((target) => loadDeployedTarget(client, workspaceId, target, loadOAuth2Clients)),
  ).catch((error: unknown) => {
    throw deployedHookFailure(
      "loading the deployed information for onDeployed hooks failed",
      error,
      hooks.map(({ plugin }) => plugin.id),
    );
  });
  const applications = loaded.map(({ application }) => application);
  const staticWebsites: Record<string, DeployedStaticWebsite> = Object.create(null);
  for (const { siteUrls } of loaded) {
    for (const site of siteUrls) {
      if (Object.hasOwn(staticWebsites, site.name))
        throw internalError(`Duplicate deployed static website "${site.name}"`);
      staticWebsites[site.name] = {
        ...site,
        publish: (dir) => publishStaticWebsite(client, workspaceId, site.name, dir),
      };
    }
  }
  const outputs: DeployedHookOutput[] = [];
  for (const [position, entry] of hooks.entries()) {
    const { target, index, plugin, hook } = entry;
    try {
      const result = await withSpan("deploy.onDeployed", async (span) => {
        span.setAttribute("plugin.id", plugin.id);
        span.setAttribute("app.name", target.application.name);
        return hook.call(plugin, {
          workspaceId,
          application: assertDefined(applications[index], "Deployed application missing"),
          applications,
          staticWebsites,
          configPath: target.config.path,
          pluginConfig: plugin.pluginConfig,
          logger: { info: logger.info, warn: logger.warn, success: logger.success },
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
        hooks.slice(position + 1).map(({ plugin }) => plugin.id),
      );
    }
  }
  return outputs;
}
