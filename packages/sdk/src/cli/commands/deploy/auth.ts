import { create, fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { type Duration, DurationSchema, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  type CreateAuthHookRequestSchema,
  type CreateAuthIDPConfigRequestSchema,
  type CreateAuthMachineUserRequestSchema,
  type CreateAuthOAuth2ClientRequestSchema,
  type CreateAuthSCIMConfigRequestSchema,
  type CreateAuthSCIMResourceRequestSchema,
  type CreateAuthServiceRequestSchema,
  type CreateTenantConfigRequestSchema,
  type CreateUserProfileConfigRequestSchema,
  type DeleteAuthHookRequestSchema,
  type DeleteAuthIDPConfigRequestSchema,
  type DeleteAuthMachineUserRequestSchema,
  type DeleteAuthOAuth2ClientRequestSchema,
  type DeleteAuthSCIMConfigRequestSchema,
  type DeleteAuthSCIMResourceRequestSchema,
  type DeleteAuthServiceRequestSchema,
  type DeleteTenantConfigRequestSchema,
  type DeleteUserProfileConfigRequestSchema,
  UpdateAuthHookRequestSchema,
  UpdateAuthIDPConfigRequestSchema,
  UpdateAuthMachineUserRequestSchema,
  UpdateAuthOAuth2ClientRequestSchema,
  UpdateAuthSCIMConfigRequestSchema,
  UpdateAuthSCIMResourceRequestSchema,
  UpdateAuthServiceRequestSchema,
  UpdateTenantConfigRequestSchema,
  UpdateUserProfileConfigRequestSchema,
} from "@tailor-platform/tailor-proto/auth_pb";
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
  AuthOAuth2ClientSchema,
  type AuthSCIMAttributeSchema,
  type AuthSCIMConfigSchema,
  type AuthSCIMResourceSchema,
  type TenantProviderConfigSchema,
  type UserProfileProviderConfigSchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { type AuthService } from "#/cli/services/auth/service";
import {
  fetchAllTolerant,
  getAuthSCIMConfigOrNull,
  getAuthSCIMResourcesOrEmpty,
  getTenantConfigOrNull,
  getUserProfileConfigOrNull,
  listAuthIDPConfigsTolerant,
  listAuthMachineUsersTolerant,
  getOrNull,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import {
  DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
  DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS,
} from "#/parser/service/auth/index";
import { assertDefined } from "#/utils/assert";
import { applyAuthConnections, planAuthConnections } from "./auth-connection";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import { defineRequestComparison, isRequestUnchanged } from "./compare";
import { authHookFunctionName } from "./function-registry";
import {
  formatChangeEntriesWithFunctionRegistry,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { idpClientSecretName, idpClientVaultName } from "./idp";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  buildMetaRequest,
  type MetadataLabelWrite,
  resourceTrn,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "./owned-resource";
import { expectedLocalStaticWebsiteNames } from "./staticwebsite";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { AuthAttributeValue } from "#/configure/services/auth/types";
import type {
  BuiltinIdP,
  IdProvider as IdProviderConfig,
  OAuth2Client,
  SCIMAttribute,
  SCIMConfig,
  SCIMResource,
  TenantProvider as TenantProviderConfig,
} from "#/types/auth.generated";

type AuthApplyPhase =
  | Exclude<ApplyPhase, "delete">
  | "create-update-prerequisites"
  | "create-update-dependents";

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
  phase: AuthApplyPhase = "create-update",
) {
  const { changeSet } = result;
  const applyServices = async () => {
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createAuthService(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await client.updateAuthService(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
    ]);
  };

  const applyMachineUsers = async () => {
    await Promise.all([
      ...changeSet.machineUser.creates.map(async (create) => {
        const created = await client.createAuthMachineUser(create.request);
        if (created.machineUser?.clientSecret) {
          logger.registerSecret(created.machineUser.clientSecret);
        }
        return created;
      }),
      ...changeSet.machineUser.updates.map(async (update) => {
        const updated = await client.updateAuthMachineUser(update.request);
        if (updated.machineUser?.clientSecret) {
          logger.registerSecret(updated.machineUser.clientSecret);
        }
        return updated;
      }),
    ]);
  };

  const applyUserProfileDeletes = async () => {
    await Promise.all(
      changeSet.userProfileConfig.deletes.map((del) => client.deleteUserProfileConfig(del.request)),
    );
  };

  const applyCreateUpdateDependents = async () => {
    await applyAuthConnections(
      client,
      {
        changeSet: changeSet.connection,
        stateScope: result.connectionStateScope,
      },
      "create-update",
    );

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

    await Promise.all([
      ...changeSet.userProfileConfig.creates.map((create) =>
        client.createUserProfileConfig(create.request),
      ),
      ...changeSet.userProfileConfig.updates.map((update) =>
        client.updateUserProfileConfig(update.request),
      ),
    ]);

    await Promise.all([
      ...changeSet.tenantConfig.creates.map((create) => client.createTenantConfig(create.request)),
      ...changeSet.tenantConfig.updates.map((update) => client.updateTenantConfig(update.request)),
    ]);

    await Promise.all([
      ...changeSet.authHook.creates.map((create) => client.createAuthHook(create.request)),
      ...changeSet.authHook.updates.map((update) => client.updateAuthHook(update.request)),
    ]);

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
        const created = await client.createAuthOAuth2Client(create.request);
        if (created.oauth2Client?.clientSecret) {
          logger.registerSecret(created.oauth2Client.clientSecret);
        }
        return created;
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
        const updated = await client.updateAuthOAuth2Client(update.request);
        if (updated.oauth2Client?.clientSecret) {
          logger.registerSecret(updated.oauth2Client.clientSecret);
        }
        return updated;
      }),
    ]);

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
      const replaced = await client.createAuthOAuth2Client(replace.createRequest);
      if (replaced.oauth2Client?.clientSecret) {
        logger.registerSecret(replaced.oauth2Client.clientSecret);
      }
    }

    await Promise.all([
      ...changeSet.scim.creates.map((create) => client.createAuthSCIMConfig(create.request)),
      ...changeSet.scim.updates.map((update) => client.updateAuthSCIMConfig(update.request)),
    ]);

    await Promise.all([
      ...changeSet.scimResource.creates.map((create) =>
        client.createAuthSCIMResource(create.request),
      ),
      ...changeSet.scimResource.updates.map((update) =>
        client.updateAuthSCIMResource(update.request),
      ),
    ]);
  };

  if (phase === "create-update-prerequisites" || phase === "create-update") {
    await applyServices();
    await applyMachineUsers();
  }
  if (phase === "create-update-dependents" || phase === "create-update") {
    await applyCreateUpdateDependents();
  }
  if (phase === "delete-resources") {
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
    await applyUserProfileDeletes();

    // IdPConfigs
    await Promise.all(
      changeSet.idpConfig.deletes.map((del) => client.deleteAuthIDPConfig(del.request)),
    );

    // Auth Connections
    await applyAuthConnections(
      client,
      {
        changeSet: changeSet.connection,
        stateScope: result.connectionStateScope,
      },
      "delete-resources",
    );
  } else if (phase === "delete-services") {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteAuthService(del.request)),
    );
  }
}

