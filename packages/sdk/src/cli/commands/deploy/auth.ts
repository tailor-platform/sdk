import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthHookPoint,
  AuthIDPConfig_AuthType,
  AuthOAuth2Client_ClientType,
  AuthOAuth2Client_GrantType,
  AuthSCIMAttribute_Mutability,
  AuthSCIMAttribute_Type,
  AuthSCIMAttribute_Uniqueness,
  AuthSCIMConfig_AuthorizationType,
  type AuthIDPConfig_ConfigSchema,
  TenantProviderConfig_TenantProviderType,
  UserProfileProviderConfig_UserProfileProviderType,
  type AuthIDPConfigSchema,
  type AuthOAuth2ClientSchema,
  type AuthSCIMAttributeSchema,
  type AuthSCIMConfigSchema,
  type AuthSCIMResourceSchema,
  type TenantProviderConfigSchema,
  type UserProfileProviderConfigSchema,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { type AuthService } from "@/cli/services/auth/service";
import { fetchAll, resolveStaticWebsiteUrls, type OperatorClient } from "@/cli/shared/client";
import { assertDefined } from "@/utils/assert";
import { applyAuthConnections, planAuthConnections } from "./auth-connection";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import { areNormalizedEqual, normalizeProtoConfig, normalizeStringArray } from "./compare";
import { authHookFunctionName } from "./function-registry";
import {
  formatChangeEntriesWithFunctionRegistry,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { idpClientSecretName, idpClientVaultName } from "./idp";
import {
  buildMetaRequest,
  isOwnedByApp,
  resourceTrn,
  sdkNameLabelKey,
  type WithLabel,
} from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/deploy/types";
import type { AuthAttributeValue } from "@/types/auth";
import type {
  BuiltinIdP,
  IdProvider as IdProviderConfig,
  OAuth2Client,
  SCIMAttribute,
  SCIMConfig,
  SCIMResource,
  TenantProvider as TenantProviderConfig,
} from "@/types/auth.generated";
import type {
  CreateAuthHookRequestSchema,
  CreateAuthIDPConfigRequestSchema,
  CreateAuthMachineUserRequestSchema,
  CreateAuthOAuth2ClientRequestSchema,
  CreateAuthSCIMConfigRequestSchema,
  CreateAuthSCIMResourceRequestSchema,
  CreateAuthServiceRequestSchema,
  CreateTenantConfigRequestSchema,
  CreateUserProfileConfigRequestSchema,
  DeleteAuthHookRequestSchema,
  DeleteAuthIDPConfigRequestSchema,
  DeleteAuthMachineUserRequestSchema,
  DeleteAuthOAuth2ClientRequestSchema,
  DeleteAuthSCIMConfigRequestSchema,
  DeleteAuthSCIMResourceRequestSchema,
  DeleteAuthServiceRequestSchema,
  DeleteTenantConfigRequestSchema,
  DeleteUserProfileConfigRequestSchema,
  UpdateAuthHookRequestSchema,
  UpdateAuthIDPConfigRequestSchema,
  UpdateAuthMachineUserRequestSchema,
  UpdateAuthOAuth2ClientRequestSchema,
  UpdateAuthSCIMConfigRequestSchema,
  UpdateAuthSCIMResourceRequestSchema,
  UpdateAuthServiceRequestSchema,
  UpdateTenantConfigRequestSchema,
  UpdateUserProfileConfigRequestSchema,
} from "@tailor-proto/tailor/v1/auth_pb";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

/**
 * Apply auth-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned auth changes
 * @param phase - Apply phase (defaults to "create-update")
 * @returns Promise that resolves when auth changes are applied
 */
export async function applyAuth(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planAuth>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createAuthService(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await client.updateAuthService(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);

    // Auth Connections
    await applyAuthConnections(
      client,
      { changeSet: changeSet.connection } as Awaited<ReturnType<typeof planAuthConnections>>,
      "create-update",
    );

    // IdPConfigs
    await Promise.all([
      ...changeSet.idpConfig.creates.map(async (create) => {
        if (create.idpConfig.kind === "BuiltInIdP") {
          assertDefined(create.request.idpConfig, "request missing idpConfig").config =
            await protoBuiltinIdPConfig(
              client,
              assertDefined(create.request.workspaceId, "request missing workspaceId"),
              create.idpConfig,
            );
        }
        return client.createAuthIDPConfig(create.request);
      }),
      ...changeSet.idpConfig.updates.map(async (update) => {
        if (update.idpConfig.kind === "BuiltInIdP") {
          assertDefined(update.request.idpConfig, "request missing idpConfig").config =
            await protoBuiltinIdPConfig(
              client,
              assertDefined(update.request.workspaceId, "request missing workspaceId"),
              update.idpConfig,
            );
        }
        return client.updateAuthIDPConfig(update.request);
      }),
    ]);

    // UserProfileConfigs
    await Promise.all([
      ...changeSet.userProfileConfig.creates.map((create) =>
        client.createUserProfileConfig(create.request),
      ),
      ...changeSet.userProfileConfig.updates.map((update) =>
        client.updateUserProfileConfig(update.request),
      ),
    ]);

    // TenantConfigs
    await Promise.all([
      ...changeSet.tenantConfig.creates.map((create) => client.createTenantConfig(create.request)),
      ...changeSet.tenantConfig.updates.map((update) => client.updateTenantConfig(update.request)),
    ]);

    // MachineUsers
    await Promise.all([
      ...changeSet.machineUser.creates.map((create) =>
        client.createAuthMachineUser(create.request),
      ),
      ...changeSet.machineUser.updates.map((update) =>
        client.updateAuthMachineUser(update.request),
      ),
    ]);

    // AuthHooks (after machine users, since hooks reference invokers)
    await Promise.all([
      ...changeSet.authHook.creates.map((create) => client.createAuthHook(create.request)),
      ...changeSet.authHook.updates.map((update) => client.updateAuthHook(update.request)),
    ]);

    // OAuth2Clients
    await Promise.all([
      ...changeSet.oauth2Client.creates.map(async (create) => {
        const oauth2Client = assertDefined(
          create.request.oauth2Client,
          "request missing oauth2Client",
        );
        oauth2Client.redirectUris = await resolveStaticWebsiteUrls(
          client,
          assertDefined(create.request.workspaceId, "request missing workspaceId"),
          oauth2Client.redirectUris,
          "OAuth2 redirect URIs",
        );
        return client.createAuthOAuth2Client(create.request);
      }),
      ...changeSet.oauth2Client.updates.map(async (update) => {
        const oauth2Client = assertDefined(
          update.request.oauth2Client,
          "request missing oauth2Client",
        );
        oauth2Client.redirectUris = await resolveStaticWebsiteUrls(
          client,
          assertDefined(update.request.workspaceId, "request missing workspaceId"),
          oauth2Client.redirectUris,
          "OAuth2 redirect URIs",
        );
        return client.updateAuthOAuth2Client(update.request);
      }),
    ]);

    // OAuth2Clients replaces (client type changed): delete then create sequentially
    for (const replace of changeSet.oauth2Client.replaces) {
      await client.deleteAuthOAuth2Client(replace.deleteRequest);
      const replaceOauth2Client = assertDefined(
        replace.createRequest.oauth2Client,
        "createRequest missing oauth2Client",
      );
      replaceOauth2Client.redirectUris = await resolveStaticWebsiteUrls(
        client,
        assertDefined(replace.createRequest.workspaceId, "createRequest missing workspaceId"),
        replaceOauth2Client.redirectUris,
        "OAuth2 redirect URIs",
      );
      await client.createAuthOAuth2Client(replace.createRequest);
    }

    // SCIMConfigs
    await Promise.all([
      ...changeSet.scim.creates.map((create) => client.createAuthSCIMConfig(create.request)),
      ...changeSet.scim.updates.map((update) => client.updateAuthSCIMConfig(update.request)),
    ]);

    // SCIMResources
    await Promise.all([
      ...changeSet.scimResource.creates.map((create) =>
        client.createAuthSCIMResource(create.request),
      ),
      ...changeSet.scimResource.updates.map((update) =>
        client.updateAuthSCIMResource(update.request),
      ),
    ]);
  } else if (phase === "delete-resources") {
    // Delete in reverse order of dependencies
    // SCIMResources
    await Promise.all(
      changeSet.scimResource.deletes.map((del) => client.deleteAuthSCIMResource(del.request)),
    );

    // SCIMConfigs
    await Promise.all(
      changeSet.scim.deletes.map((del) => client.deleteAuthSCIMConfig(del.request)),
    );

    // OAuth2Clients
    await Promise.all(
      changeSet.oauth2Client.deletes.map((del) => client.deleteAuthOAuth2Client(del.request)),
    );

    // AuthHooks (before machine users, since hooks reference invokers)
    await Promise.all(changeSet.authHook.deletes.map((del) => client.deleteAuthHook(del.request)));

    // MachineUsers
    await Promise.all(
      changeSet.machineUser.deletes.map((del) => client.deleteAuthMachineUser(del.request)),
    );

    // TenantConfigs
    await Promise.all(
      changeSet.tenantConfig.deletes.map((del) => client.deleteTenantConfig(del.request)),
    );

    // UserProfileConfigs
    await Promise.all(
      changeSet.userProfileConfig.deletes.map((del) => client.deleteUserProfileConfig(del.request)),
    );

    // IdPConfigs
    await Promise.all(
      changeSet.idpConfig.deletes.map((del) => client.deleteAuthIDPConfig(del.request)),
    );

    // Auth Connections
    await applyAuthConnections(
      client,
      { changeSet: changeSet.connection } as Awaited<ReturnType<typeof planAuthConnections>>,
      "delete-resources",
    );
  } else {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteAuthService(del.request)),
    );
  }
}

