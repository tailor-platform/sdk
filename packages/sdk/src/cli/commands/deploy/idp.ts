import { create, fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  type CreateIdPClientRequestSchema,
  type CreateIdPServiceRequestSchema,
  type DeleteIdPClientRequestSchema,
  type DeleteIdPServiceRequestSchema,
  UpdateIdPServiceRequestSchema,
} from "@tailor-platform/tailor-proto/idp_pb";
import {
  IdPDisableGqlOperationsSchema,
  IdPEmailConfigSchema,
  IdPLang,
  IdPPermissionOperator,
  IdPPermissionPermit,
  IdPPermissionSchema as ProtoIdPPermissionSchema,
  IdPUserAuthPolicySchema,
  type IdPPermissionConditionSchema as ProtoIdPPermissionConditionSchema,
  type IdPPermissionOperandSchema as ProtoIdPPermissionOperandSchema,
  type IdPPermissionPolicySchema as ProtoIdPPermissionPolicySchema,
} from "@tailor-platform/tailor-proto/idp_resource_pb";
import {
  fetchAllTolerant,
  getOrNull,
  isNotFoundError,
  resolveStaticWebsiteUrls,
  type OperatorClient,
} from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { publishEventsConflict, resolvePublishEvents } from "#/cli/shared/publish-events";
import { resourceNameSchema } from "#/parser/service/common";
import { ALL_EMAIL_DOMAINS, hasImplicitAllEmailDomains } from "#/parser/service/idp/email-domains";
import {
  findLoggedInOnlyPermitRules,
  findOmittedPermitRules,
  parseIdPPermission,
} from "#/parser/service/idp/permission";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import {
  actionPolicyLists,
  defineRequestComparison,
  emptyMessageAsUnset,
  isRequestUnchanged,
} from "./compare";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  addDependencyRecords,
  buildMetaRequest,
  type DependentAppsByResource,
  type DeployOwner,
  eventSourceKey,
  type MetadataLabelWrite,
  resourceTrn,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "./owned-resource";
import { expectedLocalStaticWebsiteNames } from "./staticwebsite";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type {
  IdPPermissionOperand,
  StandardIdPActionPermission,
  StandardIdPPermission,
  StandardIdPPermissionCondition,
} from "#/parser/service/idp/types";
import type { IdP, IdPLang as IdPLangInput } from "#/types/idp.generated";

type IdPServiceMutationRequest = {
  workspaceId?: string;
  namespaceName?: string;
  userAuthPolicy?: { allowedReturnOrigins?: string[] } | undefined;
};

async function resolveServiceReturnOrigins(
  client: OperatorClient,
  request: IdPServiceMutationRequest,
): Promise<void> {
  const policy = request.userAuthPolicy;
  const originals = policy?.allowedReturnOrigins;
  if (!policy || !originals?.length) {
    return;
  }
  const resolved = await resolveStaticWebsiteUrls(
    client,
    assertDefined(request.workspaceId, "request missing workspaceId"),
    originals,
    `IdP service "${request.namespaceName ?? ""}" allowedReturnOrigins`,
  );
  // resolveStaticWebsiteUrls warn-and-drops unresolvable entries, which is fine
  // for CORS but would silently clear an authoritative field here (UpdateIdP is
  // a full replacement, and `enable_mfa: true` requires ≥1 origin). Fail fast.
  if (resolved.length !== originals.length) {
    throw CLIError({
      code: "IDP_RETURN_ORIGIN_UNRESOLVED",
      message: `IdP service "${request.namespaceName ?? ""}" allowedReturnOrigins: ${originals.length - resolved.length} of ${originals.length} entries could not be resolved.`,
      suggestion: 'Check that each "<name>:url" entry refers to a deployed static website.',
    });
  }
  policy.allowedReturnOrigins = resolved;
}

/**
 * Build the vault name for an IdP client.
 * @param namespaceName - IdP namespace name
 * @param clientName - IdP client name
 * @returns Vault name
 */
export function idpClientVaultName(namespaceName: string, clientName: string) {
  return `idp-${namespaceName}-${clientName}`;
}

/**
 * Build the secret name for an IdP client.
 * @param namespaceName - IdP namespace name
 * @param clientName - IdP client name
 * @returns Secret name
 */
