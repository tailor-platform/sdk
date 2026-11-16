import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import {
  fetchAll,
  fetchAllTolerant,
  getAuthSCIMConfigOrNull,
  getAuthSCIMResourcesOrEmpty,
  getTenantConfigOrNull,
  getUserProfileConfigOrNull,
  listAuthIDPConfigsTolerant,
  type OperatorClient,
} from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { protoSubgraph } from "./application";
import {
  authSCIMConfigName,
  authTenantConfigName,
  authUserProfileConfigName,
  builtinIdPClientSecret,
} from "./auth";
import { idpClientVaultName } from "./idp";
import { sdkNameLabelKey } from "./label";
import type { PlannedDeployment } from "./apply-phases";
import type { ManagedResourceType } from "./managed-resource-type";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  AuthIDPConfigSchema,
  AuthInvokerSchema,
  AuthSCIMConfigSchema,
  AuthSCIMResourceSchema,
  TenantProviderConfigSchema,
  UserProfileProviderConfigSchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { ExecutorExecutorSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";
import type { PipelineResolverSchema } from "@tailor-platform/tailor-proto/pipeline_resource_pb";
import type { SecretValueSchema } from "@tailor-platform/tailor-proto/secret_manager_resource_pb";

type ResourceDeletePlan = Pick<
  PlannedDeployment,
  | "application"
  | "app"
  | "auth"
  | "tailorDB"
  | "pipeline"
  | "idp"
  | "executor"
  | "aiGateway"
  | "workflow"
  | "secretManager"
>;

type CheckedResourceType = Extract<
  ManagedResourceType,
  | "auth.service"
  | "tailordb.service"
  | "pipeline.service"
  | "idp.service"
  | "idp.client"
  | "auth.idp_config"
  | "auth.machine_user"
  | "tailordb.type"
  | "pipeline.resolver"
  | "workflow"
  | "application"
  | "secret.secret"
>;

type ResourceKey<T extends string> = {
  resourceType: T;
  namespace?: string;
  name: string;
};

type ResourceRef = ResourceKey<CheckedResourceType>;

type CheckedResource = {
  label: (ref: ResourceRef) => string;
  deletesOf: (plan: ResourceDeletePlan) => ReadonlyArray<Omit<ResourceRef, "resourceType">>;
};

function idpConfigLabel(ref: ResourceKey<ManagedResourceType>): string {
  return `IdP config "${ref.name}" of Auth service "${ref.namespace}"`;
}

const CHECKED_RESOURCES: Record<CheckedResourceType, CheckedResource> = {
  "auth.service": {
    label: ({ name }) => `Auth service "${name}"`,
    deletesOf: (plan) => plan.auth.changeSet.service.deletes,
  },
  "tailordb.service": {
    label: ({ name }) => `TailorDB namespace "${name}"`,
    deletesOf: (plan) => plan.tailorDB.changeSet.service.deletes,
  },
  "pipeline.service": {
    label: ({ name }) => `Resolver namespace "${name}"`,
    deletesOf: (plan) => plan.pipeline.changeSet.service.deletes,
  },
  "idp.service": {
    label: ({ name }) => `IdP service "${name}"`,
    deletesOf: (plan) => plan.idp.changeSet.service.deletes,
  },
  "idp.client": {
    label: ({ namespace, name }) => `IdP client "${name}" of IdP service "${namespace}"`,
    deletesOf: (plan) => plan.idp.changeSet.client.deletes.map(namespacedName),
  },
  "auth.idp_config": {
    label: idpConfigLabel,
    deletesOf: (plan) => plan.auth.changeSet.idpConfig.deletes.map(namespacedName),
  },
  "auth.machine_user": {
    label: ({ namespace, name }) => `Machine user "${name}" of Auth service "${namespace}"`,
    deletesOf: (plan) =>
      plan.auth.changeSet.machineUser.deletes.map(({ name, request }) => ({
        namespace: request.authNamespace,
        name,
      })),
  },
  "tailordb.type": {
    label: ({ namespace, name }) => `TailorDB table "${name}" in namespace "${namespace}"`,
    deletesOf: (plan) =>
      plan.tailorDB.changeSet.type.deletes.map(({ name, request }) => ({
        namespace: request.namespaceName,
        name,
      })),
  },
  "pipeline.resolver": {
    label: ({ namespace, name }) => `Resolver "${name}" in namespace "${namespace}"`,
    deletesOf: (plan) =>
      plan.pipeline.changeSet.resolver.deletes.map(({ name, request }) => ({
        namespace: request.namespaceName,
        name,
      })),
  },
  workflow: {
    label: ({ name }) => `Workflow "${name}"`,
    deletesOf: (plan) => plan.workflow.changeSet.deletes,
  },
  application: {
    label: ({ name }) => `Application "${name}"`,
    deletesOf: (plan) => plan.app.deletes,
  },
  "secret.secret": {
    label: ({ namespace, name }) => `Secret "${name}" in vault "${namespace}"`,
    deletesOf: (plan) =>
      plan.secretManager.secretChangeSet.deletes.map(({ vaultName, secretName }) => ({
        namespace: vaultName,
        name: secretName,
      })),
  },
};

type UserResourceType =
  | Extract<
      ManagedResourceType,
      | "executor"
      | "pipeline.resolver"
      | "aigateway"
      | "auth.idp_config"
      | "auth.scim"
      | "auth.user_profile_config"
      | "auth.tenant_config"
      | "auth.scim_resource"
    >
  | "telemetryrouter.otlp_exporter";

type ResourceUser = ResourceKey<UserResourceType>;

const USER_LABELS: Record<UserResourceType, (user: ResourceUser) => string> = {
  executor: ({ name }) => `executor "${name}"`,
  "pipeline.resolver": ({ namespace, name }) => `resolver "${name}" in namespace "${namespace}"`,
  aigateway: ({ name }) => `AI gateway "${name}"`,
  "auth.idp_config": idpConfigLabel,
  "auth.scim": ({ namespace }) => `SCIM config of Auth service "${namespace}"`,
  "auth.user_profile_config": ({ namespace }) =>
    `user profile config of Auth service "${namespace}"`,
  "auth.tenant_config": ({ namespace }) => `tenant config of Auth service "${namespace}"`,
  "auth.scim_resource": ({ namespace, name }) =>
    `SCIM resource "${name}" of Auth service "${namespace}"`,
  "telemetryrouter.otlp_exporter": ({ name }) => `OTLP exporter "${name}"`,
};

type ResourceUse = ResourceRef & {
  /** Application that uses the resource, absent for a user no application manages. */
  application?: string;
  /** Resource that uses it, absent when the application itself references it. */
  usedBy?: ResourceUser;
};

type ResourceDeletingCommand = "deploy" | "remove";

const IN_USE_SUGGESTIONS: Record<ResourceDeletingCommand, string> = {
  deploy:
    "Keep each listed resource in the config that defines it, or deploy the applications that use it so that they stop using it, first or in the same run.",
  remove:
    "Remove the applications that use each listed resource, or deploy them so that they stop using it, then run remove again.",
};

const OWN_APPLICATION_SUGGESTION =
  "An application that an executor in its own config still targets is deleted because that config no longer defines or references a TailorDB namespace, resolver namespace, IdP, or Auth service, so add one of them back to that config or remove that executor from it.";

const APPLICATION_IDP_CONFIG_SUGGESTION =
  "An application that references an Auth service as external authenticates with the IdP config that the Auth service's idProvider names, and switches to a renamed one only in a deploy that also includes the config defining that Auth service, so deploy them together or keep the idProvider name.";

const UNMANAGED_USER_SUGGESTION =
  "An OTLP exporter, or an executor, resolver, AI gateway, or Auth service listed without an application, is not deployed by the SDK, so change or delete it outside the SDK.";

function inUseSuggestion(
  uses: ReadonlyArray<ResourceUse>,
  command: ResourceDeletingCommand,
): string {
  const usesOwnApplication = (use: ResourceUse) =>
    command === "deploy" && use.resourceType === "application" && use.application === use.name;
  const namesNoApplication = command === "remove" && uses.every((use) => !use.application);
  const deletedAuthServices = new Set(
    uses.filter((use) => use.resourceType === "auth.service").map((use) => use.name),
  );
  const authenticatesWithIdPConfig = (use: ResourceUse) =>
    command === "deploy" &&
    use.resourceType === "auth.idp_config" &&
    !use.usedBy &&
    !deletedAuthServices.has(use.namespace ?? "");
  return [
    ...(namesNoApplication ||
    uses.every((use) => usesOwnApplication(use) || authenticatesWithIdPConfig(use))
      ? []
      : [IN_USE_SUGGESTIONS[command]]),
    ...(uses.some(usesOwnApplication) ? [OWN_APPLICATION_SUGGESTION] : []),
    ...(uses.some(authenticatesWithIdPConfig) ? [APPLICATION_IDP_CONFIG_SUGGESTION] : []),
    ...(uses.every((use) => use.application) ? [] : [UNMANAGED_USER_SUGGESTION]),
  ].join(" ");
}

const SUBGRAPH_RESOURCE_TYPES = new Map<Subgraph_ServiceType, CheckedResourceType>([
  [Subgraph_ServiceType.TAILORDB, "tailordb.service"],
  [Subgraph_ServiceType.PIPELINE, "pipeline.service"],
  [Subgraph_ServiceType.IDP, "idp.service"],
]);

function refKey(ref: ResourceKey<ManagedResourceType>): string {
  return JSON.stringify([ref.resourceType, ref.namespace ?? "", ref.name]);
}

function servicesOf(
  authNamespace: string | undefined,
  subgraphs: ReadonlyArray<ReturnType<typeof protoSubgraph>>,
): ResourceRef[] {
  const auth: ResourceRef[] = authNamespace
    ? [{ resourceType: "auth.service", name: authNamespace }]
    : [];
  const subgraphServices = subgraphs.flatMap(({ serviceType, serviceNamespace }) => {
    const resourceType = SUBGRAPH_RESOURCE_TYPES.get(serviceType);
    return resourceType ? [{ resourceType, name: serviceNamespace }] : [];
  });
  return [...auth, ...subgraphServices];
}

type ApplicationAuth = { authNamespace?: string; authIdpConfigName?: string };

function idpConfigRefs(auth: ApplicationAuth): ResourceRef[] {
  return auth.authNamespace && auth.authIdpConfigName
    ? [
        {
          resourceType: "auth.idp_config",
          namespace: auth.authNamespace,
          name: auth.authIdpConfigName,
        },
      ]
    : [];
}

function applicationUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const writtenRequests = new Map(
    deployments.flatMap(({ app }) =>
      [...app.creates, ...app.updates, ...app.unchanged].map(
        (entry) => [entry.name, entry.request] as const,
      ),
    ),
  );
  const deletedNames = new Set(
    deployments.flatMap(({ app }) => app.deletes.map((entry) => entry.name)),
  );
  const writtenUses = deployments.flatMap(({ application }) => {
    const request = writtenRequests.get(application.name);
    if (!request) return [];
    return [
      ...servicesOf(
        getApplicationAuthNamespace(application),
        application.subgraphs.map(protoSubgraph),
      ),
      ...idpConfigRefs(request),
    ].map((ref) => ({ ...ref, application: application.name }));
  });
  const recorded = new Map(
    deployments
      .flatMap(({ app }) => app.existingApplications)
      .map((existing) => [existing.name, existing]),
  );
  const recordedUses = [...recorded.values()]
    .filter((existing) => !writtenRequests.has(existing.name) && !deletedNames.has(existing.name))
    .flatMap((existing) =>
      [...servicesOf(existing.authNamespace, existing.subgraphs), ...idpConfigRefs(existing)].map(
        (ref) => ({ ...ref, application: existing.name }),
      ),
    );
  return [...writtenUses, ...recordedUses];
}

