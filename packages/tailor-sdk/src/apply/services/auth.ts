import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

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
import type {
  AuthService,
  BuiltinIdP,
  IdProviderConfig,
  OAuth2Client,
  SCIMAttribute,
  SCIMConfig,
  SCIMResource,
  ValueOperand,
} from "@/services";
import { type Workspace } from "@/workspace";
import { ChangeSet, type HasName } from ".";
import { type ApplyPhase } from "..";
import {
  fetchAll,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "../client";

export async function applyAuth(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planAuth>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Services
    for (const create of changeSet.service.creates) {
      await client.createAuthService(create.request);
    }

    // IdPConfigs
    for (const create of changeSet.idpConfig.creates) {
      if (create.idpConfig.config.kind === "BuiltInIdP") {
        create.request.idpConfig!.config = await protoBuiltinIdPConfig(
          client,
          create.request.workspaceId!,
          create.idpConfig.config,
        );
      }
      await client.createAuthIDPConfig(create.request);
    }
    for (const update of changeSet.idpConfig.updates) {
      if (update.idpConfig.config.kind === "BuiltInIdP") {
        update.request.idpConfig!.config = await protoBuiltinIdPConfig(
          client,
          update.request.workspaceId!,
          update.idpConfig.config,
        );
      }
      await client.updateAuthIDPConfig(update.request);
    }

    // UserProfileConfigs
    for (const create of changeSet.userProfileConfig.creates) {
      await client.createUserProfileConfig(create.request);
    }
    for (const update of changeSet.userProfileConfig.updates) {
      await client.updateUserProfileConfig(update.request);
    }

    // TenantConfigs
    for (const create of changeSet.tenantConfig.creates) {
      await client.createTenantConfig(create.request);
    }
    for (const update of changeSet.tenantConfig.updates) {
      await client.updateTenantConfig(update.request);
    }

    // MachineUsers
    for (const create of changeSet.machineUser.creates) {
      await client.createAuthMachineUser(create.request);
    }
    for (const update of changeSet.machineUser.updates) {
      await client.updateAuthMachineUser(update.request);
    }

    // OAuth2Clients
    for (const create of changeSet.oauth2Client.creates) {
      create.request.oauth2Client!.redirectUris =
        await resolveStaticWebsiteUrls(
          client,
          create.request.workspaceId!,
          create.request.oauth2Client!.redirectUris,
          "OAuth2 redirect URIs",
        );

      await client.createAuthOAuth2Client(create.request);
    }
    for (const update of changeSet.oauth2Client.updates) {
      update.request.oauth2Client!.redirectUris =
        await resolveStaticWebsiteUrls(
          client,
          update.request.workspaceId!,
          update.request.oauth2Client!.redirectUris,
          "OAuth2 redirect URIs",
        );

      await client.updateAuthOAuth2Client(update.request);
    }

    // SCIMConfigs
    for (const create of changeSet.scimConfig.creates) {
      await client.createAuthSCIMConfig(create.request);
    }
    for (const update of changeSet.scimConfig.updates) {
      await client.updateAuthSCIMConfig(update.request);
    }

    // SCIMResources
    for (const create of changeSet.scimResource.creates) {
      await client.createAuthSCIMResource(create.request);
    }
    for (const update of changeSet.scimResource.updates) {
      await client.updateAuthSCIMResource(update.request);
    }
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // SCIMResources
    for (const del of changeSet.scimResource.deletes) {
      if (del.tag === "scim-resource-deleted") {
        await client.deleteAuthSCIMResource(del.request);
      }
    }

    // SCIMConfigs
    for (const del of changeSet.scimConfig.deletes) {
      if (del.tag === "scim-config-deleted") {
        await client.deleteAuthSCIMConfig(del.request);
      }
    }

    // OAuth2Clients
    for (const del of changeSet.oauth2Client.deletes) {
      if (del.tag === "oauth2-client-deleted") {
        await client.deleteAuthOAuth2Client(del.request);
      }
    }

    // MachineUsers
    for (const del of changeSet.machineUser.deletes) {
      if (del.tag === "machine-user-deleted") {
        await client.deleteAuthMachineUser(del.request);
      }
    }

    // TenantConfigs
    for (const del of changeSet.tenantConfig.deletes) {
      if (del.tag === "tenant-config-deleted") {
        await client.deleteTenantConfig(del.request);
      }
    }

    // UserProfileConfigs
    for (const del of changeSet.userProfileConfig.deletes) {
      if (del.tag === "user-profile-config-deleted") {
        await client.deleteUserProfileConfig(del.request);
      }
    }

    // IdPConfigs
    for (const del of changeSet.idpConfig.deletes) {
      if (del.tag === "idp-config-deleted") {
        await client.deleteAuthIDPConfig(del.request);
      }
    }

    // Services
    for (const del of changeSet.service.deletes) {
      await client.deleteAuthService(del.request);
    }
  }
}

