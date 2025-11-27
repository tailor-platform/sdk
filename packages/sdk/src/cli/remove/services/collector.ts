import { Code, ConnectError } from "@connectrpc/connect";
import { sdkNameLabelKey } from "@/cli/apply/services/label";
import { fetchAll, type OperatorClient } from "@/cli/client";

export type ResourceType =
  | "Executor"
  | "Application"
  | "Pipeline service"
  | "Pipeline resolver"
  | "Auth service"
  | "Auth idpConfig"
  | "Auth userProfileConfig"
  | "Auth tenantConfig"
  | "Auth machineUser"
  | "Auth oauth2Client"
  | "Auth scimConfig"
  | "Auth scimResource"
  | "IdP service"
  | "IdP client"
  | "StaticWebsite"
  | "TailorDB service"
  | "TailorDB type"
  | "TailorDB gqlPermission";

export interface ResourceToRemove {
  type: ResourceType;
  name: string;
  namespace?: string;
}

export async function collectResourcesToRemove(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  // Collect in order of dependencies (will be removed in reverse order later)

  // TailorDB
  const tailordbResources = await collectTailorDBResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...tailordbResources);

  // StaticWebsite
  const staticWebsiteResources = await collectStaticWebsiteResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...staticWebsiteResources);

  // IdP
  const idpResources = await collectIdPResources(client, workspaceId, appName);
  resources.push(...idpResources);

  // Auth
  const authResources = await collectAuthResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...authResources);

  // Pipeline
  const pipelineResources = await collectPipelineResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...pipelineResources);

  // Application
  const applicationResources = await collectApplicationResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...applicationResources);

  // Executor
  const executorResources = await collectExecutorResources(
    client,
    workspaceId,
    appName,
  );
  resources.push(...executorResources);

  return resources;
}

