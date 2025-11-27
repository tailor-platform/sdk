import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  Subgraph_ServiceType,
  type SubgraphSchema,
} from "@tailor-proto/tailor/v1/application_resource_pb";
import {
  fetchAll,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "../../client";
import { buildMetaRequest } from "./label";
import { ChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type {
  DeleteApplicationRequestSchema,
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-proto/tailor/v1/application_pb";
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
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Applications
    await Promise.all(
      changeSet.deletes.map(async (del) => {
        await client.deleteApplication(del.request);
      }),
    );
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

type DeleteApplication = {
  name: string;
  request: MessageInitShape<typeof DeleteApplicationRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:application:${name}`;
}

export async function planApplication({
  client,
  workspaceId,
  application,
  forRemoval,
}: PlanContext) {
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

  if (forRemoval) {
    if (existingApplications.some((app) => app.name === application.name)) {
      changeSet.deletes.push({
        name: application.name,
        request: {
          workspaceId,
          applicationName: application.name,
        },
      });
    }
    changeSet.print();
    return changeSet;
  }

  let authNamespace: string | undefined;
  let authIdpConfigName: string | undefined;
  if (application.authService && application.authService.config) {
    authNamespace = application.authService.config.name;

    const idProvider = application.authService.config.idProvider;
    if (idProvider) {
      authIdpConfigName = idProvider.name;
    }
  } else if (application.config.auth) {
    // Retrieve idpConfig from remote when auth references an external namespace
    authNamespace = application.config.auth.name;
    const idpConfigs = await fetchAll(async (pageToken) => {
      try {
        const { idpConfigs, nextPageToken } = await client.listAuthIDPConfigs({
          workspaceId,
          namespaceName: authNamespace!,
          pageToken,
        });
        return [idpConfigs, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
    if (idpConfigs.length > 0) {
      authIdpConfigName = idpConfigs[0].name;
    }
  }
  const metaRequest = await buildMetaRequest(
    trn(workspaceId, application.name),
    application.name,
  );

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
      metaRequest,
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
      metaRequest,
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