/** A resource that uses others, in the version the workspace has after the run. */
type FinalUser<T> = {
  resource: T;
  name: string;
  namespace?: string;
  application: string | undefined;
};

type UserName = Pick<FinalUser<unknown>, "namespace" | "name">;

function userKey(user: UserName): string {
  return JSON.stringify([user.namespace ?? "", user.name]);
}

function finalUsers<T>(
  planned: ReadonlyArray<FinalUser<T>>,
  deleted: ReadonlyArray<UserName>,
  recorded: ReadonlyArray<FinalUser<T>>,
): FinalUser<T>[] {
  const rewritten = new Set([...planned, ...deleted].map(userKey));
  const kept = new Map(
    recorded.filter((user) => !rewritten.has(userKey(user))).map((user) => [userKey(user), user]),
  );
  return [...planned, ...kept.values()];
}

function labelledUsers<T>(
  records: ReadonlyArray<[string, { resource: T; allLabels?: Record<string, string> } | undefined]>,
): FinalUser<T>[] {
  return records.flatMap(([name, entry]) =>
    entry
      ? [{ resource: entry.resource, name, application: entry.allLabels?.[sdkNameLabelKey] }]
      : [],
  );
}

type NamespacedEntry = { name: string; request: { namespaceName?: string } };

function namespacedName(entry: NamespacedEntry): UserName {
  return { namespace: entry.request.namespaceName, name: entry.name };
}

