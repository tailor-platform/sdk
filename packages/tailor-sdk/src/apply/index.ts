import ml from "multiline-ts";
import { type Client } from "@connectrpc/connect";

import { type WorkspaceConfig } from "@/config";
import { type OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { defineWorkspace } from "@/workspace";
import { fetchAll, initOperatorClient } from "./client";
import { applyApplication } from "./services/application";
import { applyAuth } from "./services/auth";
import { applyExecutor } from "./services/executor";
import { applyIdP } from "./services/idp";
import { applyPipeline } from "./services/pipeline";
import { applyStaticWebsite } from "./services/staticwebsite";
import { applyTailorDB } from "./services/tailordb";
import { readTailorctlConfig, type TailorctlConfig } from "./tailorctl";

export type ApplyOptions = {
  dryRun?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
};

export async function apply(
  config: Readonly<WorkspaceConfig>,
  options: ApplyOptions,
) {
  const workspace = defineWorkspace(config);

  // Build functions
  for (const app of workspace.applications) {
    for (const pipeline of app.pipelineResolverServices) {
      await pipeline.build();
    }
  }
  await workspace.executorService?.build();
  if (options.buildOnly) {
    return;
  }

  const tailorctlConfig = readTailorctlConfig();
  const client = await initOperatorClient(tailorctlConfig);
  const workspaceId = await fetchWorkspaceId(client, config, tailorctlConfig);

  // To handle dependencies correctly, apply each service in the same order as tailorctl.
  await applyTailorDB(client, workspaceId, workspace, options);
  await applyStaticWebsite(client, workspaceId, workspace, options);
  await applyIdP(client, workspaceId, workspace, options);
  await applyAuth(client, workspaceId, workspace, options);
  await applyPipeline(client, workspaceId, workspace, options);
  await applyApplication(client, workspaceId, workspace, options);
  await applyExecutor(client, workspaceId, workspace, options);

  if (options.dryRun) {
    console.log("Dry run enabled. No changes applied.");
  } else {
    console.log("Successfully applied changes.");
  }
}

async function fetchWorkspaceId(
  client: Client<typeof OperatorService>,
  config: Readonly<WorkspaceConfig>,
  tailorctlConfig?: TailorctlConfig,
) {
  const workspaces = await fetchAll(async (pageToken) => {
    const { workspaces, nextPageToken } = await client.listWorkspaces({
      pageToken,
    });
    return [workspaces, nextPageToken];
  });

  // When id is set, check if it exists in the list of workspaces.
  if (config.id !== undefined) {
    const workspace = workspaces.find((w) => w.id === config.id);
    if (!workspace) {
      throw new Error(
        ml`
          Workspace with ID ${config.id} not found.
          Please set the correct id in the sdk config, or select the correct workspace using tailorctl.
          `,
      );
    }
    return workspace.id;
  }

  // When id is not set, read id from the tailorctl config,
  // and verify that its name/region matches the sdk config.
  if (!tailorctlConfig) {
    throw new Error(
      ml`
        Workspace not found.
        Please set the correct id in the sdk config, or select the correct workspace using tailorctl.
        `,
    );
  }
  const workspace = workspaces.find(
    (w) => w.id === tailorctlConfig.workspaceid,
  );
  if (!workspace) {
    throw new Error(
      ml`
        Workspace with ID ${tailorctlConfig.workspaceid} not found.
        Please set the correct id in the sdk config, or select the correct workspace using tailorctl.
        `,
    );
  }
  if (workspace.name !== config.name) {
    throw new Error(
      ml`
        Workspace name mismatch: expected "${config.name}", got "${workspace.name}".
        Please set the correct id in the sdk config, or select the correct workspace using tailorctl.
        `,
    );
  }
  if (workspace.region !== config.region) {
    throw new Error(
      ml`
        Workspace region mismatch: expected ${config.region}, got ${workspace.region}.
        Please set the correct id in the sdk config, or select the correct workspace using tailorctl.
        `,
    );
  }
  return workspace.id;
}
