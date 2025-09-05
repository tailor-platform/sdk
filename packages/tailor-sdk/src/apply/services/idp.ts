import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  type CreateIdPClientRequestSchema,
  type CreateIdPServiceRequestSchema,
  type DeleteIdPClientRequestSchema,
  type DeleteIdPServiceRequestSchema,
  type UpdateIdPServiceRequestSchema,
} from "@tailor-proto/tailor/v1/idp_pb";
import { type IdPServiceInput } from "@/services/idp/types";
import { type Workspace } from "@/workspace";
import { ChangeSet, type HasName } from ".";
import { type ApplyOptions } from "..";
import { fetchAll, type OperatorClient } from "../client";

export async function applyIdP(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
  options: ApplyOptions,
) {
  const changeSet = await planIdP(client, workspaceId, workspace);
  if (options.dryRun) {
    return;
  }

  // Services
  for (const create of changeSet.service.creates) {
    await client.createIdPService(create.request);
  }
  for (const update of changeSet.service.updates) {
    await client.updateIdPService(update.request);
  }
  for (const del of changeSet.service.deletes) {
    await client.deleteIdPService(del.request);
  }

  // Clients
  for (const create of changeSet.client.creates) {
    const resp = await client.createIdPClient(create.request);

    // Create the secret manager vault and secret
    const vaultName = `idp-${create.request.namespaceName}-${create.request.client?.name}`;
    const secretName = `client-secret-${create.request.namespaceName}-${create.request.client?.name}`;
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
  }
  for (const del of changeSet.client.deletes) {
    if (del.tag === "service-deleted") {
      continue;
    }
    await client.deleteIdPClient(del.request);

    // Delete the secret manager vault and secret
    const vaultName = `idp-${del.request.namespaceName}-${del.request.name}`;
    await client.deleteSecretManagerVault({
      workspaceId: del.request.workspaceId,
      secretmanagerVaultName: vaultName,
    });
  }
}

async function planIdP(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
) {
  const idps: IdPServiceInput = {};
  for (const app of workspace.applications) {
    for (const [namespaceName, idp] of Object.entries(app.idpServices)) {
      idps[namespaceName] = idp;
    }
  }
  const serviceChangeSet = await planServices(client, workspaceId, idps);
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
    service: serviceChangeSet,
    client: clientChangeSet,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateIdPServiceRequestSchema>;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdateIdPServiceRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteIdPServiceRequestSchema>;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  idps: Readonly<IdPServiceInput>,
) {
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> =
    new ChangeSet("IdP services");

  const existingServices = await fetchAll(async (pageToken) => {
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
  const existingNameSet = new Set<string>();
  existingServices.forEach((service) => {
    const name = service.namespace?.name;
    if (name) {
      existingNameSet.add(name);
    }
  });
  for (const [namespaceName, idp] of Object.entries(idps)) {
    let authorization;
    switch (idp.authorization) {
      case "insecure":
        authorization = "true===true";
        break;
      case "loggedIn":
        authorization = "user != null && size(user.id) > 0";
        break;
    }

    if (existingNameSet.has(namespaceName)) {
      changeSet.updates.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
          authorization,
        },
      });
      existingNameSet.delete(namespaceName);
    } else {
      changeSet.creates.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
          authorization,
        },
      });
    }
  }
  existingNameSet.forEach((namespaceName) => {
    changeSet.deletes.push({
      name: namespaceName,
      request: {
        workspaceId,
        namespaceName,
      },
    });
  });
  return changeSet;
}

type CreateClient = {
  name: string;
  request: MessageInitShape<typeof CreateIdPClientRequestSchema>;
};

type DeleteClient = {
  tag: "client-deleted";
  name: string;
  request: MessageInitShape<typeof DeleteIdPClientRequestSchema>;
};

type ServiceDeleted = {
  tag: "service-deleted";
  name: string;
};

async function planClients(
  client: OperatorClient,
  workspaceId: string,
  idps: Readonly<IdPServiceInput>,
  deletedServices: string[],
) {
  const changeSet: ChangeSet<
    CreateClient,
    HasName,
    DeleteClient | ServiceDeleted
  > = new ChangeSet("IdP clients");

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

  for (const [namespaceName, idp] of Object.entries(idps)) {
    const existingClients = await fetchClients(namespaceName);
    const existingNameSet = new Set<string>();
    existingClients.forEach((client) => {
      existingNameSet.add(client.name);
    });
    for (const name of idp.clients) {
      if (existingNameSet.has(name)) {
        changeSet.updates.push({ name });
        existingNameSet.delete(name);
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
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        tag: "client-deleted",
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
        tag: "service-deleted",
        name: client.name,
      });
    });
  }
  return changeSet;
}