function assertAuthMachineUsersDefined(config: Readonly<AuthService>["config"]): void {
  const machineUsers = Object.keys(config.machineUsers ?? {}).toSorted();
  const missing = [
    { field: "scim.machineUserName", machineUserName: config.scim?.machineUserName },
    { field: "hooks.beforeLogin.invoker", machineUserName: config.hooks?.beforeLogin?.invoker },
  ].flatMap(({ field, machineUserName }) =>
    machineUserName === undefined || machineUsers.includes(machineUserName)
      ? []
      : [{ field, machineUserName }],
  );
  if (missing.length === 0) return;
  throw CLIError({
    code: "AUTH_MACHINE_USER_NOT_FOUND",
    message: missing
      .map(
        ({ field, machineUserName }) =>
          `Auth service "${config.name}" names machine user "${machineUserName}" in ${field}, but defines no machine user with that name.`,
      )
      .join("\n"),
    suggestion: machineUsers.length
      ? `Add each listed machine user to machineUsers, or name a defined one instead: ${machineUsers.join(", ")}.`
      : "Add each listed machine user to machineUsers.",
    context: { authNamespace: config.name, missing, machineUsers },
  });
}

/** An auth namespace whose child resources deploy plans; `auth` is undefined when its service is deleted. */
type AuthNamespace = {
  namespaceName: string;
  auth: Readonly<AuthService> | undefined;
};

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
    assertAuthMachineUsersDefined(application.authService.config);
    auths.push(application.authService);
  }
  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
    existingServices,
  } = await planServices(
    client,
    workspaceId,
    application.name,
    application.id,
    auths,
    forceApplyAll,
  );
  const namespaces: AuthNamespace[] = [
    ...auths.map((auth) => ({ namespaceName: auth.config.name, auth })),
    ...serviceChangeSet.deletes.map((del) => ({ namespaceName: del.name, auth: undefined })),
  ];
  const expectedLocalWebsites = expectedLocalStaticWebsiteNames(context);
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
    planIdPConfigs(client, workspaceId, namespaces, forceApplyAll),
    planUserProfileConfigs(client, workspaceId, namespaces, forceApplyAll),
    planTenantConfigs(client, workspaceId, namespaces, forceApplyAll),
    planMachineUsers(client, workspaceId, namespaces, forceApplyAll),
    planAuthHooks(client, workspaceId, namespaces, forceApplyAll),
    planOAuth2Clients(client, workspaceId, namespaces, expectedLocalWebsites, forceApplyAll),
    planSCIMConfigs(client, workspaceId, namespaces, forceApplyAll),
    planSCIMResources(client, workspaceId, namespaces, forceApplyAll),
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
    connectionStateScope: connectionResult.stateScope,
    existingServices,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateAuthServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdateAuthServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthServiceRequestSchema>;
};

