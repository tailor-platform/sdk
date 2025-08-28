import { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  CreateApplicationRequestSchema,
  DeleteApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-proto/tailor/v1/application_pb";
import {
  Subgraph_ServiceType,
  SubgraphSchema,
} from "@tailor-proto/tailor/v1/application_resource_pb";
import { ApplyOptions } from "@/generator/options";
import { Workspace } from "@/workspace";
import { ChangeSet } from ".";
import { fetchAll, OperatorClient } from "../client";

export async function applyApplication(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
  options: ApplyOptions,
) {
  const changeSet = await planApplication(client, workspaceId, workspace);
  if (options.dryRun) {
    return;
  }

  // Applications
  for (const create of changeSet.creates) {
    await client.createApplication(create.request);
  }
  for (const update of changeSet.updates) {
    await client.updateApplication(update.request);
  }
  for (const del of changeSet.deletes) {
    await client.deleteApplication(del.request);
  }
}

type CreateApplication = {
  name: string;
  request: MessageInitShape<typeof CreateApplicationRequestSchema>;
};

type UpdateApplication = {
  name: string;
  request: MessageInitShape<typeof UpdateApplicationRequestSchema>;
};

type DeleteApplication = {
  name: string;
  request: MessageInitShape<typeof DeleteApplicationRequestSchema>;
};

async function planApplication(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
) {
  const changeSet: ChangeSet<
    CreateApplication,
    UpdateApplication,
    DeleteApplication
  > = new ChangeSet("Applications");

  const existingApplications = await fetchAll(async (pageToken) => {
    try {
      const { applications, nextPageToken } = await client.listApplications({
        workspaceId,
        pageToken,
      });
      return [applications, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingNameSet = new Set<string>();
  existingApplications.forEach((application) => {
    existingNameSet.add(application.name);
  });
  for (const application of workspace.applications) {
    let authNamespace: string | undefined;
    let authIdpConfigName: string | undefined;
    if (application.authService && application.authService.config) {
      authNamespace = application.authService.config.namespace;

      const idProviderConfigs =
        application.authService.config.idProviderConfigs;
      if (idProviderConfigs && idProviderConfigs.length > 0) {
        authIdpConfigName = idProviderConfigs[0].Name;
      }
    }

    if (existingNameSet.has(application.name)) {
      changeSet.updates.push({
        name: application.name,
        request: {
          workspaceId,
          applicationName: application.name,
          authNamespace,
          authIdpConfigName,
          cors: application.config.cors,
          subgraphs: application.subgraphs.map((subgraph) =>
            protoSubgraph(subgraph),
          ),
          allowedIpAddresses: application.config.allowedIPAddresses,
          disableIntrospection: application.config.disableIntrospection,
        },
      });
      existingNameSet.delete(application.name);
    } else {
      changeSet.creates.push({
        name: application.name,
        request: {
          workspaceId,
          applicationName: application.name,
          authNamespace,
          authIdpConfigName,
          cors: application.config.cors,
          subgraphs: application.subgraphs.map((subgraph) =>
            protoSubgraph(subgraph),
          ),
          allowedIpAddresses: application.config.allowedIPAddresses,
          disableIntrospection: application.config.disableIntrospection,
        },
      });
    }
  }
  existingNameSet.forEach((name) => {
    changeSet.deletes.push({
      name,
      request: {
        workspaceId,
        applicationName: name,
      },
    });
  });

  changeSet.print();
  return changeSet;
}

function protoSubgraph(
  subgraph: Readonly<{ Type: string; Name: string }>,
): MessageInitShape<typeof SubgraphSchema> {
  // TODO(remiposo): Make it type-safe
  let serviceType: Subgraph_ServiceType;
  switch (subgraph.Type) {
    case "tailordb":
      serviceType = Subgraph_ServiceType.TAILORDB;
      break;
    case "pipeline":
      serviceType = Subgraph_ServiceType.PIPELINE;
      break;
    case "idp":
      serviceType = Subgraph_ServiceType.IDP;
      break;
    case "auth":
      serviceType = Subgraph_ServiceType.AUTH;
      break;
    default:
      throw new Error(`Unknown subgraph type: ${subgraph.Type}`);
  }
  return {
    serviceType,
    serviceNamespace: subgraph.Name,
  };
}
