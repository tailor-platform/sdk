import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateApplicationRequestSchema,
  type UpdateApplicationRequestSchema,
} from "@tailor-proto/tailor/v1/application_pb";
import {
  Subgraph_ServiceType,
  type SubgraphSchema,
} from "@tailor-proto/tailor/v1/application_resource_pb";
import { type Application } from "@/cli/application";
import { type ApplyPhase } from "..";
import {
  fetchAll,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "../../client";
import { ChangeSet, type HasName } from ".";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyApplication(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planApplication>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Applications
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        create.request.cors = await resolveStaticWebsiteUrls(
          client,
          create.request.workspaceId!,
          create.request.cors,
          "CORS",
        );
        await client.createApplication(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          update.request.workspaceId!,
          update.request.cors,
          "CORS",
        );
        await client.updateApplication(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  }
}

type CreateApplication = {
  name: string;
  request: MessageInitShape<typeof CreateApplicationRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateApplication = {
  name: string;
  request: MessageInitShape<typeof UpdateApplicationRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

export async function planApplication(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
) {
  const changeSet: ChangeSet<CreateApplication, UpdateApplication, HasName> =
    new ChangeSet("Applications");

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
  let authNamespace: string | undefined;
  let authIdpConfigName: string | undefined;
  if (application.authService && application.authService.config) {
    authNamespace = application.authService.config.name;

    const idProvider = application.authService.config.idProvider;
    if (idProvider) {
      authIdpConfigName = idProvider.name;
    }
  }

  if (existingApplications.some((app) => app.name === application.name)) {
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
      metaRequest: {
        trn: `trn:v1:workspace:${workspaceId}:application:${application.name}`,
        labels: {
          "sdk-name": application.name,
        },
      },
    });
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
      metaRequest: {
        trn: `trn:v1:workspace:${workspaceId}:application:${application.name}`,
        labels: {
          "sdk-name": application.name,
        },
      },
    });
  }

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