function plannedUsers<E extends NamespacedEntry, T>(
  application: string,
  entries: ReadonlyArray<E>,
  resourceOf: (entry: E) => T,
): FinalUser<T>[] {
  return entries.map((entry) => ({
    ...namespacedName(entry),
    resource: resourceOf(entry),
    application,
  }));
}

type NamedResource<T> = Pick<FinalUser<T>, "resource" | "name">;

type NamespaceServices = ReadonlyMap<string, { allLabels?: Record<string, string> } | undefined>;

async function recordedUsers<T>(
  services: NamespaceServices,
  fetchResources: (namespace: string) => Promise<NamedResource<T>[]>,
): Promise<FinalUser<T>[]> {
  const users = await Promise.all(
    [...services].map(async ([namespace, service]) =>
      (await fetchResources(namespace)).map((user) => ({
        ...user,
        namespace,
        application: service?.allLabels?.[sdkNameLabelKey],
      })),
    ),
  );
  return users.flat();
}

function usesOf<T>(
  users: ReadonlyArray<FinalUser<T>>,
  resourceType: UserResourceType,
  refsOf: (resource: T) => ResourceRef[],
): ResourceUse[] {
  return users.flatMap((user) =>
    refsOf(user.resource).map((ref) => ({
      ...ref,
      ...(user.application ? { application: user.application } : {}),
      usedBy: {
        resourceType,
        ...(user.namespace === undefined ? {} : { namespace: user.namespace }),
        name: user.name,
      },
    })),
  );
}