/**
 * Plan auth-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned auth changes and metadata
 */
export async function planAuth(context: PlanContext) {
  const { client, workspaceId, application, forRemoval, forceApplyAll = false } = context;
  const auths: Readonly<AuthService>[] = [];
  if (!forRemoval && application.authService) {
    await application.authService.resolveNamespaces();
    auths.push(application.authService);
  }
  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(
    client,
    workspaceId,
    application.name,
    application.id,
    auths,
    forceApplyAll,
  );
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const expectedLocalWebsites = new Set(
    application.staticWebsiteServices.map((website) => website.name),
  );
  const [
    idpConfigChangeSet,
    userProfileConfigChangeSet,
    tenantConfigChangeSet,
    machineUserChangeSet,
    authHookChangeSet,
    oauth2ClientChangeSet,
    scimChangeSet,
    scimResourceChangeSet,
    connectionResult,
  ] = await Promise.all([
    planIdPConfigs(client, workspaceId, auths, deletedServices, forceApplyAll),
    planUserProfileConfigs(client, workspaceId, auths, deletedServices, forceApplyAll),
    planTenantConfigs(client, workspaceId, auths, deletedServices, forceApplyAll),
    planMachineUsers(client, workspaceId, auths, deletedServices, forceApplyAll),
    planAuthHooks(client, workspaceId, auths, deletedServices, forceApplyAll),
    planOAuth2Clients(
      client,
      workspaceId,
      auths,
      deletedServices,
      expectedLocalWebsites,
      forceApplyAll,
    ),
    planSCIMConfigs(client, workspaceId, auths, deletedServices),
    planSCIMResources(client, workspaceId, auths, deletedServices),
    planAuthConnections(client, workspaceId, application.name, application.id, auths),
  ]);

  return {
    changeSet: {
      service: serviceChangeSet,
      idpConfig: idpConfigChangeSet,
      userProfileConfig: userProfileConfigChangeSet,
      tenantConfig: tenantConfigChangeSet,
      machineUser: machineUserChangeSet,
      authHook: authHookChangeSet,
      oauth2Client: oauth2ClientChangeSet,
      scim: scimChangeSet,
      scimResource: scimResourceChangeSet,
      connection: connectionResult.changeSet,
    },
    conflicts: [...conflicts, ...connectionResult.conflicts],
    unmanaged: [...unmanaged, ...connectionResult.unmanaged],
    resourceOwners: new Set([...resourceOwners, ...connectionResult.resourceOwners]),
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateAuthServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthServiceRequestSchema>;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  auths: ReadonlyArray<Readonly<AuthService>>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>("Auth services");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { authServices, nextPageToken } = await client.listAuthServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [authServices, nextPageToken];
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
        trn: resourceTrn(workspaceId, "auth", resource.namespace.name),
      });
      existingServices[resource.namespace.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  for (const auth of auths) {
    const { config } = auth;
    const existing = existingServices[config.name];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "auth", config.name),
      appName,
      appId,
    });
    const request = {
      workspaceId,
      namespaceName: config.name,
      publishSessionEvents: config.publishSessionEvents,
    };
    if (existing) {
      const owned = isOwnedByApp(existing.allLabels, appName, appId);
      if (!owned) {
        if (!existing.label) {
          unmanaged.push({
            resourceType: "Auth service",
            resourceName: config.name,
          });
        } else {
          conflicts.push({
            resourceType: "Auth service",
            resourceName: config.name,
            currentOwner: existing.label,
          });
        }
      }

      if (
        !forceApplyAll &&
        existing.resource.publishSessionEvents === (config.publishSessionEvents ?? false) &&
        owned
      ) {
        changeSet.unchanged.push({ name: config.name });
      } else {
        changeSet.updates.push({
          name: config.name,
          request,
          metaRequest,
        });
      }
      delete existingServices[config.name];
    } else {
      changeSet.creates.push({
        name: config.name,
        request,
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const label = entry?.label;
    const owned = isOwnedByApp(entry?.allLabels, appName, appId);
    if (label && !owned) {
      resourceOwners.add(label);
    }
    if (owned) {
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

type CreateIdPConfig = {
  name: string;
  idpConfig: Readonly<IdProviderConfig>;
  request: MessageInitShape<typeof CreateAuthIDPConfigRequestSchema>;
};

type UpdateIdPConfig = {
  name: string;
  idpConfig: Readonly<IdProviderConfig>;
  request: MessageInitShape<typeof UpdateAuthIDPConfigRequestSchema>;
};

type DeleteIdPConfig = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthIDPConfigRequestSchema>;
};

async function planIdPConfigs(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateIdPConfig, UpdateIdPConfig, DeleteIdPConfig>(
    "Auth idpConfigs",
  );

  const fetchIdPConfigs = (namespaceName: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { idpConfigs, nextPageToken } = await client.listAuthIDPConfigs({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
        });
        return [idpConfigs, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const authService of auths) {
    const { config } = authService;
    const existingIdPConfigs = await fetchIdPConfigs(config.name);
    const existingMap = new Map<string, (typeof existingIdPConfigs)[number]>();
    existingIdPConfigs.forEach((idpConfig) => {
      existingMap.set(idpConfig.name, idpConfig);
    });
    const idpConfig = config.idProvider;
    if (idpConfig) {
      const desired = protoIdPConfig(idpConfig);
      const existing = existingMap.get(idpConfig.name);
      if (existing) {
        const desiredComparable = await protoIdPConfigForComparison(
          client,
          workspaceId,
          idpConfig,
          desired,
        );
        if (!desiredComparable) {
          changeSet.updates.push({
            name: idpConfig.name,
            idpConfig,
            request: {
              workspaceId,
              namespaceName: config.name,
              idpConfig: desired,
            },
          });
          existingMap.delete(idpConfig.name);
          continue;
        }
        if (!forceApplyAll && areAuthIdPConfigsEqual(existing, desiredComparable)) {
          changeSet.unchanged.push({ name: idpConfig.name });
        } else {
          changeSet.updates.push({
            name: idpConfig.name,
            idpConfig,
            request: {
              workspaceId,
              namespaceName: config.name,
              idpConfig: desired,
            },
          });
        }
        existingMap.delete(idpConfig.name);
      } else {
        changeSet.creates.push({
          name: idpConfig.name,
          idpConfig,
          request: {
            workspaceId,
            namespaceName: config.name,
            idpConfig: desired,
          },
        });
      }
    }
    existingMap.forEach((_, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
          name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingIdPConfigs = await fetchIdPConfigs(namespaceName);
    existingIdPConfigs.forEach((idpConfig) => {
      changeSet.deletes.push({
        name: idpConfig.name,
        request: {
          workspaceId,
          namespaceName,
          name: idpConfig.name,
        },
      });
    });
  }
  return changeSet;
}

async function protoIdPConfigForComparison(
  client: OperatorClient,
  workspaceId: string,
  idpConfig: Readonly<IdProviderConfig>,
  desired: MessageInitShape<typeof AuthIDPConfigSchema>,
) {
  if (idpConfig.kind !== "BuiltInIdP") {
    return desired;
  }

  const config = await tryProtoBuiltinIdPConfig(client, workspaceId, idpConfig);
  return config
    ? {
        ...desired,
        config,
      }
    : undefined;
}

function normalizeComparableAuthIdPConfig(idpConfig: {
  name?: string;
  authType?: AuthIDPConfig_AuthType;
  config?: {
    config?: {
      case?: "oidc" | "saml" | "idToken";
      value?: unknown;
    };
  };
}) {
  const configCase = idpConfig.config?.config?.case;
  const oidcValue =
    configCase === "oidc" &&
    typeof idpConfig.config?.config?.value === "object" &&
    idpConfig.config.config.value !== null
      ? idpConfig.config.config.value
      : undefined;
  return normalizeProtoConfig({
    name: idpConfig.name,
    authType: idpConfig.authType,
    config:
      configCase === "oidc"
        ? {
            config: {
              case: "oidc" as const,
              value: {
                ...oidcValue,
                issuerUrl:
                  oidcValue && "issuerUrl" in oidcValue
                    ? oidcValue.issuerUrl || undefined
                    : undefined,
              },
            },
          }
        : idpConfig.config,
  });
}

function areAuthIdPConfigsEqual(
  existing: {
    name?: string;
    authType?: AuthIDPConfig_AuthType;
    config?: {
      config?: {
        case?: "oidc" | "saml" | "idToken";
        value?: unknown;
      };
    };
  },
  desired: {
    name?: string;
    authType?: AuthIDPConfig_AuthType;
    config?: {
      config?: {
        case?: "oidc" | "saml" | "idToken";
        value?: unknown;
      };
    };
  },
) {
  return areNormalizedEqual(
    normalizeComparableAuthIdPConfig(existing),
    normalizeComparableAuthIdPConfig(desired),
  );
}

function protoIdPConfig(idpConfig: IdProviderConfig): MessageInitShape<typeof AuthIDPConfigSchema> {
  switch (idpConfig.kind) {
    case "IDToken":
      return {
        name: idpConfig.name,
        authType: AuthIDPConfig_AuthType.ID_TOKEN,
        config: {
          config: {
            case: "idToken",
            value: {
              providerUrl: idpConfig.providerURL,
              clientId: idpConfig.clientID,
              issuerUrl: idpConfig.issuerURL,
              usernameClaim: idpConfig.usernameClaim,
            },
          },
        },
      };
    case "SAML":
      return {
        name: idpConfig.name,
        authType: AuthIDPConfig_AuthType.SAML,
        config: {
          config: {
            case: "saml",
            value: {
              ...(idpConfig.metadataURL !== undefined
                ? { metadataUrl: idpConfig.metadataURL }
                : {
                    rawMetadata: assertDefined(
                      idpConfig.rawMetadata,
                      "SAML config missing rawMetadata",
                    ),
                  }),
              enableSignRequest: idpConfig.enableSignRequest,
              defaultRedirectUrl: idpConfig.defaultRedirectURL,
            },
          },
        },
      };
    case "OIDC":
      return {
        name: idpConfig.name,
        authType: AuthIDPConfig_AuthType.OIDC,
        config: {
          config: {
            case: "oidc",
            value: {
              clientIdKey: idpConfig.clientID,
              clientSecretKey: {
                vaultName: idpConfig.clientSecret.vaultName,
                secretKey: idpConfig.clientSecret.secretKey,
              },
              providerUrl: idpConfig.providerURL,
              issuerUrl: idpConfig.issuerURL,
              usernameClaim: idpConfig.usernameClaim,
            },
          },
        },
      };
    case "BuiltInIdP":
      return {
        name: idpConfig.name,
        authType: AuthIDPConfig_AuthType.OIDC,
        // config is set at apply time
        config: {},
      };
    default:
      throw new Error(`Unexpected idp kind: ${idpConfig satisfies never}`);
  }
}

async function protoBuiltinIdPConfig(
  client: OperatorClient,
  workspaceId: string,
  builtinIdPConfig: BuiltinIdP,
): Promise<MessageInitShape<typeof AuthIDPConfig_ConfigSchema>> {
  const config = await tryProtoBuiltinIdPConfig(client, workspaceId, builtinIdPConfig);
  if (!config) {
    throw new Error(
      `Built-in IdP "${builtinIdPConfig.namespace}" not found. Please ensure that idp is configured correctly.`,
    );
  }
  return config;
}

async function tryProtoBuiltinIdPConfig(
  client: OperatorClient,
  workspaceId: string,
  builtinIdPConfig: BuiltinIdP,
): Promise<MessageInitShape<typeof AuthIDPConfig_ConfigSchema> | undefined> {
  let idpService;
  try {
    idpService = await client.getIdPService({
      workspaceId,
      namespaceName: builtinIdPConfig.namespace,
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined;
    }
    throw error;
  }
  let idpClient;
  try {
    idpClient = await client.getIdPClient({
      workspaceId,
      namespaceName: builtinIdPConfig.namespace,
      name: builtinIdPConfig.clientName,
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined;
    }
    throw error;
  }
  const vaultName = idpClientVaultName(builtinIdPConfig.namespace, builtinIdPConfig.clientName);
  const secretKey = idpClientSecretName(builtinIdPConfig.namespace, builtinIdPConfig.clientName);
  return {
    config: {
      case: "oidc",
      value: {
        clientIdKey: idpClient.client?.clientId,
        clientSecretKey: {
          vaultName,
          secretKey,
        },
        providerUrl: idpService.idpService?.providerUrl,
        usernameClaim: "name",
      },
    },
  };
}

type CreateUserProfileConfig = {
  name: string;
  request: MessageInitShape<typeof CreateUserProfileConfigRequestSchema>;
};

type UpdateUserProfileConfig = {
  name: string;
  request: MessageInitShape<typeof UpdateUserProfileConfigRequestSchema>;
};

type DeleteUserProfileConfig = {
  name: string;
  request: MessageInitShape<typeof DeleteUserProfileConfigRequestSchema>;
};

async function planUserProfileConfigs(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<
    CreateUserProfileConfig,
    UpdateUserProfileConfig,
    DeleteUserProfileConfig
  >("Auth userProfileConfigs");

  for (const auth of auths) {
    const { config } = auth;
    const name = `${config.name}-user-profile-config`;
    try {
      const { userProfileProviderConfig } = await client.getUserProfileConfig({
        workspaceId,
        namespaceName: config.name,
      });
      const userProfileForUpdate = auth.userProfile;
      if (userProfileForUpdate) {
        const desired = protoUserProfileConfig(userProfileForUpdate);
        if (
          !forceApplyAll &&
          areUserProfileConfigsEqual(userProfileProviderConfig ?? {}, desired)
        ) {
          changeSet.unchanged.push({ name });
        } else {
          changeSet.updates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              userProfileProviderConfig: desired,
            },
          });
        }
      } else {
        changeSet.deletes.push({
          name,
          request: {
            workspaceId,
            namespaceName: config.name,
          },
        });
      }
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        const userProfileForCreate = auth.userProfile;
        if (userProfileForCreate) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              userProfileProviderConfig: protoUserProfileConfig(userProfileForCreate),
            },
          });
        }
        continue;
      }
      throw error;
    }
  }

  for (const namespaceName of deletedServices) {
    try {
      await client.getUserProfileConfig({
        workspaceId,
        namespaceName,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
    changeSet.deletes.push({
      name: `${namespaceName}-user-profile-config`,
      request: {
        workspaceId,
        namespaceName,
      },
    });
  }
  return changeSet;
}

function protoUserProfileConfig(
  userProfile: NonNullable<AuthService["userProfile"]>,
): MessageInitShape<typeof UserProfileProviderConfigSchema> {
  // Convert attributes from { key: true } to { key: "key" }
  const attributeMap = userProfile.attributes
    ? Object.fromEntries(Object.keys(userProfile.attributes).map((key) => [key, key]))
    : undefined;

  return {
    provider: "TAILORDB",
    providerType: UserProfileProviderConfig_UserProfileProviderType.TAILORDB,
    config: {
      config: {
        case: "tailordb",
        value: {
          namespace: userProfile.namespace,
          type: userProfile.type.name,
          usernameField: userProfile.usernameField,
          tenantIdField: undefined,
          attributesFields: userProfile.attributeList,
          attributeMap,
        },
      },
    },
  };
}

type CreateTenantConfig = {
  name: string;
  request: MessageInitShape<typeof CreateTenantConfigRequestSchema>;
};

type UpdateTenantConfig = {
  name: string;
  request: MessageInitShape<typeof UpdateTenantConfigRequestSchema>;
};

type DeleteTenantConfig = {
  name: string;
  request: MessageInitShape<typeof DeleteTenantConfigRequestSchema>;
};

async function planTenantConfigs(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateTenantConfig, UpdateTenantConfig, DeleteTenantConfig>(
    "Auth tenantConfigs",
  );

  for (const auth of auths) {
    const { config } = auth;
    const name = `${config.name}-tenant-config`;
    try {
      const { tenantProviderConfig } = await client.getTenantConfig({
        workspaceId,
        namespaceName: config.name,
      });
      if (config.tenantProvider) {
        const desired = protoTenantConfig(config.tenantProvider);
        if (!forceApplyAll && areTenantProviderConfigsEqual(tenantProviderConfig, desired)) {
          changeSet.unchanged.push({ name });
        } else {
          changeSet.updates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              tenantProviderConfig: desired,
            },
          });
        }
      } else {
        changeSet.deletes.push({
          name,
          request: {
            workspaceId,
            namespaceName: config.name,
          },
        });
      }
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (config.tenantProvider) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              tenantProviderConfig: protoTenantConfig(config.tenantProvider),
            },
          });
        }
        continue;
      }
      throw error;
    }
  }

  for (const namespaceName of deletedServices) {
    try {
      await client.getTenantConfig({
        workspaceId,
        namespaceName,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
    changeSet.deletes.push({
      name: `${namespaceName}-tenant-config`,
      request: {
        workspaceId,
        namespaceName,
      },
    });
  }
  return changeSet;
}

function protoTenantConfig(
  tenantConfig: TenantProviderConfig,
): MessageInitShape<typeof TenantProviderConfigSchema> {
  return {
    providerType: TenantProviderConfig_TenantProviderType.TAILORDB,
    config: {
      config: {
        case: "tailordb",
        value: {
          namespace: tenantConfig.namespace,
          type: tenantConfig.type,
          signatureField: tenantConfig.signatureField,
        },
      },
    },
  };
}

type CreateMachineUser = {
  name: string;
  request: MessageInitShape<typeof CreateAuthMachineUserRequestSchema>;
};

type UpdateMachineUser = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthMachineUserRequestSchema>;
};

type DeleteMachineUser = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthMachineUserRequestSchema>;
};