export function idpClientSecretName(namespaceName: string, clientName: string) {
  return `client-secret-${namespaceName}-${clientName}`;
}

/**
 * Apply IdP-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned IdP changes
 * @param phase - Apply phase
 * @returns Promise that resolves when IdP changes are applied
 */
export async function applyIdP(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planIdP>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Services. An unchanged service still gets its labels written, because its
    // dependency records can change while its definition does not.
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await resolveServiceReturnOrigins(client, create.request);
        await client.createIdPService(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await resolveServiceReturnOrigins(client, update.request);
        await client.updateIdPService(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
      ...changeSet.service.unchanged.flatMap((entry) =>
        entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
      ),
    ]);

    // Clients
    await Promise.all([
      ...changeSet.client.creates.map(async (create) => {
        const resp = await client.createIdPClient(create.request);
        if (resp.client?.clientSecret) logger.registerSecret(resp.client.clientSecret);

        // Create the secret manager vault and secret
        const vaultName = idpClientVaultName(
          assertDefined(create.request.namespaceName, "request missing namespaceName"),
          create.request.client?.name || "",
        );
        const secretName = idpClientSecretName(
          assertDefined(create.request.namespaceName, "request missing namespaceName"),
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
        const secretName = idpClientSecretName(update.namespaceName, update.name);
        const vault = await getOrNull(async () => {
          return await client.getSecretManagerVault({
            workspaceId: update.workspaceId,
            secretmanagerVaultName: vaultName,
          });
        });
        if (vault) return;
        const { client: idpClient } = await client.getIdPClient({
          workspaceId: update.workspaceId,
          namespaceName: update.namespaceName,
          name: update.name,
        });
        if (idpClient?.clientSecret) logger.registerSecret(idpClient.clientSecret);
        await client.createSecretManagerVault({
          workspaceId: update.workspaceId,
          secretmanagerVaultName: vaultName,
        });
        await client.createSecretManagerSecret({
          workspaceId: update.workspaceId,
          secretmanagerVaultName: vaultName,
          secretmanagerSecretName: secretName,
          secretmanagerSecretValue: idpClient?.clientSecret,
        });
      }),
    ]);
  } else if (phase === "delete-resources") {
    // Delete in reverse order of dependencies
    // Clients
    await Promise.all(
      changeSet.client.deletes.map(async (del) => {
        if (!del.vaultOnly) await client.deleteIdPClient(del.request);

        // Delete the secret manager vault and secret
        const vaultName = idpClientVaultName(
          assertDefined(del.request.namespaceName, "request missing namespaceName"),
          del.name,
        );
        try {
          await client.deleteSecretManagerVault({
            workspaceId: del.request.workspaceId,
            secretmanagerVaultName: vaultName,
          });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }),
    );
  } else {
    // Services only
    await Promise.all(changeSet.service.deletes.map((del) => client.deleteIdPService(del.request)));
  }
}

/**
 * Plan IdP-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes and metadata
 */
export async function planIdP(context: PlanContext) {
  const {
    client,
    workspaceId,
    application,
    owner,
    forRemoval,
    forceApplyAll = false,
    idpUserTriggerTargets,
    dependentApps,
    runAppIds,
  } = context;
  const idps = forRemoval ? [] : application.idpServices;
  const expectedLocalWebsites = expectedLocalStaticWebsiteNames(context);
  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    takeovers,
    resourceOwners,
  } = await planServices(
    client,
    workspaceId,
    owner,
    idps,
    idpUserTriggerTargets ?? new Set<string>(),
    expectedLocalWebsites,
    { dependentApps, runAppIds },
  );
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const clientChangeSet = await planClients(
    client,
    workspaceId,
    idps,
    deletedServices,
    forceApplyAll,
  );

  return {
    changeSet: {
      service: serviceChangeSet,
      client: clientChangeSet,
    },
    conflicts,
    unmanaged,
    takeovers,
    resourceOwners,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateIdPServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdateIdPServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteIdPServiceRequestSchema>;
};

/**
 * An IdP service whose definition is unchanged but whose dependency records are
 * not. The plan shows it as unchanged; apply still writes its labels.
 */
type UnchangedService = {
  name: string;
  metaRequest?: MetadataLabelWrite;
};

type DesiredService = {
  name: string;
  request: MessageInitShape<typeof CreateIdPServiceRequestSchema> &
    MessageInitShape<typeof UpdateIdPServiceRequestSchema>;
  /** The request with its `:url` return origins resolved as the plan resolves them. */
  comparableRequest: MessageInitShape<typeof UpdateIdPServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

const idpServiceComparison = defineRequestComparison({
  schema: UpdateIdPServiceRequestSchema,
  excluded: ["workspaceId", "namespaceName"],
  normalize: (request) => {
    if (request.lang === IdPLang.UNSPECIFIED) {
      request.lang = IdPLang.EN;
    }
    const userAuthPolicy = (request.userAuthPolicy ??= create(IdPUserAuthPolicySchema));
    // The platform stores 6 and 4096 for an omitted or zero password length.
    userAuthPolicy.passwordMinLength ||= 6;
    userAuthPolicy.passwordMaxLength ||= 4096;
    // The platform lowercases and deduplicates domains before storing them.
    userAuthPolicy.allowedEmailDomains = [
      ...new Set(userAuthPolicy.allowedEmailDomains.map((domain) => domain.toLowerCase())),
    ].toSorted();
    userAuthPolicy.allowedReturnOrigins.sort();
    request.disableGqlOperations = emptyMessageAsUnset(
      IdPDisableGqlOperationsSchema,
      request.disableGqlOperations,
    );
    request.emailConfig = emptyMessageAsUnset(IdPEmailConfigSchema, request.emailConfig);
    request.permission = emptyMessageAsUnset(ProtoIdPPermissionSchema, request.permission);
    for (const policies of actionPolicyLists(ProtoIdPPermissionSchema, request.permission)) {
      for (const policy of policies) {
        // The platform returns an empty string for an unset description.
        policy.description ||= undefined;
      }
    }
  },
});

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  owner: DeployOwner,
  idps: ReadonlyArray<IdP>,
  idpUserTriggerTargets: ReadonlySet<string>,
  expectedLocalWebsites: ReadonlySet<string>,
  records: {
    dependentApps: DependentAppsByResource | undefined;
    runAppIds: ReadonlySet<string> | undefined;
  },
) {
  const changeSet = createChangeSet<
    CreateService,
    UpdateService,
    DeleteService,
    never,
    UnchangedService
  >("IdP services");
  const ownership = createOwnershipTracker(owner);

  const existingServices = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { idpServices, nextPageToken } = await client.listIdPServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [idpServices, nextPageToken];
    },
    getName: (resource) => resource.namespace?.name,
    getTrn: (name) => resourceTrn(workspaceId, "idp", name),
  });

  const desired: DesiredService[] = [];
  for (const idp of idps) {
    const namespaceName = idp.name;
    const metaRequest = addDependencyRecords(
      await buildMetaRequest({ trn: resourceTrn(workspaceId, "idp", namespaceName), owner }),
      {
        owner,
        key: eventSourceKey.idp(namespaceName),
        dependentApps: records.dependentApps,
        runAppIds: records.runAppIds,
        pinned: idp.publishEvents !== undefined,
      },
    );
    let authorization: string | undefined;
    switch (idp.authorization) {
      case "insecure":
        authorization = "true==true";
        break;
      case "loggedIn":
        authorization = "user != null && size(user.id) > 0";
        break;
      case undefined:
        authorization = undefined;
        break;
      default:
        authorization = idp.authorization.cel;
        break;
    }

    const lang = convertLang(idp.lang);
    const userAuthPolicy = idp.userAuthPolicy;
    const publishEvents = resolvePublishEvents({
      explicit: idp.publishEvents,
      subscribed: idpUserTriggerTargets.has(namespaceName),
      conflict: publishEventsConflict.idpService(namespaceName),
    });
    const emailConfig = idp.emailConfig;
    if (!idp.permission) {
      logger.warn(`IdP service "${namespaceName}" has no permission configured.`);
    }
    const omittedPermitLocations = findOmittedPermitRules(idp.permission);
    if (omittedPermitLocations.length > 0) {
      logger.warn(
        `IdP service "${namespaceName}" has permission rule(s) ${omittedPermitLocations.join(", ")} in object form without an explicit "permit"; they default to "deny". Set permit: true (allow) or permit: false (deny) to silence this warning.`,
      );
    }
    const loggedInOnlyLocations = findLoggedInOnlyPermitRules(idp.permission);
    if (loggedInOnlyLocations.length > 0) {
      logger.warn(
        `IdP service "${namespaceName}" permits every authenticated user in permission rule(s) ${loggedInOnlyLocations.join(", ")} (their only condition is on "_loggedIn"). Any signed-in user can then run these operations against any IdP user, for example reading and changing login information (such as email addresses) or sending password reset emails to anyone. Restrict these rules to an administrator role unless every user who can sign in is trusted.`,
      );
    }
    if (hasImplicitAllEmailDomains(userAuthPolicy)) {
      logger.warn(
        `IdP service "${namespaceName}" leaves userAuthPolicy.allowedEmailDomains empty, which the platform rejects when deploy creates or updates the IdP. Set allowedEmailDomains: ["${ALL_EMAIL_DOMAINS}"] to allow every email domain, or list the domains you accept.`,
      );
    }
    const parsedPermission = parseIdPPermission(idp.permission);
    const protoPermission = parsedPermission ? protoIdPPermission(parsedPermission) : undefined;
    const allowedReturnOrigins = await resolveStaticWebsiteUrls(
      client,
      workspaceId,
      userAuthPolicy?.allowedReturnOrigins ? [...userAuthPolicy.allowedReturnOrigins] : [],
      `IdP service "${namespaceName}" allowedReturnOrigins`,
      { expectedLocalNames: expectedLocalWebsites },
    );
    const request = {
      workspaceId,
      namespaceName,
      authorization,
      lang,
      userAuthPolicy,
      publishUserEvents: publishEvents,
      disableGqlOperations: convertGqlOperationsToDisable(idp.gqlOperations),
      emailConfig,
      permission: protoPermission,
    };
    desired.push({
      name: namespaceName,
      request,
      comparableRequest: userAuthPolicy
        ? { ...request, userAuthPolicy: { ...userAuthPolicy, allowedReturnOrigins } }
        : request,
      metaRequest,
    });
  }

  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(existingServices),
    keyOf: (service) => service.name,
    ...labeledResourceChecks(ownership, "idp.service"),
    isConfigUnchanged: (service, existing) =>
      isRequestUnchanged(idpServiceComparison, service.comparableRequest, existing.resource),
    create: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    update: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    unchanged: ({ name, metaRequest }) => ({ name, metaRequest }),
    delete: (namespaceName) => ({ name: namespaceName, request: { workspaceId, namespaceName } }),
  });

  return { changeSet, ...ownership.result };
}