function invokerRefs(
  invoker: MessageInitShape<typeof AuthInvokerSchema> | undefined,
): ResourceRef[] {
  return invoker?.namespace && invoker.machineUserName
    ? [
        {
          resourceType: "auth.machine_user",
          namespace: invoker.namespace,
          name: invoker.machineUserName,
        },
      ]
    : [];
}

function secretRefs(secret: MessageInitShape<typeof SecretValueSchema> | undefined): ResourceRef[] {
  return secret
    ? [{ resourceType: "secret.secret", namespace: secret.vaultName, name: secret.secretKey ?? "" }]
    : [];
}

function tableRef(namespace: string | undefined, name: string | undefined): ResourceRef {
  return { resourceType: "tailordb.type", namespace, name: name ?? "" };
}

function executorRefs(executor: MessageInitShape<typeof ExecutorExecutorSchema>): ResourceRef[] {
  const refs: ResourceRef[] = [];
  const trigger = executor.triggerConfig?.config;
  const typed = trigger?.case === "event" ? trigger.value.typedConfig : undefined;
  switch (typed?.case) {
    case "tailordb":
      refs.push(tableRef(typed.value.namespaceName, typed.value.typeName));
      break;
    case "pipeline":
      refs.push({
        resourceType: "pipeline.resolver",
        namespace: typed.value.namespaceName,
        name: typed.value.resolverName ?? "",
      });
      break;
    case "idp":
      refs.push({ resourceType: "idp.service", name: typed.value.namespaceName ?? "" });
      break;
    case "workflow":
      refs.push({ resourceType: "workflow", name: typed.value.workflowName ?? "" });
      break;
    case "auth":
      refs.push({ resourceType: "auth.service", name: typed.value.namespaceName ?? "" });
      break;
    case undefined:
      break;
  }
  const target = executor.targetConfig?.config;
  switch (target?.case) {
    case "function":
      refs.push(...invokerRefs(target.value.invoker));
      break;
    case "tailorGraphql":
      refs.push({ resourceType: "application", name: target.value.appName ?? "" });
      refs.push(...invokerRefs(target.value.invoker));
      break;
    case "workflow":
      refs.push({ resourceType: "workflow", name: target.value.workflowName ?? "" });
      refs.push(...invokerRefs(target.value.invoker));
      break;
    case "webhook":
      refs.push(...secretRefs(target.value.secret));
      for (const header of target.value.headers ?? []) {
        if (header.value?.case === "secretValue") refs.push(...secretRefs(header.value.value));
      }
      break;
    case undefined:
      break;
  }
  return refs;
}

function executorUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const planned = deployments.flatMap(({ application, executor }) =>
    [...executor.changeSet.creates, ...executor.changeSet.updates].map((entry) => ({
      resource: entry.request.executor ?? {},
      name: entry.name,
      application: application.name,
    })),
  );
  const executors = finalUsers<MessageInitShape<typeof ExecutorExecutorSchema>>(
    planned,
    deployments.flatMap(({ executor }) => executor.changeSet.deletes),
    labelledUsers(
      deployments.flatMap(({ executor }) => Object.entries(executor.existingExecutors)),
    ),
  );
  return usesOf(executors, "executor", executorRefs);
}

function aiGatewayUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const planned = deployments.flatMap(({ application, aiGateway }) =>
    [...aiGateway.changeSet.creates, ...aiGateway.changeSet.updates].map((entry) => ({
      resource: { authNamespace: entry.request.authNamespace },
      name: entry.name,
      application: application.name,
    })),
  );
  const gateways = finalUsers<{ authNamespace?: string }>(
    planned,
    deployments.flatMap(({ aiGateway }) => aiGateway.changeSet.deletes),
    labelledUsers(
      deployments.flatMap(({ aiGateway }) => Object.entries(aiGateway.existingGateways)),
    ),
  );
  return usesOf(gateways, "aigateway", (gateway) =>
    gateway.authNamespace ? [{ resourceType: "auth.service", name: gateway.authNamespace }] : [],
  );
}

type WorkspaceUsesParams = {
  deployments: ReadonlyArray<ResourceDeletePlan>;
  client: OperatorClient;
  workspaceId: string;
};

async function resolverUses(params: WorkspaceUsesParams): Promise<ResourceUse[]> {
  const { deployments, client, workspaceId } = params;
  const planned = deployments.flatMap(({ application, pipeline }) =>
    plannedUsers(
      application.name,
      [...pipeline.changeSet.resolver.creates, ...pipeline.changeSet.resolver.updates],
      (entry) => entry.request.pipelineResolver ?? {},
    ),
  );
  const deletedNamespaces = new Set(
    deployments.flatMap(({ pipeline }) =>
      pipeline.changeSet.service.deletes.map(({ name }) => name),
    ),
  );
  const runResolvers = deployments.flatMap(({ application, pipeline }) =>
    [...pipeline.existingResolvers].flatMap(([namespace, { existingResolverDetails }]) =>
      deletedNamespaces.has(namespace)
        ? []
        : [...existingResolverDetails].flatMap(([name, resource]) =>
            resource ? [{ resource, name, namespace, application: application.name }] : [],
          ),
    ),
  );
  const runNamespaces = new Set(
    deployments.flatMap(({ pipeline }) => [...pipeline.existingResolvers.keys()]),
  );
  const otherServices = new Map(
    deployments
      .flatMap(({ pipeline }) => Object.entries(pipeline.existingServices))
      .filter(([namespace]) => !runNamespaces.has(namespace)),
  );
  const others = await recordedUsers(otherServices, async (namespace) => {
    const resolvers = await fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
        workspaceId,
        namespaceName: namespace,
        pipelineResolverView: PipelineResolverView.FULL,
        pageToken,
        pageSize: maxPageSize,
      });
      return [pipelineResolvers, nextPageToken];
    });
    return resolvers.map((resource) => ({ resource, name: resource.name }));
  });
  const resolvers = finalUsers<MessageInitShape<typeof PipelineResolverSchema>>(
    planned,
    deployments.flatMap(({ pipeline }) => pipeline.changeSet.resolver.deletes.map(namespacedName)),
    [...runResolvers, ...others],
  );
  return usesOf(resolvers, "pipeline.resolver", (resolver) =>
    (resolver.pipelines ?? []).flatMap((step) => invokerRefs(step.invoker)),
  );
}