async function planMachineUsers(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateMachineUser, UpdateMachineUser, DeleteMachineUser>(
    "Auth machineUsers",
  );

  const fetchMachineUsers = (authNamespace: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { machineUsers, nextPageToken } = await client.listAuthMachineUsers({
          workspaceId,
          authNamespace,
          pageToken,
          pageSize: maxPageSize,
        });
        return [machineUsers, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const auth of auths) {
    const { config } = auth;
    const existingMachineUsers = await fetchMachineUsers(config.name);
    const existingMap = new Map<string, (typeof existingMachineUsers)[number]>();
    existingMachineUsers.forEach((machineUser) => {
      existingMap.set(machineUser.name, machineUser);
    });
    for (const machineUsername of Object.keys(config.machineUsers ?? {})) {
      const machineUser = config.machineUsers?.[machineUsername];
      if (!machineUser) {
        continue;
      }
      const desiredMachineUser = {
        attributes: machineUser.attributeList,
        attributeMap: machineUser.attributes
          ? protoMachineUserAttributeMap(machineUser.attributes)
          : undefined,
      };
      const existing = existingMap.get(machineUsername);
      if (existing) {
        if (!forceApplyAll && areMachineUsersEqual(existing, desiredMachineUser)) {
          changeSet.unchanged.push({ name: machineUsername });
        } else {
          changeSet.updates.push({
            name: machineUsername,
            request: {
              workspaceId,
              authNamespace: config.name,
              name: machineUsername,
              attributes: machineUser.attributeList,
              attributeMap: desiredMachineUser.attributeMap,
            },
          });
        }
        existingMap.delete(machineUsername);
      } else {
        changeSet.creates.push({
          name: machineUsername,
          request: {
            workspaceId,
            authNamespace: config.name,
            name: machineUsername,
            attributes: machineUser.attributeList,
            attributeMap: desiredMachineUser.attributeMap,
          },
        });
      }
    }
    existingMap.forEach((_, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          authNamespace: config.name,
          name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingMachineUsers = await fetchMachineUsers(namespaceName);
    existingMachineUsers.forEach((machineUser) => {
      changeSet.deletes.push({
        name: machineUser.name,
        request: {
          workspaceId,
          authNamespace: namespaceName,
          name: machineUser.name,
        },
      });
    });
  }
  return changeSet;
}

function protoMachineUserAttributeMap(
  attributeMap: Record<string, AuthAttributeValue>,
): Record<string, MessageInitShape<typeof ValueSchema>> {
  const ret: Record<string, MessageInitShape<typeof ValueSchema>> = {};
  for (const [key, value] of Object.entries(attributeMap)) {
    ret[key] = fromJson(ValueSchema, value ?? null);
  }
  return ret;
}

function normalizeComparableUserProfileConfig(
  config:
    | MessageInitShape<typeof UserProfileProviderConfigSchema>
    | {
        providerType?: UserProfileProviderConfig_UserProfileProviderType;
        config?: {
          config?: { case?: string; value?: Record<string, unknown> };
        };
      },
) {
  const comparableConfig = config.config?.config;
  const tailorDBConfig = comparableConfig?.case === "tailordb" ? comparableConfig.value : undefined;

  return normalizeProtoConfig({
    providerType: config.providerType,
    config: {
      config: {
        case: comparableConfig?.case,
        value: tailorDBConfig
          ? {
              ...tailorDBConfig,
              tenantIdField: tailorDBConfig.tenantIdField || undefined,
              attributesFields: normalizeStringArray(
                tailorDBConfig.attributesFields as readonly string[] | undefined,
              ),
              attributeMap: normalizeProtoConfig(tailorDBConfig.attributeMap),
            }
          : comparableConfig?.value,
      },
    },
  });
}

function areUserProfileConfigsEqual(
  existing: {
    providerType?: UserProfileProviderConfig_UserProfileProviderType;
    config?: { config?: { case?: string; value?: Record<string, unknown> } };
  },
  desired: MessageInitShape<typeof UserProfileProviderConfigSchema>,
) {
  return areNormalizedEqual(
    normalizeComparableUserProfileConfig(existing),
    normalizeComparableUserProfileConfig(desired),
  );
}

function normalizeComparableTenantProviderConfig(
  config:
    | MessageInitShape<typeof TenantProviderConfigSchema>
    | undefined
    | {
        providerType?: TenantProviderConfig_TenantProviderType;
        config?: {
          config?: { case?: string; value?: Record<string, unknown> };
        };
      },
) {
  return normalizeProtoConfig(config);
}

function areTenantProviderConfigsEqual(
  existing:
    | MessageInitShape<typeof TenantProviderConfigSchema>
    | undefined
    | {
        providerType?: TenantProviderConfig_TenantProviderType;
        config?: {
          config?: { case?: string; value?: Record<string, unknown> };
        };
      },
  desired: MessageInitShape<typeof TenantProviderConfigSchema>,
) {
  return areNormalizedEqual(
    normalizeComparableTenantProviderConfig(existing),
    normalizeComparableTenantProviderConfig(desired),
  );
}

function normalizeComparableMachineUser(input: {
  attributes?: readonly string[];
  attributeMap?: Record<string, MessageInitShape<typeof ValueSchema>>;
}) {
  return normalizeProtoConfig({
    attributes: normalizeStringArray(input.attributes),
    attributeMap: normalizeProtoConfig(input.attributeMap ?? {}),
  });
}

function areMachineUsersEqual(
  existing: {
    attributes?: readonly string[];
    attributeMap?: Record<string, MessageInitShape<typeof ValueSchema>>;
  },
  desired: {
    attributes?: readonly string[];
    attributeMap?: Record<string, MessageInitShape<typeof ValueSchema>>;
  },
) {
  return areNormalizedEqual(
    normalizeComparableMachineUser(existing),
    normalizeComparableMachineUser(desired),
  );
}

function normalizeComparableOAuth2Client(
  client:
    | MessageInitShape<typeof AuthOAuth2ClientSchema>
    | {
        name?: string;
        description?: string;
        grantTypes?: readonly AuthOAuth2Client_GrantType[];
        redirectUris?: readonly string[];
        clientType?: AuthOAuth2Client_ClientType;
        accessTokenLifetime?: number;
        refreshTokenLifetime?: number;
        requireDpop?: boolean;
      },
) {
  const accessTokenLifetime = oauth2LifetimeToSeconds(client.accessTokenLifetime);
  const refreshTokenLifetime = oauth2LifetimeToSeconds(client.refreshTokenLifetime);

  return normalizeProtoConfig({
    ...client,
    // Platform returns an empty string for an unset description; treat it the same as omitted.
    description: client.description || undefined,
    redirectUris: normalizeStringArray(client.redirectUris),
    grantTypes: (client.grantTypes ?? []).toSorted((left, right) => left - right),
    accessTokenLifetime: accessTokenLifetime ?? 86400,
    refreshTokenLifetime: refreshTokenLifetime ?? 604800,
    requireDpop: client.requireDpop ?? false,
  });
}

function oauth2LifetimeToSeconds(
  lifetime:
    | number
    | {
        seconds?: bigint;
      }
    | undefined,
) {
  if (typeof lifetime === "number") {
    return lifetime;
  }

  if (lifetime?.seconds != null) {
    return Number(lifetime.seconds);
  }

  return undefined;
}

function areOAuth2ClientsEqual(
  existing: {
    name: string;
    description?: string;
    grantTypes?: readonly AuthOAuth2Client_GrantType[];
    redirectUris?: readonly string[];
    clientType?: AuthOAuth2Client_ClientType;
    accessTokenLifetime?: number;
    refreshTokenLifetime?: number;
    requireDpop?: boolean;
  },
  desired:
    | MessageInitShape<typeof AuthOAuth2ClientSchema>
    | {
        name?: string;
        description?: string;
        grantTypes?: readonly AuthOAuth2Client_GrantType[];
        redirectUris?: readonly string[];
        clientType?: AuthOAuth2Client_ClientType;
        accessTokenLifetime?: number;
        refreshTokenLifetime?: number;
        requireDpop?: boolean;
      },
) {
  return areNormalizedEqual(
    normalizeComparableOAuth2Client(existing),
    normalizeComparableOAuth2Client(desired),
  );
}

type CreateOAuth2Clients = {
  name: string;
  request: MessageInitShape<typeof CreateAuthOAuth2ClientRequestSchema>;
};

type UpdateOAuth2Client = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthOAuth2ClientRequestSchema>;
};

type DeleteOAuth2Client = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthOAuth2ClientRequestSchema>;
};

type ReplaceOAuth2Client = {
  name: string;
  deleteRequest: MessageInitShape<typeof DeleteAuthOAuth2ClientRequestSchema>;
  createRequest: MessageInitShape<typeof CreateAuthOAuth2ClientRequestSchema>;
};

async function planOAuth2Clients(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  expectedLocalWebsites: ReadonlySet<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<
    CreateOAuth2Clients,
    UpdateOAuth2Client,
    DeleteOAuth2Client,
    ReplaceOAuth2Client
  >("Auth oauth2Clients");

  const fetchOAuth2Clients = (namespaceName: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
        });
        return [oauth2Clients, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const auth of auths) {
    const { config } = auth;
    const existingOAuth2Clients = await fetchOAuth2Clients(config.name);
    const existingClientsMap = new Map<string, (typeof existingOAuth2Clients)[number]>();
    existingOAuth2Clients.forEach((oauth2Client) => {
      existingClientsMap.set(oauth2Client.name, oauth2Client);
    });
    for (const oauth2ClientName of Object.keys(config.oauth2Clients ?? {})) {
      const oauth2Client = config.oauth2Clients?.[oauth2ClientName];
      if (!oauth2Client) {
        continue;
      }
      const newOAuth2Client = protoOAuth2Client(oauth2ClientName, oauth2Client);
      const resolvedRedirectUris = await resolveStaticWebsiteUrls(
        client,
        workspaceId,
        newOAuth2Client.redirectUris ?? [],
        "OAuth2 redirect URIs",
        { expectedLocalNames: expectedLocalWebsites },
      );
      if (existingClientsMap.has(oauth2ClientName)) {
        const existingClient = assertDefined(
          existingClientsMap.get(oauth2ClientName),
          "existingClientsMap missing entry for oauth2ClientName",
        );
        if (existingClient.clientType !== newOAuth2Client.clientType) {
          // Client type changed: need to replace (delete then create)
          changeSet.replaces.push({
            name: oauth2ClientName,
            deleteRequest: {
              workspaceId,
              namespaceName: config.name,
              name: oauth2ClientName,
            },
            createRequest: {
              workspaceId,
              namespaceName: config.name,
              oauth2Client: newOAuth2Client,
            },
          });
        } else {
          const desiredComparable = {
            ...newOAuth2Client,
            redirectUris: resolvedRedirectUris,
            accessTokenLifetime: oauth2LifetimeToSeconds(newOAuth2Client.accessTokenLifetime),
            refreshTokenLifetime: oauth2LifetimeToSeconds(newOAuth2Client.refreshTokenLifetime),
          };
          const existingComparable = {
            name: existingClient.name,
            description: existingClient.description,
            grantTypes: existingClient.grantTypes,
            redirectUris: existingClient.redirectUris,
            clientType: existingClient.clientType,
            accessTokenLifetime: oauth2LifetimeToSeconds(existingClient.accessTokenLifetime),
            refreshTokenLifetime: oauth2LifetimeToSeconds(existingClient.refreshTokenLifetime),
            requireDpop: existingClient.requireDpop,
          };
          if (!forceApplyAll && areOAuth2ClientsEqual(existingComparable, desiredComparable)) {
            changeSet.unchanged.push({ name: oauth2ClientName });
          } else {
            changeSet.updates.push({
              name: oauth2ClientName,
              request: {
                workspaceId,
                namespaceName: config.name,
                oauth2Client: newOAuth2Client,
              },
            });
          }
        }
        existingClientsMap.delete(oauth2ClientName);
      } else {
        changeSet.creates.push({
          name: oauth2ClientName,
          request: {
            workspaceId,
            namespaceName: config.name,
            oauth2Client: newOAuth2Client,
          },
        });
      }
    }
    existingClientsMap.forEach((_, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
          name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingOAuth2Clients = await fetchOAuth2Clients(namespaceName);
    existingOAuth2Clients.forEach((oauth2Client) => {
      changeSet.deletes.push({
        name: oauth2Client.name,
        request: {
          workspaceId,
          namespaceName,
          name: oauth2Client.name,
        },
      });
    });
  }

  return changeSet;
}

function protoOAuth2Client(
  oauth2ClientName: string,
  oauth2Client: OAuth2Client,
): MessageInitShape<typeof AuthOAuth2ClientSchema> {
  // `oauth2Client` is already parsed output: AuthConfigSchema.parse (wired in
  // application.ts) validated it and transformed the numeric token lifetimes
  // into Duration ({ seconds, nanos }). Consume it directly instead of
  // re-parsing, which would reject the already-transformed lifetimes.
  return {
    name: oauth2ClientName,
    description: oauth2Client.description,
    grantTypes: oauth2Client.grantTypes.map((grantType) => {
      switch (grantType) {
        case "authorization_code":
          return AuthOAuth2Client_GrantType.AUTHORIZATION_CODE;
        case "refresh_token":
          return AuthOAuth2Client_GrantType.REFRESH_TOKEN;
        default:
          throw new Error(`Unknown OAuth2 client grant type: ${grantType satisfies never}`);
      }
    }),
    redirectUris: oauth2Client.redirectURIs,
    clientType: (
      {
        confidential: AuthOAuth2Client_ClientType.CONFIDENTIAL,
        public: AuthOAuth2Client_ClientType.PUBLIC,
        browser: AuthOAuth2Client_ClientType.BROWSER,
      } satisfies Record<NonNullable<OAuth2Client["clientType"]>, AuthOAuth2Client_ClientType>
    )[oauth2Client.clientType ?? "confidential"],
    accessTokenLifetime: oauth2Client.accessTokenLifetimeSeconds,
    refreshTokenLifetime: oauth2Client.refreshTokenLifetimeSeconds,
    requireDpop: oauth2Client.requireDpop,
  };
}

type CreateSCIMConfig = {
  name: string;
  request: MessageInitShape<typeof CreateAuthSCIMConfigRequestSchema>;
};

type UpdateSCIMConfig = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthSCIMConfigRequestSchema>;
};

type DeleteSCIMConfig = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthSCIMConfigRequestSchema>;
};

