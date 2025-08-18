import ml from "multiline-ts";
import { Client } from "@connectrpc/connect";

import { WorkspaceConfig } from "@/config";
import { OperatorService } from "@/gen/tailor/v1/service_pb";
import { ApplyOptions } from "@/generator/options";
import { defineWorkspace } from "@/workspace";
import { fetchAll, initOperatorClient } from "./client";
import { applyAuth } from "./services/auth";
import { applyIdP } from "./services/idp";
import { applyTailorDB } from "./services/tailordb";
import { readTailorctlConfig, TailorctlConfig } from "./tailorctl";

export async function apply(
  config: Readonly<WorkspaceConfig>,
  options: ApplyOptions,
) {
  const tailorctlConfig = readTailorctlConfig();
  const client = await initOperatorClient(tailorctlConfig);
  const workspaceId = await fetchWorkspaceId(client, config, tailorctlConfig);
  const workspace = defineWorkspace(config);

  // TODO(remiposo): Support other services
  await applyTailorDB(client, workspaceId, workspace, options);
  await applyIdP(client, workspaceId, workspace, options);
  await applyAuth(client, workspaceId, workspace, options);

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