type CreateClient = {
  name: string;
  request: MessageInitShape<typeof CreateIdPClientRequestSchema>;
};

type UpdateClient = {
  name: string;
  workspaceId: string;
  namespaceName: string;
};

type DeleteClient = {
  name: string;
  request: MessageInitShape<typeof DeleteIdPClientRequestSchema>;
  vaultOnly?: boolean;
};

async function planClients(
  client: OperatorClient,
  workspaceId: string,
  idps: ReadonlyArray<IdP>,
  deletedServices: string[],
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateClient, UpdateClient, DeleteClient>("IdP clients");

  const fetchClients = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { clients, nextPageToken } = await client.listIdPClients({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [clients, nextPageToken];
    });
  };

  const isDeletableName = (name: string) => resourceNameSchema.safeParse(name).success;

  const namespaces = [
    ...idps.map((idp) => ({ namespaceName: idp.name, clients: idp.clients, deleted: false })),
    ...deletedServices.map((namespaceName) => ({ namespaceName, clients: [], deleted: true })),
  ];
  const existingByNamespace = await Promise.all(
    namespaces.map(({ namespaceName }) => fetchClients(namespaceName)),
  );
  for (const [i, { namespaceName, clients, deleted }] of namespaces.entries()) {
    const existingClients = assertDefined(
      existingByNamespace[i],
      "existingByNamespace missing entry for namespace index",
    );
    await diffKeyed({
      changeSet,
      desired: clients,
      existing: existingClients.map((client) => [client.name, client] as const),
      keyOf: (name) => name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: () => true,
      create: (name) => ({
        name,
        request: { workspaceId, namespaceName, client: { name } },
      }),
      update: (name) => ({ name, workspaceId, namespaceName }),
      unchanged: (name) => ({ name }),
      delete: (name) => {
        const request = { workspaceId, namespaceName, name };
        if (isDeletableName(name)) return { name, request };
        if (deleted) return { name, request, vaultOnly: true };
        logger.warn(
          `IdP client "${name}" in "${namespaceName}" will not be deleted, because the platform cannot delete a client with this name. The client and its secret vault stay in the workspace. Both are deleted when that IdP is removed.`,
        );
        return undefined;
      },
    });
  }
  return changeSet;
}

