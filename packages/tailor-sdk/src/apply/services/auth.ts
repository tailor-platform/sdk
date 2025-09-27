import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  type CreateAuthIDPConfigRequestSchema,
  type CreateAuthMachineUserRequestSchema,
  type CreateAuthOAuth2ClientRequestSchema,
  type CreateAuthSCIMConfigRequestSchema,
  type CreateAuthSCIMResourceRequestSchema,
  type CreateAuthServiceRequestSchema,
  type CreateTenantConfigRequestSchema,
  type CreateUserProfileConfigRequestSchema,
  type DeleteAuthIDPConfigRequestSchema,
  type DeleteAuthMachineUserRequestSchema,
  type DeleteAuthOAuth2ClientRequestSchema,
  type DeleteAuthSCIMConfigRequestSchema,
  type DeleteAuthSCIMResourceRequestSchema,
  type DeleteAuthServiceRequestSchema,
  type DeleteTenantConfigRequestSchema,
  type DeleteUserProfileConfigRequestSchema,
  type UpdateAuthIDPConfigRequestSchema,
  type UpdateAuthMachineUserRequestSchema,
  type UpdateAuthOAuth2ClientRequestSchema,
  type UpdateAuthSCIMConfigRequestSchema,
  type UpdateAuthSCIMResourceRequestSchema,
  type UpdateTenantConfigRequestSchema,
  type UpdateUserProfileConfigRequestSchema,
} from "@tailor-proto/tailor/v1/auth_pb";
import {
  AuthIDPConfig_AuthType,
  type AuthIDPConfig_ConfigSchema,
  type AuthIDPConfigSchema,
  AuthOAuth2Client_GrantType,
  AuthOAuth2Client_ClientType,
  type AuthOAuth2ClientSchema,
  AuthSCIMAttribute_Mutability,
  AuthSCIMAttribute_Type,
  AuthSCIMAttribute_Uniqueness,
  type AuthSCIMAttributeSchema,
  AuthSCIMConfig_AuthorizationType,
  type AuthSCIMConfigSchema,
  type AuthSCIMResourceSchema,
  TenantProviderConfig_TenantProviderType,
  type TenantProviderConfigSchema,
  UserProfileProviderConfig_UserProfileProviderType,
  type UserProfileProviderConfigSchema,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import {
  type AuthService,
  type BuiltinIdP,
  type IdProviderConfig,
  type OAuth2Client,
  type SCIMAttribute,
  type SCIMConfig,
  type SCIMResource,
  type TenantProvider,
  type TenantProviderConfig,
  type UserProfileProvider,
  type UserProfileProviderConfig,
} from "@/services";
import { type ValueOperand } from "@/services/tailordb/permission";
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
      if (create.idpConfig.Config.Kind === "BuiltInIdP") {
        create.request.idpConfig!.config = await protoBuiltinIdPConfig(
          client,
          create.request.workspaceId!,
          create.idpConfig.Config,
        );
      }
      await client.createAuthIDPConfig(create.request);
    }
    for (const update of changeSet.idpConfig.updates) {
      if (update.idpConfig.Config.Kind === "BuiltInIdP") {
        update.request.idpConfig!.config = await protoBuiltinIdPConfig(
          client,
          update.request.workspaceId!,
          update.idpConfig.Config,
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
    if (existingNameSet.has(config.namespace)) {
      changeSet.updates.push({
        name: config.namespace,
      });
      existingNameSet.delete(config.namespace);
    } else {
      changeSet.creates.push({
        name: config.namespace,
        request: {
          workspaceId,
          namespaceName: config.namespace,
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
    const existingIdPConfigs = await fetchIdPConfigs(config.namespace);
    const existingNameSet = new Set<string>();
    existingIdPConfigs.forEach((idpConfig) => {
      existingNameSet.add(idpConfig.name);
    });
    for (const idpConfig of config.idProviderConfigs ?? []) {
      if (existingNameSet.has(idpConfig.Name)) {
        changeSet.updates.push({
          name: idpConfig.Name,
          idpConfig,
          request: {
            workspaceId,
            namespaceName: config.namespace,
            idpConfig: protoIdPConfig(idpConfig),
          },
        });
        existingNameSet.delete(idpConfig.Name);
      } else {
        changeSet.creates.push({
          name: idpConfig.Name,
          idpConfig,
          request: {
            workspaceId,
            namespaceName: config.namespace,
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
          namespaceName: config.namespace,
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
  switch (idpConfig.Config.Kind) {
    case "IDToken":
      return {
        name: idpConfig.Name,
        authType: AuthIDPConfig_AuthType.ID_TOKEN,
        config: {
          config: {
            case: "idToken",
            value: {
              providerUrl: idpConfig.Config.ProviderURL,
              clientId: idpConfig.Config.ClientID,
              issuerUrl: idpConfig.Config.IssuerURL,
              usernameClaim: idpConfig.Config.UsernameClaim,
            },
          },
        },
      };
    case "SAML":
      return {
        name: idpConfig.Name,
        authType: AuthIDPConfig_AuthType.SAML,
        config: {
          config: {
            case: "saml",
            value: {
              ...("MetadataURL" in idpConfig.Config
                ? { metadataUrl: idpConfig.Config.MetadataURL }
                : { rawMetadata: idpConfig.Config.RawMetadata }),
              spCertBase64: {
                vaultName: idpConfig.Config.SpCertBase64.VaultName,
                secretKey: idpConfig.Config.SpCertBase64.SecretKey,
              },
              spKeyBase64: {
                vaultName: idpConfig.Config.SpKeyBase64.VaultName,
                secretKey: idpConfig.Config.SpKeyBase64.SecretKey,
              },
            },
          },
        },
      };
    case "OIDC":
      return {
        name: idpConfig.Name,
        authType: AuthIDPConfig_AuthType.OIDC,
        config: {
          config: {
            case: "oidc",
            value: {
              clientIdKey: idpConfig.Config.ClientID,
              clientSecretKey: {
                vaultName: idpConfig.Config.ClientSecret.VaultName,
                secretKey: idpConfig.Config.ClientSecret.SecretKey,
              },
              providerUrl: idpConfig.Config.ProviderURL,
              issuerUrl: idpConfig.Config.IssuerURL,
              usernameClaim: idpConfig.Config.UsernameClaim,
            },
          },
        },
      };
    case "BuiltInIdP":
      return {
        name: idpConfig.Name,
        authType: AuthIDPConfig_AuthType.OIDC,
        // config is set at apply time
        config: {},
      };
    default:
      throw new Error(
        `Unknown IdP config: ${idpConfig.Config satisfies never}`,
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
    namespaceName: builtinIdPConfig.Namespace,
  });
  const idpClient = await client.getIdPClient({
    workspaceId,
    namespaceName: builtinIdPConfig.Namespace,
    name: builtinIdPConfig.ClientName,
  });
  const vaultName = `idp-${builtinIdPConfig.Namespace}-${builtinIdPConfig.ClientName}`;
  const secretKey = `client-secret-${builtinIdPConfig.Namespace}-${builtinIdPConfig.ClientName}`;
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

  for (const { config } of auths) {
    const name = `${config.namespace}-user-profile-config`;
    try {
      await client.getUserProfileConfig({
        workspaceId,
        namespaceName: config.namespace,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (config.userProfileProvider && config.userProfileProviderConfig) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.namespace,
              userProfileProviderConfig: protoUserProfileConfig(
                config.userProfileProvider,
                config.userProfileProviderConfig,
              ),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (config.userProfileProvider && config.userProfileProviderConfig) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.namespace,
          userProfileProviderConfig: protoUserProfileConfig(
            config.userProfileProvider,
            config.userProfileProviderConfig,
          ),
        },
      });
    } else {
      changeSet.deletes.push({
        tag: "user-profile-config-deleted",
        name,
        request: {
          workspaceId,
          namespaceName: config.namespace,
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
  userProfileProvider: UserProfileProvider,
  userProfileConfig: UserProfileProviderConfig,
): MessageInitShape<typeof UserProfileProviderConfigSchema> {
  return {
    provider: userProfileProvider,
    providerType: UserProfileProviderConfig_UserProfileProviderType.TAILORDB,
    config: {
      config: {
        case: "tailordb",
        value: {
          namespace: userProfileConfig.Namespace,
          type: userProfileConfig.Type,
          usernameField: userProfileConfig.UsernameField,
          tenantIdField: userProfileConfig.TenantIdField,
          attributesFields: userProfileConfig.AttributesFields,
          attributeMap: userProfileConfig.AttributeMap,
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

  for (const { config } of auths) {
    const name = `${config.namespace}-tenant-config`;
    try {
      await client.getTenantConfig({
        workspaceId,
        namespaceName: config.namespace,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (config.tenantProvider && config.tenantProviderConfig) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.namespace,
              tenantProviderConfig: protoTenantConfig(
                config.tenantProvider,
                config.tenantProviderConfig,
              ),
            },
          });
        }
        continue;
      }
      throw error;
    }
    if (config.tenantProvider && config.tenantProviderConfig) {
      changeSet.updates.push({
        name,
        request: {
          workspaceId,
          namespaceName: config.namespace,
          tenantProviderConfig: protoTenantConfig(
            config.tenantProvider,
            config.tenantProviderConfig,
          ),
        },
      });
    } else {
      changeSet.deletes.push({
        tag: "tenant-config-deleted",
        name,
        request: {
          workspaceId,
          namespaceName: config.namespace,
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
  tenantProvider: TenantProvider,
  tenantConfig: TenantProviderConfig,
): MessageInitShape<typeof TenantProviderConfigSchema> {
  return {
    provider: tenantProvider,
    providerType: TenantProviderConfig_TenantProviderType.TAILORDB,
    config: {
      config: {
        case: "tailordb",
        value: {
          namespace: tenantConfig.Namespace,
          type: tenantConfig.Type,
          signatureField: tenantConfig.SignatureField,
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
    const existingMachineUsers = await fetchMachineUsers(config.namespace);
    const existingNameSet = new Set<string>();
    existingMachineUsers.forEach((machineUser) => {
      existingNameSet.add(machineUser.name);
    });
    for (const machineUser of config.machineUsers ?? []) {
      if (existingNameSet.has(machineUser.Name)) {
        changeSet.updates.push({
          name: machineUser.Name,
          request: {
            workspaceId,
            authNamespace: config.namespace,
            name: machineUser.Name,
            attributes: machineUser.Attributes,
            attributeMap: machineUser.AttributeMap
              ? protoMachineUserAttributeMap(machineUser.AttributeMap)
              : undefined,
          },
        });
        existingNameSet.delete(machineUser.Name);
      } else {
        changeSet.creates.push({
          name: machineUser.Name,
          request: {
            workspaceId,
            authNamespace: config.namespace,
            name: machineUser.Name,
            attributes: machineUser.Attributes,
            attributeMap: machineUser.AttributeMap
              ? protoMachineUserAttributeMap(machineUser.AttributeMap)
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
          authNamespace: config.namespace,
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
    ret[key] = fromJson(ValueSchema, value);
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
    const existingOAuth2Clients = await fetchOAuth2Clients(config.namespace);
    const existingNameSet = new Set<string>();
    existingOAuth2Clients.forEach((oauth2Client) => {
      existingNameSet.add(oauth2Client.name);
    });
    for (const oauth2Client of config.oauth2Clients ?? []) {
      if (existingNameSet.has(oauth2Client.Name)) {
        changeSet.updates.push({
          name: oauth2Client.Name,
          request: {
            workspaceId,
            namespaceName: config.namespace,
            oauth2Client: protoOAuth2Client(oauth2Client),
          },
        });
        existingNameSet.delete(oauth2Client.Name);
      } else {
        changeSet.creates.push({
          name: oauth2Client.Name,
          request: {
            workspaceId,
            namespaceName: config.namespace,
            oauth2Client: protoOAuth2Client(oauth2Client),
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
          namespaceName: config.namespace,
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
  oauth2Client: OAuth2Client,
): MessageInitShape<typeof AuthOAuth2ClientSchema> {
  return {
    name: oauth2Client.Name,
    description: oauth2Client.Description,
    grantTypes: oauth2Client.GrantTypes?.map((grantType) => {
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
    redirectUris: oauth2Client.RedirectURIs,
    clientType: (
      {
        confidential: AuthOAuth2Client_ClientType.CONFIDENTIAL,
        public: AuthOAuth2Client_ClientType.PUBLIC,
        browser: AuthOAuth2Client_ClientType.BROWSER,
      } satisfies Record<
        NonNullable<OAuth2Client["ClientType"]>,
        AuthOAuth2Client_ClientType
      >
    )[oauth2Client.ClientType ?? "confidential"],
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
    const name = `${config.namespace}-scim-config`;
    try {
      await client.getAuthSCIMConfig({
        workspaceId,
        namespaceName: config.namespace,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        if (config.scimConfig) {
          changeSet.creates.push({
            name,
            request: {
              workspaceId,
              namespaceName: config.namespace,
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
          namespaceName: config.namespace,
          scimConfig: protoSCIMConfig(config.scimConfig),
        },
      });
    } else {
      changeSet.deletes.push({
        tag: "scim-config-deleted",
        name,
        request: {
          workspaceId,
          namespaceName: config.namespace,
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
  switch (scimConfig.Authorization.Type) {
    case "bearer":
      authorizationType = AuthSCIMConfig_AuthorizationType.BEARER;
      break;
    case "oauth2":
      authorizationType = AuthSCIMConfig_AuthorizationType.OAUTH2;
      break;
    default:
      throw new Error(
        `Unknown SCIM authorization type: ${scimConfig.Authorization.Type satisfies never}`,
      );
  }

  return {
    machineUserName: scimConfig.MachineUserName,
    authorizationType,
    authorizationConfig: {
      case: "bearerSecret",
      value: {
        vaultName: scimConfig.Authorization.BearerSecret?.VaultName,
        secretKey: scimConfig.Authorization.BearerSecret?.SecretKey,
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
    const existingSCIMResources = await fetchSCIMResources(config.namespace);
    const existingNameSet = new Set<string>();
    existingSCIMResources.forEach((scimResource) => {
      existingNameSet.add(scimResource.name);
    });
    for (const scimResource of config.scimConfig?.Resources ?? []) {
      if (existingNameSet.has(scimResource.Name)) {
        changeSet.updates.push({
          name: scimResource.Name,
          request: {
            workspaceId,
            namespaceName: config.namespace,
            scimResource: protoSCIMResource(scimResource),
          },
        });
        existingNameSet.delete(scimResource.Name);
      } else {
        changeSet.creates.push({
          name: scimResource.Name,
          request: {
            workspaceId,
            namespaceName: config.namespace,
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
          namespaceName: config.namespace,
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
    name: scimResource.Name,
    tailorDbNamespace: scimResource.TailorDBNamespace,
    tailorDbType: scimResource.TailorDBType,
    coreSchema: {
      name: scimResource.CoreSchema.Name,
      attributes: scimResource.CoreSchema.Attributes.map((attr) =>
        protoSCIMAttribute(attr),
      ),
    },
    attributeMapping: scimResource.AttributeMapping.map((attr) => ({
      tailorDbField: attr.TailorDBField,
      scimPath: attr.SCIMPath,
    })),
  };
}

function protoSCIMAttribute(
  attr: SCIMAttribute,
): MessageInitShape<typeof AuthSCIMAttributeSchema> {
  let typ;
  switch (attr.Type) {
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
        `Unknown SCIM attribute type: ${attr.Type satisfies never}`,
      );
  }
  let mutability;
  if (attr.Mutability) {
    switch (attr.Mutability) {
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
          `Unknown SCIM attribute mutability: ${attr.Mutability satisfies never}`,
        );
    }
  }
  let uniqueness;
  if (attr.Uniqueness) {
    switch (attr.Uniqueness) {
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
          `Unknown SCIM attribute uniqueness: ${attr.Uniqueness satisfies never}`,
        );
    }
  }
  return {
    type: typ,
    name: attr.Name,
    description: attr.Description,
    mutability,
    required: attr.Required,
    multiValued: attr.MultiValued,
    uniqueness,
    canonicalValues: attr.CanonicalValues ?? undefined,
    subAttributes: attr.SubAttributes?.map((attr) => protoSCIMAttribute(attr)),
  };
}