async function planSCIMConfigs(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet = createChangeSet<CreateSCIMConfig, UpdateSCIMConfig, DeleteSCIMConfig>(
    "Auth scimConfigs",
  );

  for (const auth of auths) {
    const { config } = auth;
    const name = `${config.name}-scim-config`;
    try {
      await client.getAuthSCIMConfig({
        workspaceId,
        namespaceName: config.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (config.scim) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              scimConfig: protoSCIMConfig(config.scim),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (config.scim) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
          scimConfig: protoSCIMConfig(config.scim),
        },
      });
    } else {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
        },
      });
    }
  }

  for (const namespaceName of deletedServices) {
    try {
      await client.getAuthSCIMConfig({
        workspaceId,
        namespaceName,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
    changeSet.deletes.push({
      name: `${namespaceName}-scim-config`,
      request: {
        workspaceId,
        namespaceName,
      },
    });
  }
  return changeSet;
}

function protoSCIMConfig(scimConfig: SCIMConfig): MessageInitShape<typeof AuthSCIMConfigSchema> {
  let authorizationType;
  switch (scimConfig.authorization.type) {
    case "bearer":
      authorizationType = AuthSCIMConfig_AuthorizationType.BEARER;
      break;
    case "oauth2":
      authorizationType = AuthSCIMConfig_AuthorizationType.OAUTH2;
      break;
    default:
      throw new Error(
        `Unknown SCIM authorization type: ${scimConfig.authorization.type satisfies never}`,
      );
  }

  return {
    machineUserName: scimConfig.machineUserName,
    authorizationType,
    authorizationConfig: {
      case: "bearerSecret",
      value: {
        vaultName: scimConfig.authorization.bearerSecret?.vaultName,
        secretKey: scimConfig.authorization.bearerSecret?.secretKey,
      },
    },
  };
}

type CreateSCIMResource = {
  name: string;
  request: MessageInitShape<typeof CreateAuthSCIMResourceRequestSchema>;
};

type UpdateSCIMResource = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthSCIMResourceRequestSchema>;
};

type DeleteSCIMResource = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthSCIMResourceRequestSchema>;
};