function convertLang(lang: IdPLangInput | undefined): IdPLang {
  switch (lang) {
    case "en":
      return IdPLang.EN;
    case "ja":
      return IdPLang.JA;
    default:
      return IdPLang.UNSPECIFIED;
  }
}

// Converts gqlOperations (enabled semantics, default true) to
// disableGqlOperations (disabled semantics) for the Platform API.
// Undefined fields are treated as true (enabled), matching TailorDB behavior.
function convertGqlOperationsToDisable(
  gqlOperations: IdP["gqlOperations"],
): Record<string, boolean> | undefined {
  if (!gqlOperations) {
    return undefined;
  }
  return {
    create: gqlOperations.create === false,
    update: gqlOperations.update === false,
    delete: gqlOperations.delete === false,
    read: gqlOperations.read === false,
    sendPasswordResetEmail: gqlOperations.sendPasswordResetEmail === false,
    requestMfaSettingsUrl: gqlOperations.requestMfaSettingsUrl === false,
    unenrollMfa: gqlOperations.unenrollMfa === false,
  };
}

function protoIdPPermission(
  permission: StandardIdPPermission,
): MessageInitShape<typeof ProtoIdPPermissionSchema> {
  return {
    create: permission.create.map((p) => protoIdPPolicy(p)),
    read: permission.read.map((p) => protoIdPPolicy(p)),
    update: permission.update.map((p) => protoIdPPolicy(p)),
    delete: permission.delete.map((p) => protoIdPPolicy(p)),
    sendPasswordResetEmail: permission.sendPasswordResetEmail.map((p) => protoIdPPolicy(p)),
    unenrollMfa: permission.unenrollMfa.map((p) => protoIdPPolicy(p)),
  };
}