function remainingAuthServices(deployments: ReadonlyArray<ResourceDeletePlan>): NamespaceServices {
  const deletedServices = new Set(
    deployments.flatMap(({ auth }) => auth.changeSet.service.deletes.map(({ name }) => name)),
  );
  return new Map(
    deployments
      .flatMap(({ auth }) => Object.entries(auth.existingServices))
      .filter(([namespace]) => !deletedServices.has(namespace)),
  );
}

type AuthChangeSet = ResourceDeletePlan["auth"]["changeSet"];

type WriteChangeSet<C, U> = {
  creates: ReadonlyArray<C>;
  updates: ReadonlyArray<U>;
  deletes: ReadonlyArray<NamespacedEntry>;
};

function finalAuthUsers<C extends NamespacedEntry, U extends NamespacedEntry, T>(
  deployments: ReadonlyArray<ResourceDeletePlan>,
  changeSetOf: (changeSet: AuthChangeSet) => WriteChangeSet<C, U>,
  resourceOf: (entry: C | U) => T,
  recorded: ReadonlyArray<FinalUser<T>>,
): FinalUser<T>[] {
  return finalUsers(
    deployments.flatMap(({ application, auth }) => {
      const { creates, updates } = changeSetOf(auth.changeSet);
      return plannedUsers(application.name, [...creates, ...updates], resourceOf);
    }),
    deployments.flatMap(({ auth }) => changeSetOf(auth.changeSet).deletes.map(namespacedName)),
    recorded,
  );
}

type IdPConfigWrite =
  | AuthChangeSet["idpConfig"]["creates"][number]
  | AuthChangeSet["idpConfig"]["updates"][number];

function plannedIdPConfig(entry: IdPConfigWrite): MessageInitShape<typeof AuthIDPConfigSchema> {
  const { idpConfig } = entry;
  if (idpConfig.kind !== "BuiltInIdP") return entry.request.idpConfig ?? {};
  // A built-in IdP's request gets its config only at apply time.
  return {
    config: {
      config: { case: "oidc", value: { clientSecretKey: builtinIdPClientSecret(idpConfig) } },
    },
  };
}

type DeletedIdPClient = ResourceKey<"idp.client">;

type IdPConfigUsesParams = WorkspaceUsesParams & {
  /** IdP clients the run deletes; deleting one also deletes the vault that holds its secret. */
  deletedClients: ReadonlyArray<DeletedIdPClient>;
};

async function idpConfigUses(params: IdPConfigUsesParams): Promise<ResourceUse[]> {
  const { deployments, client, workspaceId, deletedClients } = params;
  const recorded = await recordedUsers(remainingAuthServices(deployments), async (namespace) => {
    const idpConfigs = await listAuthIDPConfigsTolerant(client, workspaceId, namespace);
    return idpConfigs.map((resource) => ({ resource, name: resource.name }));
  });
  const idpConfigs = finalAuthUsers(
    deployments,
    (changeSet) => changeSet.idpConfig,
    plannedIdPConfig,
    recorded,
  );
  return usesOf(idpConfigs, "auth.idp_config", (idpConfig) => {
    const config = idpConfig.config?.config;
    const clientSecret = config?.case === "oidc" ? config.value.clientSecretKey : undefined;
    return [
      ...secretRefs(clientSecret),
      ...deletedClients.filter(
        (deleted) =>
          clientSecret?.vaultName === idpClientVaultName(deleted.namespace ?? "", deleted.name),
      ),
    ];
  });
}

