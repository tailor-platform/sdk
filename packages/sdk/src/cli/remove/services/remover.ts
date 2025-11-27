import { Code, ConnectError } from "@connectrpc/connect";
import { type OperatorClient } from "@/cli/client";
import { type ResourceToRemove, type ResourceType } from "./collector";

// Define removal order (reverse of creation order)
const removalOrder: ResourceType[] = [
  // Executor first (no dependencies)
  "Executor",
  // Application
  "Application",
  // Pipeline (resolvers before services)
  "Pipeline resolver",
  "Pipeline service",
  // Auth (nested resources before services)
  "Auth scimResource",
  "Auth scimConfig",
  "Auth oauth2Client",
  "Auth machineUser",
  "Auth tenantConfig",
  "Auth userProfileConfig",
  "Auth idpConfig",
  "Auth service",
  // IdP (clients before services)
  "IdP client",
  "IdP service",
  // StaticWebsite
  "StaticWebsite",
  // TailorDB (permissions and types before services)
  "TailorDB gqlPermission",
  "TailorDB type",
  "TailorDB service",
];

export async function removeResources(
  client: OperatorClient,
  workspaceId: string,
  resources: ResourceToRemove[],
): Promise<void> {
  // Group resources by type
  const grouped = new Map<ResourceType, ResourceToRemove[]>();
  for (const resource of resources) {
    const list = grouped.get(resource.type) ?? [];
    list.push(resource);
    grouped.set(resource.type, list);
  }

  // Remove in order
  for (const type of removalOrder) {
    const toRemove = grouped.get(type);
    if (!toRemove || toRemove.length === 0) continue;

    console.log(`Removing ${type}...`);
    await Promise.all(
      toRemove.map((resource) => removeResource(client, workspaceId, resource)),
    );
  }
}

async function removeResource(
  client: OperatorClient,
  workspaceId: string,
  resource: ResourceToRemove,
): Promise<void> {
  const name = resource.name.includes("/")
    ? resource.name.split("/").pop()!
    : resource.name;
  const namespace = resource.namespace;

  try {
    switch (resource.type) {
      case "Executor":
        await client.deleteExecutorExecutor({
          workspaceId,
          name,
        });
        break;

      case "Application":
        await client.deleteApplication({
          workspaceId,
          applicationName: name,
        });
        break;

      case "Pipeline resolver":
        await client.deletePipelineResolver({
          workspaceId,
          namespaceName: namespace!,
          resolverName: name,
        });
        break;

      case "Pipeline service":
        await client.deletePipelineService({
          workspaceId,
          namespaceName: name,
        });
        break;

      case "Auth scimResource":
        await client.deleteAuthSCIMResource({
          workspaceId,
          namespaceName: namespace!,
          name,
        });
        break;

      case "Auth scimConfig":
        await client.deleteAuthSCIMConfig({
          workspaceId,
          namespaceName: namespace!,
        });
        break;

      case "Auth oauth2Client":
        await client.deleteAuthOAuth2Client({
          workspaceId,
          namespaceName: namespace!,
          name,
        });
        break;

      case "Auth machineUser":
        await client.deleteAuthMachineUser({
          workspaceId,
          authNamespace: namespace!,
          name,
        });
        break;

      case "Auth tenantConfig":
        await client.deleteTenantConfig({
          workspaceId,
          namespaceName: namespace!,
        });
        break;

      case "Auth userProfileConfig":
        await client.deleteUserProfileConfig({
          workspaceId,
          namespaceName: namespace!,
        });
        break;

      case "Auth idpConfig":
        await client.deleteAuthIDPConfig({
          workspaceId,
          namespaceName: namespace!,
          name,
        });
        break;

      case "Auth service":
        await client.deleteAuthService({
          workspaceId,
          namespaceName: name,
        });
        break;

      case "IdP client":
        await client.deleteIdPClient({
          workspaceId,
          namespaceName: namespace!,
          name,
        });
        // Also delete the secret manager vault
        try {
          const vaultName = `idp-${namespace}-${name}`;
          await client.deleteSecretManagerVault({
            workspaceId,
            secretmanagerVaultName: vaultName,
          });
        } catch {
          // Ignore if vault doesn't exist
        }
        break;

      case "IdP service":
        await client.deleteIdPService({
          workspaceId,
          namespaceName: name,
        });
        break;

      case "StaticWebsite":
        await client.deleteStaticWebsite({
          workspaceId,
          name,
        });
        break;

      case "TailorDB gqlPermission":
        await client.deleteTailorDBGQLPermission({
          workspaceId,
          namespaceName: namespace!,
          typeName: name,
        });
        break;

      case "TailorDB type":
        await client.deleteTailorDBType({
          workspaceId,
          namespaceName: namespace!,
          tailordbTypeName: name,
        });
        break;

      case "TailorDB service":
        await client.deleteTailorDBService({
          workspaceId,
          namespaceName: name,
        });
        break;
    }
  } catch (error) {
    // Ignore NotFound errors (resource may have been deleted by cascade)
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    throw error;
  }
}