function protoIdPPolicy(
  policy: StandardIdPActionPermission,
): MessageInitShape<typeof ProtoIdPPermissionPolicySchema> {
  let permit: IdPPermissionPermit;
  switch (policy.permit) {
    case "allow":
      permit = IdPPermissionPermit.ALLOW;
      break;
    case "deny":
      permit = IdPPermissionPermit.DENY;
      break;
    default:
      throw internalError(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoIdPCondition(cond)),
    permit,
    description: policy.description,
  };
}

function protoIdPCondition(
  condition: StandardIdPPermissionCondition,
): MessageInitShape<typeof ProtoIdPPermissionConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoIdPOperand(left);
  const r = protoIdPOperand(right);
  let op: IdPPermissionOperator;
  switch (operator) {
    case "eq":
      op = IdPPermissionOperator.EQ;
      break;
    case "ne":
      op = IdPPermissionOperator.NE;
      break;
    case "in":
      op = IdPPermissionOperator.IN;
      break;
    case "nin":
      op = IdPPermissionOperator.NIN;
      break;
    default:
      throw internalError(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoIdPOperand(
  operand: IdPPermissionOperand,
): MessageInitShape<typeof ProtoIdPPermissionOperandSchema> {
  if (typeof operand === "object" && !Array.isArray(operand)) {
    if ("user" in operand) {
      return { kind: { case: "userField", value: operand.user } };
    } else if ("idpUser" in operand) {
      return { kind: { case: "idpUserField", value: operand.idpUser } };
    } else if ("newIdpUser" in operand) {
      return { kind: { case: "newIdpUserField", value: operand.newIdpUser } };
    } else if ("oldIdpUser" in operand) {
      return { kind: { case: "oldIdpUserField", value: operand.oldIdpUser } };
    } else {
      throw internalError(`Unknown operand: ${JSON.stringify(operand)}`);
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
  };
}