type DesiredService = {
  name: string;
  request: MessageInitShape<typeof CreateAuthServiceRequestSchema> &
    MessageInitShape<typeof UpdateAuthServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

const authServiceComparison = defineRequestComparison({
  schema: UpdateAuthServiceRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  auths: ReadonlyArray<Readonly<AuthService>>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>("Auth services");
  const ownership = createOwnershipTracker(appName, appId);

  const fetchedServices = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { authServices, nextPageToken } = await client.listAuthServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [authServices, nextPageToken];
    },
    getName: (resource) => resource.namespace?.name,
    getTrn: (name) => resourceTrn(workspaceId, "auth", name),
  });

  const desired: DesiredService[] = [];
  for (const { config } of auths) {
    desired.push({
      name: config.name,
      request: {
        workspaceId,
        namespaceName: config.name,
        publishSessionEvents: config.publishSessionEvents,
      },
      metaRequest: await buildMetaRequest({
        trn: resourceTrn(workspaceId, "auth", config.name),
        appName,
        appId,
      }),
    });
  }
  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(fetchedServices),
    keyOf: (service) => service.name,
    ...labeledResourceChecks(ownership, (service: DesiredService) => ({
      resourceType: "auth.service",
      resourceLabel: "Auth service",
      resourceName: service.name,
    })),
    versionMatches: () => !forceApplyAll,
    isConfigUnchanged: (service, existing) =>
      isRequestUnchanged(authServiceComparison, service.request, existing.resource),
    create: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    update: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    unchanged: ({ name }) => ({ name }),
    delete: (namespaceName) => ({ name: namespaceName, request: { workspaceId, namespaceName } }),
  });

  return { changeSet, ...ownership.result, existingServices: fetchedServices };
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

type DesiredIdPConfig = {
  name: string;
  idpConfig: Readonly<IdProviderConfig>;
  request: MessageInitShape<typeof CreateAuthIDPConfigRequestSchema> &
    MessageInitShape<typeof UpdateAuthIDPConfigRequestSchema>;
};