async function planSCIMResources(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet = createChangeSet<CreateSCIMResource, UpdateSCIMResource, DeleteSCIMResource>(
    "Auth scimResources",
  );

  const fetchSCIMResources = async (namespaceName: string) => {
    try {
      const { scimResources } = await client.getAuthSCIMResources({
        workspaceId,
        namespaceName,
      });
      return scimResources;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [];
      }
      throw error;
    }
  };

  for (const auth of auths) {
    const { config } = auth;
    const existingSCIMResources = await fetchSCIMResources(config.name);
    const existingNameSet = new Set<string>();
    existingSCIMResources.forEach((scimResource) => {
      existingNameSet.add(scimResource.name);
    });
    for (const scimResource of config.scim?.resources ?? []) {
      if (existingNameSet.has(scimResource.name)) {
        changeSet.updates.push({
          name: scimResource.name,
          request: {
            workspaceId,
            namespaceName: config.name,
            scimResource: protoSCIMResource(scimResource),
          },
        });
        existingNameSet.delete(scimResource.name);
      } else {
        changeSet.creates.push({
          name: scimResource.name,
          request: {
            workspaceId,
            namespaceName: config.name,
            scimResource: protoSCIMResource(scimResource),
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
          name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingSCIMResources = await fetchSCIMResources(namespaceName);
    existingSCIMResources.forEach((scimResource) => {
      changeSet.deletes.push({
        name: scimResource.name,
        request: {
          workspaceId,
          namespaceName,
          name: scimResource.name,
        },
      });
    });
  }
  return changeSet;
}

function protoSCIMResource(
  scimResource: SCIMResource,
): MessageInitShape<typeof AuthSCIMResourceSchema> {
  return {
    name: scimResource.name,
    tailorDbNamespace: scimResource.tailorDBNamespace,
    tailorDbType: scimResource.tailorDBType,
    coreSchema: {
      name: scimResource.coreSchema.name,
      attributes: scimResource.coreSchema.attributes.map((attr) => protoSCIMAttribute(attr)),
    },
    attributeMapping: scimResource.attributeMapping.map((attr) => ({
      tailorDbField: attr.tailorDBField,
      scimPath: attr.scimPath,
    })),
  };
}

function protoSCIMAttribute(attr: SCIMAttribute): MessageInitShape<typeof AuthSCIMAttributeSchema> {
  let typ;
  switch (attr.type) {
    case "string":
      typ = AuthSCIMAttribute_Type.STRING;
      break;
    case "number":
      typ = AuthSCIMAttribute_Type.NUMBER;
      break;
    case "boolean":
      typ = AuthSCIMAttribute_Type.BOOLEAN;
      break;
    case "datetime":
      typ = AuthSCIMAttribute_Type.DATETIME;
      break;
    case "complex":
      typ = AuthSCIMAttribute_Type.COMPLEX;
      break;
    default:
      throw new Error(`Unknown SCIM attribute type: ${attr.type satisfies never}`);
  }
  let mutability;
  if (attr.mutability) {
    switch (attr.mutability) {
      case "readOnly":
        mutability = AuthSCIMAttribute_Mutability.READ_ONLY;
        break;
      case "readWrite":
        mutability = AuthSCIMAttribute_Mutability.READ_WRITE;
        break;
      case "writeOnly":
        mutability = AuthSCIMAttribute_Mutability.WRITE_ONLY;
        break;
      default:
        throw new Error(`Unknown SCIM attribute mutability: ${attr.mutability satisfies never}`);
    }
  }
  let uniqueness;
  if (attr.uniqueness) {
    switch (attr.uniqueness) {
      case "none":
        uniqueness = AuthSCIMAttribute_Uniqueness.NONE;
        break;
      case "server":
        uniqueness = AuthSCIMAttribute_Uniqueness.SERVER;
        break;
      case "global":
        uniqueness = AuthSCIMAttribute_Uniqueness.GLOBAL;
        break;
      default:
        throw new Error(`Unknown SCIM attribute uniqueness: ${attr.uniqueness satisfies never}`);
    }
  }
  return {
    type: typ,
    name: attr.name,
    description: attr.description,
    mutability,
    required: attr.required,
    multiValued: attr.multiValued,
    uniqueness,
    canonicalValues: attr.canonicalValues ?? undefined,
    subAttributes: attr.subAttributes?.map((attr) => protoSCIMAttribute(attr)),
  };
}

type CreateAuthHook = {
  name: string;
  request: MessageInitShape<typeof CreateAuthHookRequestSchema>;
};

type UpdateAuthHook = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthHookRequestSchema>;
};

type DeleteAuthHook = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthHookRequestSchema>;
};

function areAuthHooksEqual(
  existing: {
    scriptRef?: string;
    invoker?: {
      namespace?: string;
      machineUserName?: string;
    };
  },
  desired: {
    scriptRef?: string;
    invoker?: {
      namespace?: string;
      machineUserName?: string;
    };
  },
): boolean {
  return areNormalizedEqual(
    {
      scriptRef: existing.scriptRef ?? "",
      invoker: existing.invoker
        ? {
            namespace: existing.invoker.namespace ?? "",
            machineUserName: existing.invoker.machineUserName ?? "",
          }
        : undefined,
    },
    {
      scriptRef: desired.scriptRef ?? "",
      invoker: desired.invoker
        ? {
            namespace: desired.invoker.namespace ?? "",
            machineUserName: desired.invoker.machineUserName ?? "",
          }
        : undefined,
    },
  );
}

/**
 * Format auth hook changes for grouped dry-run display.
 * @param changeSet - Auth hook changes
 * @param functionRegistryAuthHookChanges - Related function registry changes for auth hooks
 * @returns Display entries for auth hook output
 */
export function formatAuthHookChangeEntries(
  changeSet: Pick<
    ChangeSet<HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  functionRegistryAuthHookChanges?: RelatedFunctionRegistryChanges,
): GroupedDisplayEntry[] {
  return formatChangeEntriesWithFunctionRegistry(
    "authHook",
    changeSet,
    functionRegistryAuthHookChanges,
    (item) => {
      const [namespace, hookPoint] = item.name.split("/");
      return namespace && hookPoint ? [authHookFunctionName(namespace, hookPoint)] : [];
    },
    {
      getNamespace: (item) => item.name.split("/")[0],
      getDisplayName: (item) => item.name.split("/")[1] ?? item.name,
    },
  );
}

async function planAuthHooks(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateAuthHook, UpdateAuthHook, DeleteAuthHook>("Auth hooks");

  for (const auth of auths) {
    const { config } = auth;
    const beforeLogin = config.hooks?.beforeLogin;

    let existingHook:
      | {
          scriptRef?: string;
          invoker?: {
            namespace?: string;
            machineUserName?: string;
          };
        }
      | undefined;
    try {
      const { hook } = await client.getAuthHook({
        workspaceId,
        namespaceName: config.name,
        hookPoint: AuthHookPoint.BEFORE_LOGIN,
      });
      existingHook = hook;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        existingHook = undefined;
      } else {
        throw error;
      }
    }

    if (beforeLogin) {
      const hookRequest = {
        workspaceId,
        namespaceName: config.name,
        hook: {
          hookPoint: AuthHookPoint.BEFORE_LOGIN,
          scriptRef: authHookFunctionName(config.name, "before-login"),
          invoker: {
            namespace: config.name,
            machineUserName: beforeLogin.invoker,
          },
        },
      };

      if (existingHook) {
        if (!forceApplyAll && areAuthHooksEqual(existingHook, hookRequest.hook)) {
          changeSet.unchanged.push({
            name: `${config.name}/before-login`,
          });
        } else {
          changeSet.updates.push({
            name: `${config.name}/before-login`,
            request: hookRequest,
          });
        }
      } else {
        changeSet.creates.push({
          name: `${config.name}/before-login`,
          request: hookRequest,
        });
      }
    } else if (existingHook) {
      changeSet.deletes.push({
        name: `${config.name}/before-login`,
        request: {
          workspaceId,
          namespaceName: config.name,
          hookPoint: AuthHookPoint.BEFORE_LOGIN,
        },
      });
    }
  }

  for (const namespaceName of deletedServices) {
    try {
      await client.getAuthHook({
        workspaceId,
        namespaceName,
        hookPoint: AuthHookPoint.BEFORE_LOGIN,
      });
      changeSet.deletes.push({
        name: `${namespaceName}/before-login`,
        request: {
          workspaceId,
          namespaceName,
          hookPoint: AuthHookPoint.BEFORE_LOGIN,
        },
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        // No existing hook to delete
      } else {
        throw error;
      }
    }
  }

  return changeSet;
}
