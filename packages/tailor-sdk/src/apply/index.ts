import ml from "multiline-ts";
import { type Client } from "@connectrpc/connect";

import { type WorkspaceConfig } from "@/config";
import { type OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { defineWorkspace } from "@/workspace";
import { fetchAll, initOperatorClient } from "./client";
import { applyApplication, planApplication } from "./services/application";
import { applyAuth, planAuth } from "./services/auth";
import { applyExecutor, planExecutor } from "./services/executor";
import { applyIdP, planIdP } from "./services/idp";
import { applyPipeline, planPipeline } from "./services/pipeline";
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import { readTailorctlConfig, type TailorctlConfig } from "./tailorctl";

export type ApplyOptions = {
  dryRun?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
};

export type ApplyPhase = "create-update" | "delete";

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

  // Phase 1: Plan
  const tailorDB = await planTailorDB(client, workspaceId, workspace);
  const staticWebsite = await planStaticWebsite(client, workspaceId, workspace);
  const idp = await planIdP(client, workspaceId, workspace);
  const auth = await planAuth(client, workspaceId, workspace);
  const pipeline = await planPipeline(client, workspaceId, workspace);
  const application = await planApplication(client, workspaceId, workspace);
  const executor = await planExecutor(client, workspaceId, workspace);
  if (options.dryRun) {
    console.log("Dry run enabled. No changes applied.");
    return;
  }

  // Phase 2: Apply Create/Update
  await applyTailorDB(client, tailorDB, "create-update");
  await applyStaticWebsite(client, staticWebsite, "create-update");
  await applyIdP(client, idp, "create-update");
  await applyAuth(client, auth, "create-update");
  await applyPipeline(client, pipeline, "create-update");
  await applyApplication(client, application, "create-update");
  await applyExecutor(client, executor, "create-update");

  // Phase 3: Apply Delete in reverse order
  await applyExecutor(client, executor, "delete");
  await applyApplication(client, application, "delete");
  await applyPipeline(client, pipeline, "delete");
  await applyAuth(client, auth, "delete");
  await applyIdP(client, idp, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");
  await applyTailorDB(client, tailorDB, "delete");

  console.log("Successfully applied changes.");
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