export async function planAuth(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
) {
  const auths: Readonly<AuthService>[] = [];
  for (const app of workspace.applications) {
    if (app.authService) {
      await app.authService.resolveNamespaces();
      auths.push(app.authService);
    }
  }
  const serviceChangeSet = await planServices(client, workspaceId, auths);
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
  const scimConfigChangeSet = await planSCIMConfigs(
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
  scimConfigChangeSet.print();
  scimResourceChangeSet.print();
  return {
    service: serviceChangeSet,
    idpConfig: idpConfigChangeSet,
    userProfileConfig: userProfileConfigChangeSet,
    tenantConfig: tenantConfigChangeSet,
    machineUser: machineUserChangeSet,
    oauth2Client: oauth2ClientChangeSet,
    scimConfig: scimConfigChangeSet,
    scimResource: scimResourceChangeSet,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateAuthServiceRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthServiceRequestSchema>;
};

type ServiceDeleted = {
  tag: "service-deleted";
  name: string;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  auths: ReadonlyArray<Readonly<AuthService>>,
) {
  const changeSet: ChangeSet<CreateService, HasName, DeleteService> =
    new ChangeSet("Auth services");

  const existingServices = await fetchAll(async (pageToken) => {
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
  const existingNameSet = new Set<string>();
  existingServices.forEach((service) => {
    const name = service.namespace?.name;
    if (name) {
      existingNameSet.add(name);
    }
  });
  for (const { config } of auths) {
    if (existingNameSet.has(config.name)) {
      changeSet.updates.push({
        name: config.name,
      });
      existingNameSet.delete(config.name);
    } else {
      changeSet.creates.push({
        name: config.name,
        request: {
          workspaceId,
          namespaceName: config.name,
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
  tag: "idp-config-deleted";
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
    DeleteIdPConfig | ServiceDeleted
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
    for (const idpConfig of config.idProviderConfigs ?? []) {
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
        tag: "idp-config-deleted",
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
        tag: "service-deleted",
        name: idpConfig.name,
      });
    });
  }
  return changeSet;
}

function protoIdPConfig(
  idpConfig: IdProviderConfig,
): MessageInitShape<typeof AuthIDPConfigSchema> {
  switch (idpConfig.config.kind) {
    case "IDToken":
      return {
        name: idpConfig.name,
        authType: AuthIDPConfig_AuthType.ID_TOKEN,
        config: {
          config: {
            case: "idToken",
            value: {
              providerUrl: idpConfig.config.providerURL,
              clientId: idpConfig.config.clientID,
              issuerUrl: idpConfig.config.issuerURL,
              usernameClaim: idpConfig.config.usernameClaim,
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
              ...("metadataURL" in idpConfig.config
                ? { metadataUrl: idpConfig.config.metadataURL }
                : { rawMetadata: idpConfig.config.rawMetadata }),
              spCertBase64: {
                vaultName: idpConfig.config.spCertBase64.VaultName,
                secretKey: idpConfig.config.spCertBase64.SecretKey,
              },
              spKeyBase64: {
                vaultName: idpConfig.config.spKeyBase64.VaultName,
                secretKey: idpConfig.config.spKeyBase64.SecretKey,
              },
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
              clientIdKey: idpConfig.config.clientID,
              clientSecretKey: {
                vaultName: idpConfig.config.clientSecret.VaultName,
                secretKey: idpConfig.config.clientSecret.SecretKey,
              },
              providerUrl: idpConfig.config.providerURL,
              issuerUrl: idpConfig.config.issuerURL,
              usernameClaim: idpConfig.config.usernameClaim,
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
      throw new Error(
        `Unknown IdP config: ${idpConfig.config satisfies never}`,
      );
  }
}

async function protoBuiltinIdPConfig(
  client: OperatorClient,
  workspaceId: string,
  builtinIdPConfig: BuiltinIdP,
): Promise<MessageInitShape<typeof AuthIDPConfig_ConfigSchema>> {
  const idpService = await client.getIdPService({
    workspaceId,
    namespaceName: builtinIdPConfig.namespace,
  });
  const idpClient = await client.getIdPClient({
    workspaceId,
    namespaceName: builtinIdPConfig.namespace,
    name: builtinIdPConfig.clientName,
  });
  const vaultName = `idp-${builtinIdPConfig.namespace}-${builtinIdPConfig.clientName}`;
  const secretKey = `client-secret-${builtinIdPConfig.namespace}-${builtinIdPConfig.clientName}`;
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
  tag: "user-profile-config-deleted";
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
    DeleteUserProfileConfig | ServiceDeleted
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
        tag: "user-profile-config-deleted",
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
      tag: "service-deleted",
      name: `${namespaceName}-user-profile-config`,
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
  tag: "tenant-config-deleted";
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
    DeleteTenantConfig | ServiceDeleted
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
        if (auth.tenantProviderConfig) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: auth.config.name,
              tenantProviderConfig: protoTenantConfig(
                auth.tenantProviderConfig,
              ),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (auth.tenantProviderConfig) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: auth.config.name,
          tenantProviderConfig: protoTenantConfig(auth.tenantProviderConfig),
        },
      });
    } else {
      changeSet.deletes.push({
        tag: "tenant-config-deleted",
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
      tag: "service-deleted",
      name: `${namespaceName}-tenant-config`,
    });
  }
  return changeSet;
}

function protoTenantConfig(
  tenantConfig: NonNullable<AuthService["tenantProviderConfig"]>,
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
  tag: "machine-user-deleted";
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
    DeleteMachineUser | ServiceDeleted
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
        tag: "machine-user-deleted",
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
        tag: "service-deleted",
        name: machineUser.name,
      });
    });
  }
  return changeSet;
}

function protoMachineUserAttributeMap(
  attributeMap: Record<string, ValueOperand>,
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
  tag: "oauth2-client-deleted";
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
    DeleteOAuth2Client | ServiceDeleted
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
        tag: "oauth2-client-deleted",
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
        tag: "service-deleted",
        name: oauth2Client.name,
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
  tag: "scim-config-deleted";
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
    DeleteSCIMConfig | ServiceDeleted
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
        if (config.scimConfig) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.name,
              scimConfig: protoSCIMConfig(config.scimConfig),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (config.scimConfig) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.name,
          scimConfig: protoSCIMConfig(config.scimConfig),
        },
      });
    } else {
      changeSet.deletes.push({
        tag: "scim-config-deleted",
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
      tag: "service-deleted",
      name: `${namespaceName}-scim-config`,
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
        vaultName: scimConfig.authorization.bearerSecret?.VaultName,
        secretKey: scimConfig.authorization.bearerSecret?.SecretKey,
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
  tag: "scim-resource-deleted";
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
    DeleteSCIMResource | ServiceDeleted
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
    for (const scimResource of config.scimConfig?.resources ?? []) {
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
        tag: "scim-resource-deleted",
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
        tag: "service-deleted",
        name: scimResource.name,
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