async function collectTailorDBResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const services = await fetchAll(async (pageToken) => {
    try {
      const { tailordbServices, nextPageToken } =
        await client.listTailorDBServices({
          workspaceId,
          pageToken,
        });
      return [tailordbServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  for (const service of services) {
    const namespaceName = service.namespace?.name;
    if (!namespaceName) continue;

    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:tailordb:${namespaceName}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    // Collect types
    const types = await fetchAll(async (pageToken) => {
      try {
        const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes(
          {
            workspaceId,
            namespaceName,
            pageToken,
          },
        );
        return [tailordbTypes, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });

    for (const type of types) {
      resources.push({
        type: "TailorDB type",
        name: `${namespaceName}/${type.name}`,
        namespace: namespaceName,
      });
    }

    // Collect GQL permissions
    const permissions = await fetchAll(async (pageToken) => {
      try {
        const { permissions, nextPageToken } =
          await client.listTailorDBGQLPermissions({
            workspaceId,
            namespaceName,
            pageToken,
          });
        return [permissions, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });

    for (const permission of permissions) {
      resources.push({
        type: "TailorDB gqlPermission",
        name: `${namespaceName}/${permission.typeName}`,
        namespace: namespaceName,
      });
    }

    resources.push({
      type: "TailorDB service",
      name: namespaceName,
    });
  }

  return resources;
}

async function collectStaticWebsiteResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const websites = await fetchAll(async (pageToken) => {
    try {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites(
        {
          workspaceId,
          pageToken,
        },
      );
      return [staticwebsites, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  for (const website of websites) {
    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:staticwebsite:${website.name}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    resources.push({
      type: "StaticWebsite",
      name: website.name,
    });
  }

  return resources;
}

async function collectIdPResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const services = await fetchAll(async (pageToken) => {
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

  for (const service of services) {
    const namespaceName = service.namespace?.name;
    if (!namespaceName) continue;

    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:idp:${namespaceName}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    // Collect clients
    const clients = await fetchAll(async (pageToken) => {
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

    for (const idpClient of clients) {
      resources.push({
        type: "IdP client",
        name: `${namespaceName}/${idpClient.name}`,
        namespace: namespaceName,
      });
    }

    resources.push({
      type: "IdP service",
      name: namespaceName,
    });
  }

  return resources;
}

async function collectAuthResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const services = await fetchAll(async (pageToken) => {
    try {
      const { authServices, nextPageToken } = await client.listAuthServices({
        workspaceId,
        pageToken,
      });
      return [authServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  for (const service of services) {
    const namespaceName = service.namespace?.name;
    if (!namespaceName) continue;

    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:auth:${namespaceName}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    // Collect SCIM resources
    try {
      const { scimResources } = await client.getAuthSCIMResources({
        workspaceId,
        namespaceName,
      });
      for (const scimResource of scimResources) {
        resources.push({
          type: "Auth scimResource",
          name: `${namespaceName}/${scimResource.name}`,
          namespace: namespaceName,
        });
      }
    } catch (error) {
      if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
        throw error;
      }
    }

    // Collect SCIM config
    try {
      await client.getAuthSCIMConfig({
        workspaceId,
        namespaceName,
      });
      resources.push({
        type: "Auth scimConfig",
        name: `${namespaceName}-scim-config`,
        namespace: namespaceName,
      });
    } catch (error) {
      if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
        throw error;
      }
    }

    // Collect OAuth2 clients
    const oauth2Clients = await fetchAll(async (pageToken) => {
      try {
        const { oauth2Clients, nextPageToken } =
          await client.listAuthOAuth2Clients({
            workspaceId,
            namespaceName,
            pageToken,
          });
        return [oauth2Clients, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });

    for (const oauth2Client of oauth2Clients) {
      resources.push({
        type: "Auth oauth2Client",
        name: `${namespaceName}/${oauth2Client.name}`,
        namespace: namespaceName,
      });
    }

    // Collect machine users
    const machineUsers = await fetchAll(async (pageToken) => {
      try {
        const { machineUsers, nextPageToken } =
          await client.listAuthMachineUsers({
            workspaceId,
            authNamespace: namespaceName,
            pageToken,
          });
        return [machineUsers, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });

    for (const machineUser of machineUsers) {
      resources.push({
        type: "Auth machineUser",
        name: `${namespaceName}/${machineUser.name}`,
        namespace: namespaceName,
      });
    }

    // Collect tenant config
    try {
      await client.getTenantConfig({
        workspaceId,
        namespaceName,
      });
      resources.push({
        type: "Auth tenantConfig",
        name: `${namespaceName}-tenant-config`,
        namespace: namespaceName,
      });
    } catch (error) {
      if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
        throw error;
      }
    }

    // Collect user profile config
    try {
      await client.getUserProfileConfig({
        workspaceId,
        namespaceName,
      });
      resources.push({
        type: "Auth userProfileConfig",
        name: `${namespaceName}-user-profile-config`,
        namespace: namespaceName,
      });
    } catch (error) {
      if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
        throw error;
      }
    }

    // Collect idp configs
    const idpConfigs = await fetchAll(async (pageToken) => {
      try {
        const { idpConfigs, nextPageToken } = await client.listAuthIDPConfigs({
          workspaceId,
          namespaceName,
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

    for (const idpConfig of idpConfigs) {
      resources.push({
        type: "Auth idpConfig",
        name: `${namespaceName}/${idpConfig.name}`,
        namespace: namespaceName,
      });
    }

    resources.push({
      type: "Auth service",
      name: namespaceName,
    });
  }

  return resources;
}

async function collectPipelineResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const services = await fetchAll(async (pageToken) => {
    try {
      const { pipelineServices, nextPageToken } =
        await client.listPipelineServices({
          workspaceId,
          pageToken,
        });
      return [pipelineServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  for (const service of services) {
    const namespaceName = service.namespace?.name;
    if (!namespaceName) continue;

    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:pipeline:${namespaceName}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    // Collect resolvers
    const resolvers = await fetchAll(async (pageToken) => {
      try {
        const { pipelineResolvers, nextPageToken } =
          await client.listPipelineResolvers({
            workspaceId,
            namespaceName,
            pageToken,
          });
        return [pipelineResolvers, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });

    for (const resolver of resolvers) {
      resources.push({
        type: "Pipeline resolver",
        name: `${namespaceName}/${resolver.name}`,
        namespace: namespaceName,
      });
    }

    resources.push({
      type: "Pipeline service",
      name: namespaceName,
    });
  }

  return resources;
}

async function collectApplicationResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const applications = await fetchAll(async (pageToken) => {
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

  for (const application of applications) {
    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:application:${application.name}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    resources.push({
      type: "Application",
      name: application.name,
    });
  }

  return resources;
}

async function collectExecutorResources(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<ResourceToRemove[]> {
  const resources: ResourceToRemove[] = [];

  const executors = await fetchAll(async (pageToken) => {
    try {
      const { executors, nextPageToken } = await client.listExecutorExecutors({
        workspaceId,
        pageToken,
      });
      return [executors, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  for (const executor of executors) {
    const { metadata } = await client.getMetadata({
      trn: `trn:v1:workspace:${workspaceId}:executor:${executor.name}`,
    });

    if (metadata?.labels[sdkNameLabelKey] !== appName) continue;

    resources.push({
      type: "Executor",
      name: executor.name,
    });
  }

  return resources;
}
