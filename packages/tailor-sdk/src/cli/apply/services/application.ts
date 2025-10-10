import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  type CreateApplicationRequestSchema,
  type DeleteApplicationRequestSchema,
  type UpdateApplicationRequestSchema,
} from "@tailor-proto/tailor/v1/application_pb";
import {
  Subgraph_ServiceType,
  type SubgraphSchema,
} from "@tailor-proto/tailor/v1/application_resource_pb";
import { type Application } from "@/configure/application";
import { ChangeSet } from ".";
import { type ApplyPhase } from "..";
import {
  fetchAll,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "../client";

export async function applyApplication(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planApplication>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Applications
    for (const create of changeSet.creates) {
      create.request.cors = await resolveStaticWebsiteUrls(
        client,
        create.request.workspaceId!,
        create.request.cors,
        "CORS",
      );

      await client.createApplication(create.request);
    }
    for (const update of changeSet.updates) {
      update.request.cors = await resolveStaticWebsiteUrls(
        client,
        update.request.workspaceId!,
        update.request.cors,
        "CORS",
      );

      await client.updateApplication(update.request);
    }
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Applications
    for (const del of changeSet.deletes) {
      await client.deleteApplication(del.request);
    }
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

export async function planApplication(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
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
  for (const app of application.applications) {
    let authNamespace: string | undefined;
    let authIdpConfigName: string | undefined;
    if (app.authService && app.authService.config) {
      authNamespace = app.authService.config.name;

      const idProvider = app.authService.config.idProvider;
      if (idProvider) {
        authIdpConfigName = idProvider.name;
      }
    }

    if (existingNameSet.has(app.name)) {
      changeSet.updates.push({
        name: app.name,
        request: {
          workspaceId,
          applicationName: app.name,
          authNamespace,
          authIdpConfigName,
          cors: app.config.cors,
          subgraphs: app.subgraphs.map((subgraph) => protoSubgraph(subgraph)),
          allowedIpAddresses: app.config.allowedIPAddresses,
          disableIntrospection: app.config.disableIntrospection,
        },
      });
      existingNameSet.delete(app.name);
    } else {
      changeSet.creates.push({
        name: app.name,
        request: {
          workspaceId,
          applicationName: app.name,
          authNamespace,
          authIdpConfigName,
          cors: app.config.cors,
          subgraphs: app.subgraphs.map((subgraph) => protoSubgraph(subgraph)),
          allowedIpAddresses: app.config.allowedIPAddresses,
          disableIntrospection: app.config.disableIntrospection,
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
