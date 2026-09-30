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
import type { DeployedApplication, DeployedStaticWebsite } from "#/plugin/types";
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

async function loadDeployedTarget(
  client: OperatorClient,
  workspaceId: string,
  target: BuiltDeploymentTarget,
): Promise<LoadedTarget> {
  const name = target.application.name;
  const namespace = getApplicationAuthNamespace({
    authService: target.application.authService,
    config: target.config,
  });
  const [response, siteUrls, gateways, oauth2Clients] = await Promise.all([
    client.getApplication({ workspaceId, applicationName: name }),
    Promise.all(
      target.application.staticWebsiteServices.map(async (site) => {
        const response = await client.getStaticWebsite({ workspaceId, name: site.name });
        const deployed = assertDefined(
          response.staticwebsite,
          `Static website "${site.name}" not found after deploy`,
        );
        return { name: site.name, url: deployed.url };
      }),
    ),
    Promise.all(
      (target.config.aiGateways ?? []).map(async (gateway) => {
        const response = await getOrNull(() =>
          client.getAIGateway({ workspaceId, aigatewayName: gateway.name }),
        );
        return response?.aigateway
          ? { name: gateway.name, url: response.aigateway.url }
          : undefined;
      }),
    ),
    namespace
      ? fetchPaged(async (pageToken, pageSize) => {
          const response = await client.listAuthOAuth2Clients({
            workspaceId,
            namespaceName: namespace,
            pageToken,
            pageSize,
          });
          return [response.oauth2Clients, response.nextPageToken];
        })
      : [],
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
      aiGateways: gateways.filter((gateway) => gateway !== undefined),
      ...(namespace
        ? {
            auth: {
              namespace,
              oauth2Clients: oauth2Clients.map((client) => ({
                name: client.name,
                clientId: client.clientId,
              })),
            },
          }
        : {}),
    },
    siteUrls,
  };
}

async function publishStaticWebsite(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  dir: string,
) {
  const resolved = path.resolve(dir);
  const info = await stat(resolved).catch(() => undefined);
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

function assertJsonSerializable(outputs: Record<string, JsonValue>): void {
  try {
    JSON.stringify(outputs);
  } catch (error) {
    throw CLIError({
      code: "DEPLOYED_HOOK_OUTPUTS_INVALID",
      message: `outputs are not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    });
  }
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

  const loaded = await Promise.all(
    targets.map((target) => loadDeployedTarget(client, workspaceId, target)),
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
      if (result?.outputs !== undefined) assertJsonSerializable(result.outputs);
      if (result?.outputs !== undefined)
        outputs.push({
          application: target.application.name,
          pluginId: plugin.id,
          outputs: result.outputs,
        });
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