async function scimConfigUses(params: WorkspaceUsesParams): Promise<ResourceUse[]> {
  const { deployments, client, workspaceId } = params;
  const recorded = await recordedUsers(remainingAuthServices(deployments), async (namespace) => {
    const scimConfig = await getAuthSCIMConfigOrNull(client, workspaceId, namespace);
    return scimConfig ? [{ resource: scimConfig, name: authSCIMConfigName(namespace) }] : [];
  });
  const scimConfigs = finalAuthUsers(
    deployments,
    (changeSet) => changeSet.scim,
    (entry): MessageInitShape<typeof AuthSCIMConfigSchema> => entry.request.scimConfig ?? {},
    recorded,
  );
  return usesOf(scimConfigs, "auth.scim", (scimConfig) => {
    const authorization = scimConfig.authorizationConfig;
    return secretRefs(authorization?.case === "bearerSecret" ? authorization.value : undefined);
  });
}

type TailorDBProvider =
  | { case: "tailordb"; value: { namespace?: string; type?: string } }
  | { case: undefined; value?: undefined };

function providerTableRefs(provider: TailorDBProvider | undefined): ResourceRef[] {
  return provider?.case === "tailordb"
    ? [tableRef(provider.value.namespace, provider.value.type)]
    : [];
}

async function authTableUses(params: WorkspaceUsesParams): Promise<ResourceUse[]> {
  const { deployments, client, workspaceId } = params;
  const services = remainingAuthServices(deployments);
  const [recordedUserProfiles, recordedTenants, recordedSCIMResources] = await Promise.all([
    recordedUsers(services, async (namespace) => {
      const resource = await getUserProfileConfigOrNull(client, workspaceId, namespace);
      return resource ? [{ resource, name: authUserProfileConfigName(namespace) }] : [];
    }),
    recordedUsers(services, async (namespace) => {
      const resource = await getTenantConfigOrNull(client, workspaceId, namespace);
      return resource ? [{ resource, name: authTenantConfigName(namespace) }] : [];
    }),
    recordedUsers(services, async (namespace) => {
      const resources = await getAuthSCIMResourcesOrEmpty(client, workspaceId, namespace);
      return resources.map((resource) => ({ resource, name: resource.name }));
    }),
  ]);
  const userProfiles = finalAuthUsers(
    deployments,
    (changeSet) => changeSet.userProfileConfig,
    (entry): MessageInitShape<typeof UserProfileProviderConfigSchema> =>
      entry.request.userProfileProviderConfig ?? {},
    recordedUserProfiles,
  );
  const tenants = finalAuthUsers(
    deployments,
    (changeSet) => changeSet.tenantConfig,
    (entry): MessageInitShape<typeof TenantProviderConfigSchema> =>
      entry.request.tenantProviderConfig ?? {},
    recordedTenants,
  );
  const scimResources = finalAuthUsers(
    deployments,
    (changeSet) => changeSet.scimResource,
    (entry): MessageInitShape<typeof AuthSCIMResourceSchema> => entry.request.scimResource ?? {},
    recordedSCIMResources,
  );
  return [
    ...usesOf(userProfiles, "auth.user_profile_config", (userProfile) =>
      providerTableRefs(userProfile.config?.config),
    ),
    ...usesOf(tenants, "auth.tenant_config", (tenant) => providerTableRefs(tenant.config?.config)),
    ...usesOf(scimResources, "auth.scim_resource", (resource) => [
      tableRef(resource.tailorDbNamespace, resource.tailorDbType),
    ]),
  ];
}