const idpConfigComparison = defineRequestComparison({
  schema: UpdateAuthIDPConfigRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

async function planIdPConfigs(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateIdPConfig, UpdateIdPConfig, DeleteIdPConfig>(
    "Auth idpConfigs",
  );

  for (const { namespaceName, auth } of namespaces) {
    const existingIdPConfigs = await listAuthIDPConfigsTolerant(client, workspaceId, namespaceName);
    const idpConfig = auth?.config.idProvider;
    const desired: DesiredIdPConfig[] = idpConfig
      ? [
          {
            name: idpConfig.name,
            idpConfig,
            request: { workspaceId, namespaceName, idpConfig: protoIdPConfig(idpConfig) },
          },
        ]
      : [];
    await diffKeyed({
      changeSet,
      desired,
      existing: existingIdPConfigs.map((existing) => [existing.name, existing] as const),
      keyOf: (desired) => desired.name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: async (desired, existing) => {
        const comparable = await comparableIdPConfigRequest(client, workspaceId, desired);
        return (
          comparable !== undefined &&
          isRequestUnchanged(idpConfigComparison, comparable, { idpConfig: existing })
        );
      },
      create: ({ name, idpConfig, request }) => ({ name, idpConfig, request }),
      update: ({ name, idpConfig, request }) => ({ name, idpConfig, request }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name, request: { workspaceId, namespaceName, name } }),
    });
  }
  return changeSet;
}

async function comparableIdPConfigRequest(
  client: OperatorClient,
  workspaceId: string,
  desired: DesiredIdPConfig,
): Promise<MessageInitShape<typeof UpdateAuthIDPConfigRequestSchema> | undefined> {
  const { idpConfig, request } = desired;
  if (idpConfig.kind !== "BuiltInIdP") {
    return request;
  }
  const config = await tryProtoBuiltinIdPConfig(client, workspaceId, idpConfig);
  return (
    config && {
      ...request,
      idpConfig: { name: request.idpConfig?.name, authType: request.idpConfig?.authType, config },
    }
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
      throw internalError(`Unexpected idp kind: ${idpConfig satisfies never}`);
  }
}

/**
 * Name the secret that holds a built-in IdP client's secret, which the Auth IdP config reads.
 * @param builtinIdP - Built-in IdP config naming the IdP and its client
 * @returns Vault and secret key of the client's secret
 */
export function builtinIdPClientSecret(builtinIdP: Pick<BuiltinIdP, "namespace" | "clientName">) {
  return {
    vaultName: idpClientVaultName(builtinIdP.namespace, builtinIdP.clientName),
    secretKey: idpClientSecretName(builtinIdP.namespace, builtinIdP.clientName),
  };
}

async function protoBuiltinIdPConfig(
  client: OperatorClient,
  workspaceId: string,
  builtinIdPConfig: BuiltinIdP,
): Promise<MessageInitShape<typeof AuthIDPConfig_ConfigSchema>> {
  const config = await tryProtoBuiltinIdPConfig(client, workspaceId, builtinIdPConfig);
  if (!config) {
    throw CLIError({
      code: "IDP_NOT_FOUND",
      message: `Built-in IdP "${builtinIdPConfig.namespace}" not found.`,
      suggestion: "Ensure that idp is configured correctly.",
    });
  }
  return config;
}

async function tryProtoBuiltinIdPConfig(
  client: OperatorClient,
  workspaceId: string,
  builtinIdPConfig: BuiltinIdP,
): Promise<MessageInitShape<typeof AuthIDPConfig_ConfigSchema> | undefined> {
  const idpService = await getOrNull(async () => {
    return await client.getIdPService({
      workspaceId,
      namespaceName: builtinIdPConfig.namespace,
    });
  });
  if (!idpService) return undefined;

  const idpClient = await getOrNull(async () => {
    return await client.getIdPClient({
      workspaceId,
      namespaceName: builtinIdPConfig.namespace,
      name: builtinIdPConfig.clientName,
    });
  });
  if (!idpClient) return undefined;

  return {
    config: {
      case: "oidc",
      value: {
        clientIdKey: idpClient.client?.clientId,
        clientSecretKey: builtinIdPClientSecret(builtinIdPConfig),
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

/**
 * Name the user profile config of an auth namespace in deploy plans.
 * @param namespaceName - Auth namespace
 * @returns Plan entry name of the namespace's user profile config
 */
export function authUserProfileConfigName(namespaceName: string): string {
  return `${namespaceName}-user-profile-config`;
}

const userProfileConfigComparison = defineRequestComparison({
  schema: UpdateUserProfileConfigRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
  normalize: ({ userProfileProviderConfig }) => {
    const config = userProfileProviderConfig?.config?.config;
    if (config?.case === "tailordb") {
      config.value.attributesFields.sort();
    }
  },
});

async function planUserProfileConfigs(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<
    CreateUserProfileConfig,
    UpdateUserProfileConfig,
    DeleteUserProfileConfig
  >("Auth userProfileConfigs");

  for (const { namespaceName, auth } of namespaces) {
    const name = authUserProfileConfigName(namespaceName);
    const existing = await getUserProfileConfigOrNull(client, workspaceId, namespaceName);
    const userProfile = auth?.userProfile;
    await diffKeyed({
      changeSet,
      desired: userProfile
        ? [
            {
              workspaceId,
              namespaceName,
              userProfileProviderConfig: protoUserProfileConfig(userProfile),
            },
          ]
        : [],
      existing: [[name, existing] as const],
      keyOf: () => name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (request, existing) =>
        isRequestUnchanged(userProfileConfigComparison, request, {
          userProfileProviderConfig: existing,
        }),
      create: (request) => ({ name, request }),
      update: (request) => ({ name, request }),
      unchanged: () => ({ name }),
      delete: () => ({ name, request: { workspaceId, namespaceName } }),
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

/**
 * Name the tenant config of an auth namespace in deploy plans.
 * @param namespaceName - Auth namespace
 * @returns Plan entry name of the namespace's tenant config
 */
export function authTenantConfigName(namespaceName: string): string {
  return `${namespaceName}-tenant-config`;
}

const tenantConfigComparison = defineRequestComparison({
  schema: UpdateTenantConfigRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

async function planTenantConfigs(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateTenantConfig, UpdateTenantConfig, DeleteTenantConfig>(
    "Auth tenantConfigs",
  );

  for (const { namespaceName, auth } of namespaces) {
    const name = authTenantConfigName(namespaceName);
    const existing = await getTenantConfigOrNull(client, workspaceId, namespaceName);
    const tenantProvider = auth?.config.tenantProvider;
    await diffKeyed({
      changeSet,
      desired: tenantProvider
        ? [{ workspaceId, namespaceName, tenantProviderConfig: protoTenantConfig(tenantProvider) }]
        : [],
      existing: [[name, existing] as const],
      keyOf: () => name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (request, existing) =>
        isRequestUnchanged(tenantConfigComparison, request, { tenantProviderConfig: existing }),
      create: (request) => ({ name, request }),
      update: (request) => ({ name, request }),
      unchanged: () => ({ name }),
      delete: () => ({ name, request: { workspaceId, namespaceName } }),
    });
  }
  return changeSet;
}

function protoTenantConfig(
  tenantConfig: TenantProviderConfig,
): MessageInitShape<typeof TenantProviderConfigSchema> {
  return {
    provider: "TAILORDB",
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

type DesiredMachineUser = {
  name: string;
  request: MessageInitShape<typeof CreateAuthMachineUserRequestSchema> &
    MessageInitShape<typeof UpdateAuthMachineUserRequestSchema>;
};

const machineUserComparison = defineRequestComparison({
  schema: UpdateAuthMachineUserRequestSchema,
  excluded: ["workspaceId", "authNamespace"],
  normalize: (request) => {
    request.attributes.sort();
  },
});

async function planMachineUsers(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateMachineUser, UpdateMachineUser, DeleteMachineUser>(
    "Auth machineUsers",
  );

  for (const { namespaceName, auth } of namespaces) {
    const existingMachineUsers = await listAuthMachineUsersTolerant(
      client,
      workspaceId,
      namespaceName,
    );
    const desired: DesiredMachineUser[] = [];
    const machineUsers = auth?.config.machineUsers ?? {};
    for (const name of Object.keys(machineUsers)) {
      const machineUser = machineUsers[name];
      if (!machineUser) {
        continue;
      }
      desired.push({
        name,
        request: {
          workspaceId,
          authNamespace: namespaceName,
          name,
          attributes: machineUser.attributeList,
          attributeMap: machineUser.attributes
            ? protoMachineUserAttributeMap(machineUser.attributes)
            : undefined,
        },
      });
    }
    await diffKeyed({
      changeSet,
      desired,
      existing: existingMachineUsers.map((existing) => [existing.name, existing] as const),
      keyOf: (machineUser) => machineUser.name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (machineUser, existing) =>
        isRequestUnchanged(machineUserComparison, machineUser.request, existing),
      create: ({ name, request }) => ({ name, request }),
      update: ({ name, request }) => ({ name, request }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name, request: { workspaceId, authNamespace: namespaceName, name } }),
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

type DesiredOAuth2Client = {
  name: string;
  request: MessageInitShape<typeof CreateAuthOAuth2ClientRequestSchema> &
    MessageInitShape<typeof UpdateAuthOAuth2ClientRequestSchema>;
  /** The request with its `:url` redirect URIs resolved as the plan resolves them. */
  comparableRequest: MessageInitShape<typeof UpdateAuthOAuth2ClientRequestSchema>;
};

const oauth2ClientComparison = defineRequestComparison({
  schema: UpdateAuthOAuth2ClientRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
  normalize: ({ oauth2Client }) => {
    if (!oauth2Client) return;
    // The platform generates the credentials and the creation time.
    oauth2Client.clientId = "";
    oauth2Client.clientSecret = "";
    oauth2Client.createdAt = undefined;
    oauth2Client.grantTypes.sort((left, right) => left - right);
    oauth2Client.redirectUris.sort();
    // The platform stores whole seconds, and the parser's defaults for an omitted lifetime.
    oauth2Client.accessTokenLifetime = wholeSecondsLifetime(
      oauth2Client.accessTokenLifetime ??
        create(DurationSchema, { seconds: BigInt(DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS) }),
    );
    oauth2Client.refreshTokenLifetime = wholeSecondsLifetime(
      oauth2Client.refreshTokenLifetime ??
        create(DurationSchema, { seconds: BigInt(DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS) }),
    );
    // The platform returns no idle lifetime for a client that has none.
    oauth2Client.refreshTokenIdleLifetime =
      oauth2Client.refreshTokenIdleLifetime &&
      wholeSecondsLifetime(oauth2Client.refreshTokenIdleLifetime);
  },
});

function wholeSecondsLifetime(lifetime: Duration): Duration {
  return create(DurationSchema, { seconds: lifetime.seconds });
}

async function planOAuth2Clients(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
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
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [oauth2Clients, nextPageToken];
    });
  };

  for (const { namespaceName, auth } of namespaces) {
    const existingOAuth2Clients = await fetchOAuth2Clients(namespaceName);
    const desired: DesiredOAuth2Client[] = [];
    const oauth2Clients = auth?.config.oauth2Clients ?? {};
    for (const name of Object.keys(oauth2Clients)) {
      const config = oauth2Clients[name];
      if (!config) {
        continue;
      }
      const oauth2Client = protoOAuth2Client(name, config);
      const redirectUris = await resolveStaticWebsiteUrls(
        client,
        workspaceId,
        oauth2Client.redirectUris ?? [],
        "OAuth2 redirect URIs",
        { expectedLocalNames: expectedLocalWebsites },
      );
      const request = { workspaceId, namespaceName, oauth2Client };
      desired.push({
        name,
        request,
        comparableRequest: { ...request, oauth2Client: { ...oauth2Client, redirectUris } },
      });
    }
    await diffKeyed({
      changeSet,
      desired,
      existing: existingOAuth2Clients.map((existing) => [existing.name, existing] as const),
      keyOf: (oauth2Client) => oauth2Client.name,
      versionMatches: () => !forceApplyAll,
      // A client type change is applied by deleting and recreating the client.
      replace: ({ name, request }, existing) =>
        existing.clientType === request.oauth2Client?.clientType
          ? undefined
          : {
              name,
              deleteRequest: { workspaceId, namespaceName, name },
              createRequest: request,
            },
      isConfigUnchanged: ({ comparableRequest }, existing) => {
        // The listing omits only the client secret, which the comparison clears anyway.
        const { $typeName: _summary, ...listed } = existing;
        return isRequestUnchanged(oauth2ClientComparison, comparableRequest, {
          oauth2Client: create(AuthOAuth2ClientSchema, listed),
        });
      },
      create: ({ name, request }) => ({ name, request }),
      update: ({ name, request }) => ({ name, request }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name, request: { workspaceId, namespaceName, name } }),
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
          throw internalError(`Unknown OAuth2 client grant type: ${grantType satisfies never}`);
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
    refreshTokenIdleLifetime: oauth2Client.refreshTokenIdleLifetimeSeconds,
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

/**
 * Name the SCIM config of an auth namespace in deploy plans.
 * @param namespaceName - Auth namespace
 * @returns Plan entry name of the namespace's SCIM config
 */
export function authSCIMConfigName(namespaceName: string): string {
  return `${namespaceName}-scim-config`;
}

const scimConfigComparison = defineRequestComparison({
  schema: UpdateAuthSCIMConfigRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

async function planSCIMConfigs(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateSCIMConfig, UpdateSCIMConfig, DeleteSCIMConfig>(
    "Auth scimConfigs",
  );

  for (const { namespaceName, auth } of namespaces) {
    const name = authSCIMConfigName(namespaceName);
    const existing = await getAuthSCIMConfigOrNull(client, workspaceId, namespaceName);
    const scim = auth?.config.scim;
    await diffKeyed({
      changeSet,
      desired: scim ? [{ workspaceId, namespaceName, scimConfig: protoSCIMConfig(scim) }] : [],
      existing: [[name, existing] as const],
      keyOf: () => name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (request, existing) =>
        isRequestUnchanged(scimConfigComparison, request, { scimConfig: existing }),
      create: (request) => ({ name, request }),
      update: (request) => ({ name, request }),
      unchanged: () => ({ name }),
      delete: () => ({ name, request: { workspaceId, namespaceName } }),
    });
  }
  return changeSet;
}

function protoSCIMConfig(scimConfig: SCIMConfig): MessageInitShape<typeof AuthSCIMConfigSchema> {
  const { machineUserName, authorization } = scimConfig;
  switch (authorization.type) {
    case "bearer":
      return {
        machineUserName,
        authorizationType: AuthSCIMConfig_AuthorizationType.BEARER,
        authorizationConfig: {
          case: "bearerSecret",
          value: {
            vaultName: authorization.bearerSecret?.vaultName,
            secretKey: authorization.bearerSecret?.secretKey,
          },
        },
      };
    case "oauth2":
      return { machineUserName, authorizationType: AuthSCIMConfig_AuthorizationType.OAUTH2 };
    default:
      throw internalError(`Unknown SCIM authorization type: ${authorization.type satisfies never}`);
  }
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

const scimResourceComparison = defineRequestComparison({
  schema: UpdateAuthSCIMResourceRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

async function planSCIMResources(
  client: OperatorClient,
  workspaceId: string,
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateSCIMResource, UpdateSCIMResource, DeleteSCIMResource>(
    "Auth scimResources",
  );

  for (const { namespaceName, auth } of namespaces) {
    const existingSCIMResources = await getAuthSCIMResourcesOrEmpty(
      client,
      workspaceId,
      namespaceName,
    );
    await diffKeyed({
      changeSet,
      desired: (auth?.config.scim?.resources ?? []).map((scimResource) => ({
        name: scimResource.name,
        request: { workspaceId, namespaceName, scimResource: protoSCIMResource(scimResource) },
      })),
      existing: existingSCIMResources.map((existing) => [existing.name, existing] as const),
      keyOf: (scimResource) => scimResource.name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: ({ request }, existing) =>
        isRequestUnchanged(scimResourceComparison, request, { scimResource: existing }),
      create: ({ name, request }) => ({ name, request }),
      update: ({ name, request }) => ({ name, request }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name, request: { workspaceId, namespaceName, name } }),
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
      throw internalError(`Unknown SCIM attribute type: ${attr.type satisfies never}`);
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
        throw internalError(
          `Unknown SCIM attribute mutability: ${attr.mutability satisfies never}`,
        );
    }
  }
  let uniqueness;
  const configUniqueness = attr.uniqueness ?? "none";
  switch (configUniqueness) {
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
      throw internalError(`Unknown SCIM attribute uniqueness: ${configUniqueness satisfies never}`);
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

const authHookComparison = defineRequestComparison({
  schema: UpdateAuthHookRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
});

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
  namespaces: ReadonlyArray<AuthNamespace>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateAuthHook, UpdateAuthHook, DeleteAuthHook>("Auth hooks");

  for (const { namespaceName, auth } of namespaces) {
    const name = `${namespaceName}/before-login`;
    const existingHook = await getOrNull(async () => {
      const { hook } = await client.getAuthHook({
        workspaceId,
        namespaceName,
        hookPoint: AuthHookPoint.BEFORE_LOGIN,
      });
      return hook;
    });
    const beforeLogin = auth?.config.hooks?.beforeLogin;
    await diffKeyed({
      changeSet,
      desired: beforeLogin
        ? [
            {
              workspaceId,
              namespaceName,
              hook: {
                hookPoint: AuthHookPoint.BEFORE_LOGIN,
                scriptRef: authHookFunctionName(namespaceName, "before-login"),
                invoker: { namespace: namespaceName, machineUserName: beforeLogin.invoker },
              },
            },
          ]
        : [],
      existing: [[name, existingHook] as const],
      keyOf: () => name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (request, existing) =>
        isRequestUnchanged(authHookComparison, request, { hook: existing }),
      create: (request) => ({ name, request }),
      update: (request) => ({ name, request }),
      unchanged: () => ({ name }),
      delete: () => ({
        name,
        request: { workspaceId, namespaceName, hookPoint: AuthHookPoint.BEFORE_LOGIN },
      }),
    });
  }

  return changeSet;
}
