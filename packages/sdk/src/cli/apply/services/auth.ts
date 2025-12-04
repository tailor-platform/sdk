import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthIDPConfig_AuthType,
  AuthOAuth2Client_ClientType,
  AuthOAuth2Client_GrantType,
  AuthSCIMAttribute_Mutability,
  AuthSCIMAttribute_Type,
  AuthSCIMAttribute_Uniqueness,
  AuthSCIMConfig_AuthorizationType,
  TenantProviderConfig_TenantProviderType,
  UserProfileProviderConfig_UserProfileProviderType,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import {
  fetchAll,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "../../client";
import { idpClientSecretName, idpClientVaultName } from "./idp";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { AuthService } from "@/cli/application/auth/service";
import type {
  BuiltinIdP,
  IdProviderConfig,
  OAuth2Client,
  SCIMAttribute,
  SCIMConfig,
  SCIMResource,
  AuthAttributeValue,
} from "@/parser/service/auth";
import type {
  CreateAuthIDPConfigRequestSchema,
  CreateAuthMachineUserRequestSchema,
  CreateAuthOAuth2ClientRequestSchema,
  CreateAuthSCIMConfigRequestSchema,
  CreateAuthSCIMResourceRequestSchema,
  CreateAuthServiceRequestSchema,
  CreateTenantConfigRequestSchema,
  CreateUserProfileConfigRequestSchema,
  DeleteAuthIDPConfigRequestSchema,
  DeleteAuthMachineUserRequestSchema,
  DeleteAuthOAuth2ClientRequestSchema,
  DeleteAuthSCIMConfigRequestSchema,
  DeleteAuthSCIMResourceRequestSchema,
  DeleteAuthServiceRequestSchema,
  DeleteTenantConfigRequestSchema,
  DeleteUserProfileConfigRequestSchema,
  UpdateAuthIDPConfigRequestSchema,
  UpdateAuthMachineUserRequestSchema,
  UpdateAuthOAuth2ClientRequestSchema,
  UpdateAuthSCIMConfigRequestSchema,
  UpdateAuthSCIMResourceRequestSchema,
  UpdateTenantConfigRequestSchema,
  UpdateUserProfileConfigRequestSchema,
} from "@tailor-proto/tailor/v1/auth_pb";
import type {
  AuthIDPConfig_ConfigSchema,
  AuthIDPConfigSchema,
  AuthOAuth2ClientSchema,
  AuthSCIMAttributeSchema,
  AuthSCIMConfigSchema,
  AuthSCIMResourceSchema,
  TenantProviderConfigSchema,
  UserProfileProviderConfigSchema,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyAuth(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planAuth>>,
  phase: ApplyPhase = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createAuthService(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map((update) =>
        client.setMetadata(update.metaRequest),
      ),
    ]);

    // IdPConfigs
    await Promise.all([
      ...changeSet.idpConfig.creates.map(async (create) => {
        if (create.idpConfig.kind === "BuiltInIdP") {
          create.request.idpConfig!.config = await protoBuiltinIdPConfig(
            client,
            create.request.workspaceId!,
            create.idpConfig,
          );
        }
        return client.createAuthIDPConfig(create.request);
      }),
      ...changeSet.idpConfig.updates.map(async (update) => {
        if (update.idpConfig.kind === "BuiltInIdP") {
          update.request.idpConfig!.config = await protoBuiltinIdPConfig(
            client,
            update.request.workspaceId!,
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
      ...changeSet.tenantConfig.creates.map((create) =>
        client.createTenantConfig(create.request),
      ),
      ...changeSet.tenantConfig.updates.map((update) =>
        client.updateTenantConfig(update.request),
      ),
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

    // OAuth2Clients
    await Promise.all([
      ...changeSet.oauth2Client.creates.map(async (create) => {
        create.request.oauth2Client!.redirectUris =
          await resolveStaticWebsiteUrls(
            client,
            create.request.workspaceId!,
            create.request.oauth2Client!.redirectUris,
            "OAuth2 redirect URIs",
          );
        return client.createAuthOAuth2Client(create.request);
      }),
      ...changeSet.oauth2Client.updates.map(async (update) => {
        update.request.oauth2Client!.redirectUris =
          await resolveStaticWebsiteUrls(
            client,
            update.request.workspaceId!,
            update.request.oauth2Client!.redirectUris,
            "OAuth2 redirect URIs",
          );
        return client.updateAuthOAuth2Client(update.request);
      }),
    ]);

    // SCIMConfigs
    await Promise.all([
      ...changeSet.scim.creates.map((create) =>
        client.createAuthSCIMConfig(create.request),
      ),
      ...changeSet.scim.updates.map((update) =>
        client.updateAuthSCIMConfig(update.request),
      ),
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
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // SCIMResources
    await Promise.all(
      changeSet.scimResource.deletes.map((del) =>
        client.deleteAuthSCIMResource(del.request),
      ),
    );

    // SCIMConfigs
    await Promise.all(
      changeSet.scim.deletes.map((del) =>
        client.deleteAuthSCIMConfig(del.request),
      ),
    );

    // OAuth2Clients
    await Promise.all(
      changeSet.oauth2Client.deletes.map((del) =>
        client.deleteAuthOAuth2Client(del.request),
      ),
    );

    // MachineUsers
    await Promise.all(
      changeSet.machineUser.deletes.map((del) =>
        client.deleteAuthMachineUser(del.request),
      ),
    );

    // TenantConfigs
    await Promise.all(
      changeSet.tenantConfig.deletes.map((del) =>
        client.deleteTenantConfig(del.request),
      ),
    );

    // UserProfileConfigs
    await Promise.all(
      changeSet.userProfileConfig.deletes.map((del) =>
        client.deleteUserProfileConfig(del.request),
      ),
    );

    // IdPConfigs
    await Promise.all(
      changeSet.idpConfig.deletes.map((del) =>
        client.deleteAuthIDPConfig(del.request),
      ),
    );

    // Services
    await Promise.all(
      changeSet.service.deletes.map((del) =>
        client.deleteAuthService(del.request),
      ),
    );
  }
}

export async function planAuth({
  client,
  workspaceId,
  application,
  forRemoval,
}: PlanContext) {
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
  } = await planServices(client, workspaceId, application.name, auths);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const idpConfigChangeSet = await planIdPConfigs(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const userProfileConfigChangeSet = await planUserProfileConfigs(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const tenantConfigChangeSet = await planTenantConfigs(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const machineUserChangeSet = await planMachineUsers(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const oauth2ClientChangeSet = await planOAuth2Clients(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const scimChangeSet = await planSCIMConfigs(
    client,
    workspaceId,
    auths,
    deletedServices,
  );
  const scimResourceChangeSet = await planSCIMResources(
    client,
    workspaceId,
    auths,
    deletedServices,
  );

  serviceChangeSet.print();
  idpConfigChangeSet.print();
  userProfileConfigChangeSet.print();
  tenantConfigChangeSet.print();
  machineUserChangeSet.print();
  oauth2ClientChangeSet.print();
  scimChangeSet.print();
  scimResourceChangeSet.print();
  return {
    changeSet: {
      service: serviceChangeSet,
      idpConfig: idpConfigChangeSet,
      userProfileConfig: userProfileConfigChangeSet,
      tenantConfig: tenantConfigChangeSet,
      machineUser: machineUserChangeSet,
      oauth2Client: oauth2ClientChangeSet,
      scim: scimChangeSet,
      scimResource: scimResourceChangeSet,
    },
    conflicts,
    unmanaged,
    resourceOwners,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateAuthServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthServiceRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:auth:${name}`;
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
) {
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> =
    new ChangeSet("Auth services");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken) => {
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

  for (const { config } of auths) {
    const existing = existingServices[config.name];
    const metaRequest = await buildMetaRequest(
      trn(workspaceId, config.name),
      appName,
    );
    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Auth service",
          resourceName: config.name,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "Auth service",
          resourceName: config.name,
          currentOwner: existing.label,
        });
      }

      changeSet.updates.push({
        name: config.name,
        metaRequest,
      });
      delete existingServices[config.name];
    } else {
      changeSet.creates.push({
        name: config.name,
        request: {
          workspaceId,
          namespaceName: config.name,
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
) {
  const changeSet: ChangeSet<
    CreateIdPConfig,
    UpdateIdPConfig,
    DeleteIdPConfig
  > = new ChangeSet("Auth idpConfigs");

  const fetchIdPConfigs = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
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
  };

  for (const { config } of auths) {
    const existingIdPConfigs = await fetchIdPConfigs(config.name);
    const existingNameSet = new Set<string>();
    existingIdPConfigs.forEach((idpConfig) => {
      existingNameSet.add(idpConfig.name);
    });
    const idpConfig = config.idProvider;
    if (idpConfig) {
      if (existingNameSet.has(idpConfig.name)) {
        changeSet.updates.push({
          name: idpConfig.name,
          idpConfig,
          request: {
            workspaceId,
            namespaceName: config.name,
            idpConfig: protoIdPConfig(idpConfig),
          },
        });
        existingNameSet.delete(idpConfig.name);
      } else {
        changeSet.creates.push({
          name: idpConfig.name,
          idpConfig,
          request: {
            workspaceId,
            namespaceName: config.name,
            idpConfig: protoIdPConfig(idpConfig),
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

function protoIdPConfig(
  idpConfig: IdProviderConfig,
): MessageInitShape<typeof AuthIDPConfigSchema> {
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
                : { rawMetadata: idpConfig.rawMetadata! }),
              ...(idpConfig.spCertBase64 && {
                spCertBase64: {
                  vaultName: idpConfig.spCertBase64.vaultName,
                  secretKey: idpConfig.spCertBase64.secretKey,
                },
              }),
              ...(idpConfig.spKeyBase64 && {
                spKeyBase64: {
                  vaultName: idpConfig.spKeyBase64.vaultName,
                  secretKey: idpConfig.spKeyBase64.secretKey,
                },
              }),
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
  let idpService;
  try {
    idpService = await client.getIdPService({
      workspaceId,
      namespaceName: builtinIdPConfig.namespace,
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(
        `Built-in IdP "${builtinIdPConfig.namespace}" not found. Please ensure that idp is configured correctly.`,
      );
    }
    throw error;
  }
  const idpClient = await client.getIdPClient({
    workspaceId,
    namespaceName: builtinIdPConfig.namespace,
    name: builtinIdPConfig.clientName,
  });
  const vaultName = idpClientVaultName(
    builtinIdPConfig.namespace,
    builtinIdPConfig.clientName,
  );
  const secretKey = idpClientSecretName(
    builtinIdPConfig.namespace,
    builtinIdPConfig.clientName,
  );
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
) {
  const changeSet: ChangeSet<
    CreateUserProfileConfig,
    UpdateUserProfileConfig,
    DeleteUserProfileConfig
  > = new ChangeSet("Auth userProfileConfigs");

  for (const auth of auths) {
    const name = `${auth.config.name}-user-profile-config`;
    try {
      await client.getUserProfileConfig({
        workspaceId,
        namespaceName: auth.config.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (auth.userProfile) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: auth.config.name,
              userProfileProviderConfig: protoUserProfileConfig(
                auth.userProfile,
              ),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (auth.userProfile) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: auth.config.name,
          userProfileProviderConfig: protoUserProfileConfig(auth.userProfile),
        },
      });
    } else {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: auth.config.name,
        },
      });
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
    ? Object.fromEntries(
        Object.keys(userProfile.attributes).map((key) => [key, key]),
      )
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
) {
  const changeSet: ChangeSet<
    CreateTenantConfig,
    UpdateTenantConfig,
    DeleteTenantConfig
  > = new ChangeSet("Auth tenantConfigs");

  for (const auth of auths) {
    const name = `${auth.config.name}-tenant-config`;
    try {
      await client.getTenantConfig({
        workspaceId,
        namespaceName: auth.config.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (auth.tenantProvider) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: auth.config.name,
              tenantProviderConfig: protoTenantConfig(auth.tenantProvider),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (auth.tenantProvider) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: auth.config.name,
          tenantProviderConfig: protoTenantConfig(auth.tenantProvider),
        },
      });
    } else {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: auth.config.name,
        },
      });
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
  tenantConfig: NonNullable<AuthService["tenantProvider"]>,
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
) {
  const changeSet: ChangeSet<
    CreateMachineUser,
    UpdateMachineUser,
    DeleteMachineUser
  > = new ChangeSet("Auth machineUsers");

  const fetchMachineUsers = (authNamespace: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { machineUsers, nextPageToken } =
          await client.listAuthMachineUsers({
            workspaceId,
            authNamespace,
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
  };

  for (const { config } of auths) {
    const existingMachineUsers = await fetchMachineUsers(config.name);
    const existingNameSet = new Set<string>();
    existingMachineUsers.forEach((machineUser) => {
      existingNameSet.add(machineUser.name);
    });
    for (const machineUsername of Object.keys(config.machineUsers ?? {})) {
      const machineUser = config.machineUsers?.[machineUsername];
      if (!machineUser) {
        continue;
      }
      if (existingNameSet.has(machineUsername)) {
        changeSet.updates.push({
          name: machineUsername,
          request: {
            workspaceId,
            authNamespace: config.name,
            name: machineUsername,
            attributes: machineUser.attributeList,
            attributeMap: machineUser.attributes
              ? protoMachineUserAttributeMap(machineUser.attributes)
              : undefined,
          },
        });
        existingNameSet.delete(machineUsername);
      } else {
        changeSet.creates.push({
          name: machineUsername,
          request: {
            workspaceId,
            authNamespace: config.name,
            name: machineUsername,
            attributes: machineUser.attributeList,
            attributeMap: machineUser.attributes
              ? protoMachineUserAttributeMap(machineUser.attributes)
              : undefined,
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
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

async function planOAuth2Clients(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet: ChangeSet<
    CreateOAuth2Clients,
    UpdateOAuth2Client,
    DeleteOAuth2Client
  > = new ChangeSet("Auth oauth2Clients");

  const fetchOAuth2Clients = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
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
  };

  for (const { config } of auths) {
    const existingOAuth2Clients = await fetchOAuth2Clients(config.name);
    const existingNameSet = new Set<string>();
    existingOAuth2Clients.forEach((oauth2Client) => {
      existingNameSet.add(oauth2Client.name);
    });
    for (const oauth2ClientName of Object.keys(config.oauth2Clients ?? {})) {
      const oauth2Client = config.oauth2Clients?.[oauth2ClientName];
      if (!oauth2Client) {
        continue;
      }
      if (existingNameSet.has(oauth2ClientName)) {
        changeSet.updates.push({
          name: oauth2ClientName,
          request: {
            workspaceId,
            namespaceName: config.name,
            oauth2Client: protoOAuth2Client(oauth2ClientName, oauth2Client),
          },
        });
        existingNameSet.delete(oauth2ClientName);
      } else {
        changeSet.creates.push({
          name: oauth2ClientName,
          request: {
            workspaceId,
            namespaceName: config.name,
            oauth2Client: protoOAuth2Client(oauth2ClientName, oauth2Client),
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
  return {
    name: oauth2ClientName,
    description: oauth2Client.description,
    grantTypes: oauth2Client.grantTypes?.map((grantType) => {
      switch (grantType) {
        case "authorization_code":
          return AuthOAuth2Client_GrantType.AUTHORIZATION_CODE;
        case "refresh_token":
          return AuthOAuth2Client_GrantType.REFRESH_TOKEN;
        default:
          throw new Error(
            `Unknown OAuth2 client grant type: ${grantType satisfies never}`,
          );
      }
    }),
    redirectUris: oauth2Client.redirectURIs,
    clientType: (
      {
        confidential: AuthOAuth2Client_ClientType.CONFIDENTIAL,
        public: AuthOAuth2Client_ClientType.PUBLIC,
        browser: AuthOAuth2Client_ClientType.BROWSER,
      } satisfies Record<
        NonNullable<OAuth2Client["clientType"]>,
        AuthOAuth2Client_ClientType
      >
    )[oauth2Client.clientType ?? "confidential"],
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
  const changeSet: ChangeSet<
    CreateSCIMConfig,
    UpdateSCIMConfig,
    DeleteSCIMConfig
  > = new ChangeSet("Auth scimConfigs");

  for (const { config } of auths) {
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

function protoSCIMConfig(
  scimConfig: SCIMConfig,
): MessageInitShape<typeof AuthSCIMConfigSchema> {
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
  const changeSet: ChangeSet<
    CreateSCIMResource,
    UpdateSCIMResource,
    DeleteSCIMResource
  > = new ChangeSet("Auth scimResources");

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

  for (const { config } of auths) {
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
      attributes: scimResource.coreSchema.attributes.map((attr) =>
        protoSCIMAttribute(attr),
      ),
    },
    attributeMapping: scimResource.attributeMapping.map((attr) => ({
      tailorDbField: attr.tailorDBField,
      scimPath: attr.scimPath,
    })),
  };
}

function protoSCIMAttribute(
  attr: SCIMAttribute,
): MessageInitShape<typeof AuthSCIMAttributeSchema> {
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
      throw new Error(
        `Unknown SCIM attribute type: ${attr.type satisfies never}`,
      );
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
        throw new Error(
          `Unknown SCIM attribute mutability: ${attr.mutability satisfies never}`,
        );
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
        throw new Error(
          `Unknown SCIM attribute uniqueness: ${attr.uniqueness satisfies never}`,
        );
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