async function otlpExporterUses(params: WorkspaceUsesParams): Promise<ResourceUse[]> {
  const { client, workspaceId } = params;
  const exporters = await fetchAll(async (pageToken, maxPageSize) => {
    const { otlpExporters, nextPageToken } = await client.listOTLPExporters({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [otlpExporters, nextPageToken];
  });
  return usesOf(
    exporters.map((resource) => ({ resource, name: resource.name, application: undefined })),
    "telemetryrouter.otlp_exporter",
    (exporter) => secretRefs(exporter.auth?.method.value?.secretValue),
  );
}

function describeUse(use: ResourceUse): string {
  const user = use.usedBy
    ? `${USER_LABELS[use.usedBy.resourceType](use.usedBy)}${use.application ? ` of application "${use.application}"` : ""}`
    : `application "${use.application}"`;
  return `${CHECKED_RESOURCES[use.resourceType].label(use)} cannot be deleted: ${user} still uses it.`;
}

type AssertResourcesNotInUseParams = {
  /** Planned deployments of a deploy run, or the plan of a removal. */
  deployments: ReadonlyArray<ResourceDeletePlan>;
  /** Command whose run deletes the resources. */
  command: ResourceDeletingCommand;
  client: OperatorClient;
  workspaceId: string;
};

/**
 * Reject a run that deletes a resource still in use: an Auth service, TailorDB namespace,
 * resolver namespace, or IdP that an application references; an Auth IdP config that an
 * application authenticates with; an Auth service that an AI gateway authenticates against; a
 * machine user that an executor or resolver runs as; a TailorDB table, resolver, IdP, Auth
 * service, or workflow that an executor subscribes to or runs; an application that an
 * executor's GraphQL operation targets; a Secret Manager secret that a webhook executor, an Auth
 * service's OIDC IdP or SCIM config, or an OTLP exporter names; an IdP client that an Auth
 * service's built-in IdP config uses; or a TailorDB table that an Auth service's user profile,
 * tenant, or SCIM resource config maps onto.
 * A resource the plan writes counts by its planned version, a resource it deletes does not count,
 * and any other counts by the workspace's record. When the run spans several configs, call it
 * after deletes that another config in the run still claims are dropped and deletes of renamed
 * applications are scheduled.
 * @param params - The run's plans, its command, and the workspace they apply to
 */
export async function assertResourcesNotInUse(
  params: AssertResourcesNotInUseParams,
): Promise<void> {
  const { deployments, command, client, workspaceId } = params;
  const deletedRefs = deployments.flatMap((plan) =>
    Object.entries(CHECKED_RESOURCES).flatMap(([resourceType, { deletesOf }]) =>
      deletesOf(plan).map((resource) => ({
        ...resource,
        resourceType: resourceType as CheckedResourceType,
      })),
    ),
  );
  if (deletedRefs.length === 0) return;
  const deleted = new Set(deletedRefs.map(refKey));
  const deletedTypes = new Set(deletedRefs.map(({ resourceType }) => resourceType));
  const deletedClients = deletedRefs.filter(
    (ref): ref is DeletedIdPClient => ref.resourceType === "idp.client",
  );
  const workspaceUsesParams = { deployments, client, workspaceId };
  const [resolvers, idpConfigs, scimConfigs, authTableUsers, otlpExporters] = await Promise.all([
    deletedTypes.has("auth.machine_user") ? resolverUses(workspaceUsesParams) : [],
    deletedTypes.has("secret.secret") || deletedClients.length > 0
      ? idpConfigUses({ ...workspaceUsesParams, deletedClients })
      : [],
    deletedTypes.has("secret.secret") ? scimConfigUses(workspaceUsesParams) : [],
    deletedTypes.has("tailordb.type") ? authTableUses(workspaceUsesParams) : [],
    deletedTypes.has("secret.secret") ? otlpExporterUses(workspaceUsesParams) : [],
  ]);
  const allUses = [
    ...applicationUses(deployments),
    ...executorUses(deployments),
    ...resolvers,
    ...aiGatewayUses(deployments),
    ...idpConfigs,
    ...scimConfigs,
    ...authTableUsers,
    ...otlpExporters,
  ];
  const uses = [
    ...new Map(
      allUses.filter((use) => deleted.has(refKey(use))).map((use) => [describeUse(use), use]),
    ).values(),
  ];
  if (uses.length === 0) return;
  throw CLIError({
    code: "SERVICE_IN_USE",
    message: uses.map(describeUse).join("\n"),
    suggestion: inUseSuggestion(uses, command),
    context: { uses },
  });
}
