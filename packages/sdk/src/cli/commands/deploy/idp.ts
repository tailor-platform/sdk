import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateIdPClientRequestSchema,
  type CreateIdPServiceRequestSchema,
  type DeleteIdPClientRequestSchema,
  type DeleteIdPServiceRequestSchema,
  type UpdateIdPServiceRequestSchema,
} from "@tailor-platform/tailor-proto/idp_pb";
import {
  IdPLang,
  IdPPermissionOperator,
  IdPPermissionPermit,
  type IdPPermissionConditionSchema as ProtoIdPPermissionConditionSchema,
  type IdPPermissionOperandSchema as ProtoIdPPermissionOperandSchema,
  type IdPPermissionPolicySchema as ProtoIdPPermissionPolicySchema,
  type IdPPermissionSchema as ProtoIdPPermissionSchema,
  type IdPService as ProtoIdPService,
} from "@tailor-platform/tailor-proto/idp_resource_pb";
import { fetchAll, resolveStaticWebsiteUrls, type OperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { findOmittedPermitRules, parseIdPPermission } from "#/parser/service/idp/permission";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type {
  IdPPermissionOperand,
  StandardIdPActionPermission,
  StandardIdPPermission,
  StandardIdPPermissionCondition,
} from "#/parser/service/idp/types";
import type { IdP, IdPLang as IdPLangInput } from "#/types/idp.generated";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";

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
    throw new Error(
      `IdP service "${request.namespaceName ?? ""}" allowedReturnOrigins: ` +
        `${originals.length - resolved.length} of ${originals.length} entries could not be resolved. ` +
        `Check that each "<name>:url" entry refers to a deployed static website.`,
    );
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
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await resolveServiceReturnOrigins(client, create.request);
        await client.createIdPService(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await resolveServiceReturnOrigins(client, update.request);
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
        try {
          await client.getSecretManagerVault({
            workspaceId: update.workspaceId,
            secretmanagerVaultName: vaultName,
          });
          return;
        } catch (error) {
          if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
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
  } else if (phase === "delete-resources") {
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
    forRemoval,
    forceApplyAll = false,
    idpUserTriggerTargets,
  } = context;
  const idps = forRemoval ? [] : application.idpServices;
  const expectedLocalWebsites = new Set(
    application.staticWebsiteServices.map((website) => website.name),
  );
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
    idps,
    idpUserTriggerTargets ?? new Set<string>(),
    expectedLocalWebsites,
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

type ComparableIdPService = {
  authorization: string | undefined;
  lang: IdPLang;
  userAuthPolicy: Record<string, unknown> | undefined;
  publishUserEvents: boolean;
  disableGqlOperations: Record<string, boolean> | undefined;
  emailConfig: Record<string, string> | undefined;
  permission: MessageInitShape<typeof ProtoIdPPermissionSchema> | undefined;
};

function normalizeComparableUserAuthPolicy(
  policy: ProtoIdPService["userAuthPolicy"] | IdP["userAuthPolicy"] | undefined,
): Record<string, unknown> | undefined {
  return {
    useNonEmailIdentifier: policy?.useNonEmailIdentifier ?? false,
    allowSelfPasswordReset: policy?.allowSelfPasswordReset ?? false,
    passwordRequireUppercase: policy?.passwordRequireUppercase ?? false,
    passwordRequireLowercase: policy?.passwordRequireLowercase ?? false,
    passwordRequireNonAlphanumeric: policy?.passwordRequireNonAlphanumeric ?? false,
    passwordRequireNumeric: policy?.passwordRequireNumeric ?? false,
    passwordMinLength: policy?.passwordMinLength ?? 0,
    passwordMaxLength: policy?.passwordMaxLength ?? 0,
    allowedEmailDomains: (policy?.allowedEmailDomains ?? []).toSorted(),
    allowGoogleOauth: policy?.allowGoogleOauth ?? false,
    disablePasswordAuth: policy?.disablePasswordAuth ?? false,
    allowMicrosoftOauth: policy?.allowMicrosoftOauth ?? false,
    enableMfa: policy?.enableMfa ?? false,
    requireMfa: policy?.requireMfa ?? false,
    allowedReturnOrigins: (policy?.allowedReturnOrigins ?? []).toSorted(),
    mfaIssuer: policy?.mfaIssuer ?? "",
  };
}

function normalizeComparableDisableGqlOperations(
  value: ProtoIdPService["disableGqlOperations"] | Record<string, boolean> | undefined,
): Record<string, boolean> | undefined {
  return {
    create: value?.create ?? false,
    update: value?.update ?? false,
    delete: value?.delete ?? false,
    read: value?.read ?? false,
    sendPasswordResetEmail: value?.sendPasswordResetEmail ?? false,
    requestMfaSettingsUrl: value?.requestMfaSettingsUrl ?? false,
    unenrollMfa: value?.unenrollMfa ?? false,
  };
}

function normalizeComparableEmailConfig(
  value: ProtoIdPService["emailConfig"] | Record<string, string> | undefined,
): Record<string, string> | undefined {
  return {
    fromName: value?.fromName ?? "",
    passwordResetSubject: value?.passwordResetSubject ?? "",
  };
}

function normalizeComparableIdPService(
  input: Pick<
    ComparableIdPService,
    | "authorization"
    | "lang"
    | "userAuthPolicy"
    | "publishUserEvents"
    | "disableGqlOperations"
    | "emailConfig"
    | "permission"
  >,
): ComparableIdPService {
  return {
    authorization: input.authorization || undefined,
    lang: input.lang === IdPLang.UNSPECIFIED ? IdPLang.EN : input.lang,
    userAuthPolicy: input.userAuthPolicy,
    publishUserEvents: input.publishUserEvents,
    disableGqlOperations: input.disableGqlOperations,
    emailConfig: input.emailConfig,
    permission: input.permission,
  };
}

function normalizeComparablePermission(
  permission: ProtoIdPService["permission"],
): MessageInitShape<typeof ProtoIdPPermissionSchema> | undefined {
  if (!permission) {
    return undefined;
  }
  if (
    permission.create.length === 0 &&
    permission.read.length === 0 &&
    permission.update.length === 0 &&
    permission.delete.length === 0 &&
    permission.sendPasswordResetEmail.length === 0 &&
    permission.unenrollMfa.length === 0
  ) {
    return undefined;
  }
  const normalizePolicy = (policy: (typeof permission.create)[number]) => ({
    conditions: policy.conditions.map((c) => ({
      left: c.left ? { kind: c.left.kind } : undefined,
      operator: c.operator,
      right: c.right ? { kind: c.right.kind } : undefined,
    })),
    permit: policy.permit,
    // Platform returns an empty string for an unset description; treat it the same as omitted.
    description: policy.description || undefined,
  });
  return {
    create: permission.create.map(normalizePolicy),
    read: permission.read.map(normalizePolicy),
    update: permission.update.map(normalizePolicy),
    delete: permission.delete.map(normalizePolicy),
    sendPasswordResetEmail: permission.sendPasswordResetEmail.map(normalizePolicy),
    unenrollMfa: permission.unenrollMfa.map(normalizePolicy),
  };
}

function areIdPServicesEqual(existing: ProtoIdPService, desired: ComparableIdPService): boolean {
  return areNormalizedEqual(
    normalizeComparableIdPService({
      authorization: existing.authorization,
      lang: existing.lang,
      userAuthPolicy: normalizeComparableUserAuthPolicy(existing.userAuthPolicy),
      publishUserEvents: existing.publishUserEvents,
      disableGqlOperations: normalizeComparableDisableGqlOperations(existing.disableGqlOperations),
      emailConfig: normalizeComparableEmailConfig(existing.emailConfig),
      permission: normalizeComparablePermission(existing.permission),
    }),
    desired,
  );
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  idps: ReadonlyArray<IdP>,
  idpUserTriggerTargets: ReadonlySet<string>,
  expectedLocalWebsites: ReadonlySet<string>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>("IdP services");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

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

  for (const idp of idps) {
    const namespaceName = idp.name;
    const existing = existingServices[namespaceName];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "idp", namespaceName),
      appName,
      appId,
    });
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
    const isIdpUserTriggerTarget = idpUserTriggerTargets.has(namespaceName);
    if (isIdpUserTriggerTarget && idp.publishUserEvents === false) {
      throw new Error(
        `IdP service "${namespaceName}" has "publishUserEvents: false", but executors with idpUser triggers subscribe to it. ` +
          `Either remove "publishUserEvents: false" or remove the matching executor triggers.`,
      );
    }
    const publishUserEvents = idp.publishUserEvents ?? isIdpUserTriggerTarget;
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
    const parsedPermission = parseIdPPermission(idp.permission);
    const protoPermission = parsedPermission ? protoIdPPermission(parsedPermission) : undefined;
    const resolvedReturnOrigins = await resolveStaticWebsiteUrls(
      client,
      workspaceId,
      userAuthPolicy?.allowedReturnOrigins ? [...userAuthPolicy.allowedReturnOrigins] : [],
      `IdP service "${namespaceName}" allowedReturnOrigins`,
      { expectedLocalNames: expectedLocalWebsites },
    );
    const userAuthPolicyForCompare = userAuthPolicy
      ? { ...userAuthPolicy, allowedReturnOrigins: resolvedReturnOrigins }
      : userAuthPolicy;
    const desired = normalizeComparableIdPService({
      authorization,
      lang,
      userAuthPolicy: normalizeComparableUserAuthPolicy(userAuthPolicyForCompare),
      publishUserEvents,
      disableGqlOperations: normalizeComparableDisableGqlOperations(
        convertGqlOperationsToDisable(idp.gqlOperations),
      ),
      emailConfig: normalizeComparableEmailConfig(emailConfig),
      permission: protoPermission,
    });
    const request = {
      workspaceId,
      namespaceName,
      authorization,
      lang,
      userAuthPolicy,
      publishUserEvents,
      disableGqlOperations: convertGqlOperationsToDisable(idp.gqlOperations),
      emailConfig,
      permission: protoPermission,
    };

    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "IdP service",
        resourceName: idp.name,
        conflicts,
        unmanaged,
      });
      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areIdPServicesEqual(existing.resource, desired)
      ) {
        changeSet.unchanged.push({ name: namespaceName });
      } else {
        changeSet.updates.push({
          name: namespaceName,
          request,
          metaRequest,
        });
      }
      delete existingServices[namespaceName];
    } else {
      changeSet.creates.push({
        name: namespaceName,
        request,
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const owned = trackRemainingResourceOwner({
      labels: entry?.allLabels,
      ownerLabel: entry?.label,
      appName,
      appId,
      resourceOwners,
    });
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
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateClient, UpdateClient, DeleteClient>("IdP clients");

  const fetchClients = (namespaceName: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { clients, nextPageToken } = await client.listIdPClients({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
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

  const clientsByIdp = await Promise.all(idps.map((idp) => fetchClients(idp.name)));
  for (const [i, idp] of idps.entries()) {
    const namespaceName = idp.name;
    const existingClients = assertDefined(
      clientsByIdp[i],
      "clientsByIdp missing entry for idp index",
    );
    const existingNameMap = new Map<string, string>();
    existingClients.forEach((client) => {
      existingNameMap.set(client.name, client.clientSecret);
    });
    for (const name of idp.clients) {
      if (existingNameMap.has(name)) {
        if (forceApplyAll) {
          changeSet.updates.push({
            name,
            workspaceId,
            namespaceName,
            clientSecret: existingNameMap.get(name) ?? "",
          });
        } else {
          changeSet.unchanged.push({
            name,
          });
        }
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
    existingNameMap.forEach((_clientSecret, name) => {
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

  const deletedClientsByService = await Promise.all(
    deletedServices.map((namespaceName) => fetchClients(namespaceName)),
  );
  for (const [i, namespaceName] of deletedServices.entries()) {
    assertDefined(
      deletedClientsByService[i],
      "deletedClientsByService missing entry for service index",
    ).forEach((client) => {
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
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
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
      throw new Error(`Unknown operator: ${operator satisfies never}`);
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
      throw new Error(`Unknown operand: ${JSON.stringify(operand)}`);
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
  };
}
