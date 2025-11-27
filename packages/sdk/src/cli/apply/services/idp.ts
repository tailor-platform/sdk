import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateIdPClientRequestSchema,
  type CreateIdPServiceRequestSchema,
  type DeleteIdPClientRequestSchema,
  type DeleteIdPServiceRequestSchema,
  type UpdateIdPServiceRequestSchema,
} from "@tailor-proto/tailor/v1/idp_pb";
import { type IdP } from "@/parser/service/idp";
import { fetchAll, type OperatorClient } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export function idpClientVaultName(namespaceName: string, clientName: string) {
  return `idp-${namespaceName}-${clientName}`;
}

export function idpClientSecretName(namespaceName: string, clientName: string) {
  return `client-secret-${namespaceName}-${clientName}`;
}

export async function applyIdP(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planIdP>>,
  phase: ApplyPhase = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createIdPService(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await client.updateIdPService(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);

    // Clients
    await Promise.all([
      ...changeSet.client.creates.map(async (create) => {
        const resp = await client.createIdPClient(create.request);

        // Create the secret manager vault and secret
        const vaultName = idpClientVaultName(
          create.request.namespaceName!,
          create.request.client?.name || "",
        );
        const secretName = idpClientSecretName(
          create.request.namespaceName!,
          create.request.client?.name || "",
        );
        await client.createSecretManagerVault({
          workspaceId: create.request.workspaceId,
          secretmanagerVaultName: vaultName,
        });
        await client.createSecretManagerSecret({
          workspaceId: create.request.workspaceId,
          secretmanagerVaultName: vaultName,
          secretmanagerSecretName: secretName,
          secretmanagerSecretValue: resp.client?.clientSecret,
        });
      }),
      ...changeSet.client.updates.map(async (update) => {
        // Ensure the vault and secret exist
        const vaultName = idpClientVaultName(update.namespaceName, update.name);
        const secretName = idpClientSecretName(
          update.namespaceName,
          update.name,
        );
        try {
          await client.getSecretManagerVault({
            workspaceId: update.workspaceId,
            secretmanagerVaultName: vaultName,
          });
          return;
        } catch (error) {
          if (
            !(error instanceof ConnectError && error.code === Code.NotFound)
          ) {
            throw error;
          }
        }
        await client.createSecretManagerVault({
          workspaceId: update.workspaceId,
          secretmanagerVaultName: vaultName,
        });
        await client.createSecretManagerSecret({
          workspaceId: update.workspaceId,
          secretmanagerVaultName: vaultName,
          secretmanagerSecretName: secretName,
          secretmanagerSecretValue: update.clientSecret,
        });
      }),
    ]);
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Clients
    await Promise.all(
      changeSet.client.deletes.map(async (del) => {
        await client.deleteIdPClient(del.request);

        // Delete the secret manager vault and secret
        const vaultName = `idp-${del.request.namespaceName}-${del.request.name}`;
        await client.deleteSecretManagerVault({
          workspaceId: del.request.workspaceId,
          secretmanagerVaultName: vaultName,
        });
      }),
    );

    // Services
    await Promise.all(
      changeSet.service.deletes.map((del) =>
        client.deleteIdPService(del.request),
      ),
    );
  }
}

export async function planIdP({
  client,
  workspaceId,
  application,
  forRemoval,
}: PlanContext) {
  const idps = forRemoval ? [] : application.idpServices;
  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, idps);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const clientChangeSet = await planClients(
    client,
    workspaceId,
    idps,
    deletedServices,
  );

  serviceChangeSet.print();
  clientChangeSet.print();
  return {
    changeSet: {
      service: serviceChangeSet,
      client: clientChangeSet,
    },
    conflicts,
    unmanaged,
    resourceOwners,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateIdPServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdateIdPServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteIdPServiceRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:idp:${name}`;
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  idps: ReadonlyArray<IdP>,
) {
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> =
    new ChangeSet("IdP services");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { idpServices, nextPageToken } = await client.listIdPServices({
        workspaceId,
        pageToken,
      });
      return [idpServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingServices: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      if (!resource.namespace?.name) {
        return;
      }
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.namespace.name),
      });
      existingServices[resource.namespace.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
      };
    }),
  );

  for (const idp of idps) {
    const namespaceName = idp.name;
    const existing = existingServices[namespaceName];
    const metaRequest = await buildMetaRequest(
      trn(workspaceId, namespaceName),
      appName,
    );
    let authorization;
    switch (idp.authorization) {
      case "insecure":
        authorization = "true==true";
        break;
      case "loggedIn":
        authorization = "user != null && size(user.id) > 0";
        break;
      default:
        authorization = idp.authorization.cel;
        break;
    }

    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "IdP service",
          resourceName: idp.name,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "IdP service",
          resourceName: idp.name,
          currentOwner: existing.label,
        });
      }

      changeSet.updates.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
          authorization,
        },
        metaRequest,
      });
      delete existingServices[namespaceName];
    } else {
      changeSet.creates.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
          authorization,
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const label = existingServices[namespaceName]?.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete services managed by this application
    if (label === appName) {
      changeSet.deletes.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

type CreateClient = {
  name: string;
  request: MessageInitShape<typeof CreateIdPClientRequestSchema>;
};

type UpdateClient = {
  name: string;
  workspaceId: string;
  namespaceName: string;
  clientSecret: string;
};

type DeleteClient = {
  name: string;
  request: MessageInitShape<typeof DeleteIdPClientRequestSchema>;
};

async function planClients(
  client: OperatorClient,
  workspaceId: string,
  idps: ReadonlyArray<IdP>,
  deletedServices: string[],
) {
  const changeSet: ChangeSet<CreateClient, UpdateClient, DeleteClient> =
    new ChangeSet("IdP clients");

  const fetchClients = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { clients, nextPageToken } = await client.listIdPClients({
          workspaceId,
          namespaceName,
          pageToken,
        });
        return [clients, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const idp of idps) {
    const namespaceName = idp.name;
    const existingClients = await fetchClients(namespaceName);
    const existingNameMap = new Map<string, string>();
    existingClients.forEach((client) => {
      existingNameMap.set(client.name, client.clientSecret);
    });
    for (const name of idp.clients) {
      if (existingNameMap.has(name)) {
        changeSet.updates.push({
          name,
          workspaceId,
          namespaceName,
          clientSecret: existingNameMap.get(name)!,
        });
        existingNameMap.delete(name);
      } else {
        changeSet.creates.push({
          name,
          request: {
            workspaceId,
            namespaceName,
            client: {
              name,
            },
          },
        });
      }
    }
    existingNameMap.forEach((name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName,
          name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingClients = await fetchClients(namespaceName);
    existingClients.forEach((client) => {
      changeSet.deletes.push({
        name: client.name,
        request: {
          workspaceId,
          namespaceName,
          name: client.name,
        },
      });
    });
  }
  return changeSet;
}
