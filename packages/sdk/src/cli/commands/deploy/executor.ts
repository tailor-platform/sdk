import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateExecutorExecutorRequestSchema,
  type DeleteExecutorExecutorRequestSchema,
  UpdateExecutorExecutorRequestSchema,
} from "@tailor-platform/tailor-proto/executor_pb";
import {
  type ExecutorExecutorSchema,
  type ExecutorTargetConfigSchema,
  ExecutorTargetType,
  type ExecutorTargetWebhookHeaderSchema,
  type ExecutorTriggerConfigSchema,
  type ExecutorTriggerEventConfigSchema,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { type ApplicationEnv, type OperatorClient } from "#/cli/shared/client";
import { type CLIError, internalError, locatedCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { buildExecutorArgsExpr } from "#/cli/shared/runtime-exprs";
import { stringifyFunction } from "#/parser/service/tailordb/index";
import { assertDefined } from "#/utils/assert";
import { omitUndefined } from "#/utils/omit-undefined";
import { createChangeSet, type ChangeSet } from "./change-set";
import { defineRequestComparison, isRequestUnchanged } from "./compare";
import { configAuthNamespaces } from "./deploy-application";
import { executorFunctionName } from "./function-registry";
import {
  formatChangeEntriesWithFunctionRegistry,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import {
  type DefinitionRef,
  type InvokerScope,
  normalizeInvoker,
  planInvokerScope,
} from "./invoker";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  buildMetaRequest,
  type MetadataLabelWrite,
  resourceTrn,
  type WithLabel,
  writeLabelRefreshes,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "./owned-resource";
import type { ApplyPhase, NamespacesByName, PlanContext } from "#/cli/commands/deploy/types";
import type { ConfigServices } from "#/cli/services/application";
import type {
  Executor,
  ResolverExecutedTrigger,
  TailorDBTrigger,
} from "#/types/executor.generated";
import type { DeployApplication } from "./deploy-application";

type ExistingExecutors = WithLabel<
  Awaited<ReturnType<OperatorClient["listExecutorExecutors"]>>["executors"][number]
>;
type ExistingExecutorDetail = Awaited<
  ReturnType<OperatorClient["getExecutorExecutor"]>
>["executor"];
/** Fetch results a replan reuses instead of re-querying the platform. */
interface PreviousExistingExecutors {
  existingExecutors: ExistingExecutors;
  /** Full detail per executor name, populated only for executors matched during the original diff. */
  existingExecutorDetails: ReadonlyMap<string, ExistingExecutorDetail>;
}

/**
 * Apply executor-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned executor changes
 * @param phase - Apply phase (defaults to "create-update")
 * @returns Promise that resolves when executors are applied
 */
export async function applyExecutor(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planExecutor>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Executors
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createExecutorExecutor(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateExecutorExecutor(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
      ...writeLabelRefreshes(client, changeSet.unchanged),
    ]);
  } else {
    // Delete in reverse order of dependencies
    // Executors
    await Promise.all(changeSet.deletes.map((del) => client.deleteExecutorExecutor(del.request)));
  }
}

type CreateExecutor = {
  name: string;
  request: MessageInitShape<typeof CreateExecutorExecutorRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateExecutor = {
  name: string;
  request: MessageInitShape<typeof UpdateExecutorExecutorRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteExecutor = {
  name: string;
  request: MessageInitShape<typeof DeleteExecutorExecutorRequestSchema>;
};

type DesiredExecutor = {
  name: string;
  request: MessageInitShape<typeof CreateExecutorExecutorRequestSchema> &
    MessageInitShape<typeof UpdateExecutorExecutorRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

const executorComparison = defineRequestComparison({
  schema: UpdateExecutorExecutorRequestSchema,
  excluded: ["workspaceId"],
  normalize: ({ executor }) => {
    const trigger = executor?.triggerConfig?.config;
    if (trigger?.case === "incomingWebhook") {
      // The platform manages the webhook secret.
      trigger.value.secret = "";
    } else if (trigger?.case === "event") {
      // oxlint-disable-next-line typescript/no-deprecated -- The platform fills this legacy field in responses although the SDK never sets it.
      trigger.value.eventType = "";
    }
    const target = executor?.targetConfig?.config;
    if (target?.case === "webhook") {
      target.value.headers.sort((left, right) => left.key.localeCompare(right.key));
    } else if (target?.case === "function") {
      // The SDK sends the function by reference, never as an inline script.
      target.value.script = "";
    }
  },
});

/**
 * Plan executor-related changes based on current and desired state.
 * @param context - Planning context
 * @param previousExisting - A prior call's fetched existing executors and their details, reused
 *   instead of re-fetching them from the platform (the remote executors cannot have changed
 *   between a deploy's first plan and its conditional rebuild's replan)
 * @returns Planned changes
 */
export async function planExecutor(
  context: PlanContext,
  previousExisting?: PreviousExistingExecutors,
) {
  const { client, workspaceId, application, owner, forRemoval } = context;
  const changeSet = createChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor>("Executors");
  const ownership = createOwnershipTracker(owner);

  const fetchedExecutors =
    previousExisting?.existingExecutors ??
    (await fetchExistingResourcesWithLabels({
      client,
      fetchPage: async (pageToken, pageSize) => {
        const { executors, nextPageToken } = await client.listExecutorExecutors({
          workspaceId,
          pageToken,
          pageSize,
        });
        return [executors, nextPageToken];
      },
      getName: (resource) => resource.name,
      getTrn: (name) => resourceTrn(workspaceId, "executor", name),
    }));
  const executors = forRemoval ? {} : ((await application.executorService?.loadExecutors()) ?? {});
  const invokerScope = await planInvokerScope(
    context,
    Object.values(executors).map((executor) =>
      "invoker" in executor.operation ? executor.operation.invoker : undefined,
    ),
  );
  const cachedDetails = previousExisting?.existingExecutorDetails;
  const existingExecutorDetails = new Map(
    await Promise.all(
      Object.values(executors)
        .filter((executor) => fetchedExecutors[executor.name])
        .map(
          async (executor) =>
            [
              executor.name,
              cachedDetails?.has(executor.name)
                ? cachedDetails.get(executor.name)
                : (await client.getExecutorExecutor({ workspaceId, name: executor.name })).executor,
            ] as const,
        ),
    ),
  );
  const desired: DesiredExecutor[] = [];
  for (const [file, executor] of Object.entries(executors)) {
    desired.push({
      name: executor.name,
      request: {
        workspaceId,
        executor: protoExecutor(
          context,
          executor,
          file,
          { ...application.env, ...context.envOverrides?.executor },
          invokerScope,
        ),
      },
      metaRequest: await buildMetaRequest({
        trn: resourceTrn(workspaceId, "executor", executor.name),
        owner,
      }),
    });
  }
  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(fetchedExecutors),
    keyOf: (executor) => executor.name,
    ...labeledResourceChecks(ownership, "executor"),
    isConfigUnchanged: (executor) => {
      const detail = existingExecutorDetails.get(executor.name);
      return (
        !!detail && isRequestUnchanged(executorComparison, executor.request, { executor: detail })
      );
    },
    create: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    update: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    unchanged: ({ name }) => ({ name }),
    delete: (name) => ({ name, request: { workspaceId, name } }),
  });

  return {
    changeSet,
    ...ownership.result,
    existingExecutors: fetchedExecutors,
    existingExecutorDetails,
  };
}

type ExecutorDisplayEntry = GroupedDisplayEntry;

function isFunctionBackedExecutor(
  executor: MessageInitShape<typeof ExecutorExecutorSchema> | undefined,
) {
  return (
    executor?.targetType === ExecutorTargetType.FUNCTION ||
    executor?.targetType === ExecutorTargetType.JOB_FUNCTION
  );
}

/**
 * Build desired executor configs keyed by executor name from create/update changes.
 * @param changeSet - Executor create/update changes
 * @returns Executor configs keyed by name
 */
export function buildPlannedExecutorsByName(
  changeSet: Pick<ChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor>, "creates" | "updates">,
): Record<string, MessageInitShape<typeof ExecutorExecutorSchema> | undefined> {
  return Object.fromEntries(
    [...changeSet.creates, ...changeSet.updates].map((item) => [item.name, item.request.executor]),
  );
}

/**
 * Format executor changes for grouped dry-run display.
 * @param changeSet - Executor changes
 * @param executors - Desired executor configs keyed by name
 * @param functionRegistryExecutorChanges - Related function registry changes for executors
 * @returns Display entries for executor output
 */
export function formatExecutorChangeEntries(
  changeSet: Pick<
    ChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  executors: Record<string, MessageInitShape<typeof ExecutorExecutorSchema> | undefined>,
  functionRegistryExecutorChanges?: RelatedFunctionRegistryChanges,
): ExecutorDisplayEntry[] {
  return formatChangeEntriesWithFunctionRegistry(
    "executor",
    changeSet,
    functionRegistryExecutorChanges,
    (item, action) => {
      if (action === "delete") {
        return [executorFunctionName(item.name)];
      }
      const executor = executors[item.name];
      return executor && isFunctionBackedExecutor(executor)
        ? [executorFunctionName(item.name)]
        : [];
    },
  );
}

function tailorDBNamespacesDefining(
  application: Readonly<Pick<ConfigServices, "tailorDBServices">>,
  tableName: string,
): string[] {
  return application.tailorDBServices
    .filter((service) => Object.hasOwn(service.types, tableName))
    .map((service) => service.namespace);
}

function resolverNamespacesDefining(
  application: Readonly<Pick<ConfigServices, "resolverServices">>,
  resolverName: string,
): string[] {
  return application.resolverServices
    .filter((service) =>
      Object.values(service.resolvers).some((resolver) => resolver.name === resolverName),
    )
    .map((service) => service.namespace);
}

type SeveralDefiningNamespaces = "none" | "first";

function pickLocalNamespace(
  definingNamespaces: ReadonlyArray<string>,
  namedNamespace: string | undefined,
  whenSeveral: SeveralDefiningNamespaces,
): string | undefined {
  if (namedNamespace !== undefined) {
    return definingNamespaces.includes(namedNamespace) ? namedNamespace : undefined;
  }
  return definingNamespaces.length === 1 || whenSeveral === "first"
    ? definingNamespaces[0]
    : undefined;
}

type TailorDBTriggerTarget = Pick<TailorDBTrigger, "tableName" | "namespace">;

type ResolverTriggerTarget = Pick<ResolverExecutedTrigger, "resolverName" | "namespace">;

/**
 * Find the local TailorDB namespace a TailorDB trigger subscribes in.
 * @param application - Services the config defines
 * @param trigger - The table the trigger names, and its namespace when it names one
 * @returns The namespace the trigger names when it defines the table, else the one local namespace
 * that defines it; undefined when there is no such namespace
 */
export function localTailorDBTriggerNamespace(
  application: Readonly<Pick<ConfigServices, "tailorDBServices">>,
  trigger: TailorDBTriggerTarget,
): string | undefined {
  return pickLocalNamespace(
    tailorDBNamespacesDefining(application, trigger.tableName),
    trigger.namespace,
    "none",
  );
}

/**
 * Find the local resolver namespace a resolverExecuted trigger subscribes in.
 * @param application - Services the config defines
 * @param trigger - The resolver the trigger names, and its namespace when it names one
 * @returns The namespace the trigger names when it defines the resolver, else the first local
 * namespace that defines it; undefined when there is no such namespace
 */
export function localResolverTriggerNamespace(
  application: Readonly<Pick<ConfigServices, "resolverServices">>,
  trigger: ResolverTriggerTarget,
): string | undefined {
  return pickLocalNamespace(
    resolverNamespacesDefining(application, trigger.resolverName),
    trigger.namespace,
    "first",
  );
}

/** A TailorDB table or resolver an executor trigger names. */
type NamespacedResource = {
  executor: DefinitionRef;
  /** Kind of the resource in error messages, such as `TailorDB table`. */
  label: string;
  name: string;
};

type ResolveNamespaceParams = {
  resource: NamespacedResource;
  /** Namespace the trigger names, when it names one. */
  namedNamespace: string | undefined;
  localNamespaces: ReadonlyArray<string>;
  /** Local namespaces that define the resource. */
  definingNamespaces: ReadonlyArray<string>;
  whenSeveral: SeveralDefiningNamespaces;
  sameRunNamespaces?: NamespacesByName | undefined;
};

function ambiguousNamespaceError(
  resource: NamespacedResource,
  namespaces: ReadonlyArray<string>,
): CLIError {
  const { executor, label, name } = resource;
  return locatedCLIError(
    { file: executor.file },
    {
      code: "DEPLOY_RESOURCE_NAMESPACE_AMBIGUOUS",
      message: `Executor "${executor.name}" triggers on ${label} "${name}", which several namespaces define: ${namespaces.join(", ")}.`,
      suggestion:
        "Name the namespace with the trigger's `namespace` option. For an executor a plugin generates, the plugin has to set it.",
      context: { executor: executor.name, resource: name, namespaces: [...namespaces] },
    },
  );
}

/**
 * Resolve a resource's namespace among the namespaces of the deploy run that the config sees.
 * @param sameRunNamespaces - Namespaces keyed by the names of the resources they define
 * @param resource - Resource to resolve and the executor whose trigger names it
 * @param namedNamespace - Namespace the trigger names, when it names one
 * @returns The namespace, or undefined when none of them defines the resource there
 * @throws CLIError coded `DEPLOY_RESOURCE_NAMESPACE_AMBIGUOUS` when the trigger names no namespace
 * and several define the resource
 */
function resolveSameRunNamespace(
  sameRunNamespaces: NamespacesByName | undefined,
  resource: NamespacedResource,
  namedNamespace: string | undefined,
): string | undefined {
  const defining = sameRunNamespaces?.get(resource.name);
  if (defining === undefined) {
    return undefined;
  }
  if (namedNamespace !== undefined) {
    return defining.has(namedNamespace) ? namedNamespace : undefined;
  }
  if (defining.size > 1) {
    throw ambiguousNamespaceError(resource, [...defining]);
  }
  const [namespace] = defining;
  return namespace;
}

function notFoundInNamespaceError(resource: NamespacedResource, namespace: string): CLIError {
  const { executor, label, name } = resource;
  return locatedCLIError(
    { file: executor.file },
    {
      code: "DEPLOY_RESOURCE_NOT_FOUND",
      message: `Executor "${executor.name}" triggers on ${label} "${name}" in namespace "${namespace}", which does not define it.`,
      context: { executor: executor.name, resource: name, namespace },
    },
  );
}

function resolveNamespace(params: ResolveNamespaceParams): string {
  const {
    resource,
    namedNamespace,
    localNamespaces,
    definingNamespaces,
    whenSeveral,
    sameRunNamespaces,
  } = params;
  const { executor, label, name } = resource;
  const localNamespace = pickLocalNamespace(definingNamespaces, namedNamespace, whenSeveral);
  if (localNamespace !== undefined) {
    if (namedNamespace === undefined && definingNamespaces.length > 1) {
      logger.warn(
        `Executor "${executor.name}" triggers on ${label} "${name}", which several namespaces define: ${definingNamespaces.join(", ")}. It subscribes to the one in "${localNamespace}"; name another with the trigger's \`namespace\` option.`,
      );
    }
    return localNamespace;
  }
  if (namedNamespace === undefined && definingNamespaces.length > 1) {
    throw ambiguousNamespaceError(resource, definingNamespaces);
  }
  if (namedNamespace !== undefined && localNamespaces.includes(namedNamespace)) {
    throw notFoundInNamespaceError(resource, namedNamespace);
  }
  const sameRunNamespace = resolveSameRunNamespace(sameRunNamespaces, resource, namedNamespace);
  if (sameRunNamespace !== undefined) {
    return sameRunNamespace;
  }
  if (namedNamespace !== undefined) {
    throw notFoundInNamespaceError(resource, namedNamespace);
  }
  const sameRunAvailableNamespaces = new Set(
    [...(sameRunNamespaces?.values() ?? [])].flatMap((namespaces) => [...namespaces]),
  );
  const available = [...localNamespaces, ...sameRunAvailableNamespaces];
  throw locatedCLIError(
    { file: executor.file },
    {
      code: "DEPLOY_RESOURCE_NOT_FOUND",
      message: `Executor "${executor.name}" triggers on ${label} "${name}", which is not found in any namespace. Available namespaces: ${available.join(", ")}`,
      context: { executor: executor.name, resource: name, available },
    },
  );
}

function resolveTailorDBNamespace(
  application: Readonly<ConfigServices>,
  executor: DefinitionRef,
  trigger: TailorDBTriggerTarget,
  sameRunNamespaces?: NamespacesByName,
): string {
  return resolveNamespace({
    resource: { executor, label: "TailorDB table", name: trigger.tableName },
    namedNamespace: trigger.namespace,
    localNamespaces: application.tailorDBServices.map((service) => service.namespace),
    definingNamespaces: tailorDBNamespacesDefining(application, trigger.tableName),
    whenSeveral: "none",
    sameRunNamespaces,
  });
}

function resolveResolverNamespace(
  application: Readonly<ConfigServices>,
  executor: DefinitionRef,
  trigger: ResolverTriggerTarget,
  sameRunNamespaces?: NamespacesByName,
): string {
  return resolveNamespace({
    resource: { executor, label: "Resolver", name: trigger.resolverName },
    namedNamespace: trigger.namespace,
    localNamespaces: application.resolverServices.map((service) => service.namespace),
    definingNamespaces: resolverNamespacesDefining(application, trigger.resolverName),
    whenSeveral: "first",
    sameRunNamespaces,
  });
}

type IdpNamesSource = {
  application: Pick<ConfigServices, "idpServices">;
  applications: ReadonlyArray<Pick<DeployApplication, "subgraphs">>;
};

/**
 * Collect IdP names declared by a config, including external IdP subgraphs of its applications.
 * @param config - Services and applications of the config
 * @returns IdP names visible from the config
 */
export function collectConfigIdpNames(config: IdpNamesSource): ReadonlySet<string> {
  const names = new Set(config.application.idpServices.map((idp) => idp.name));
  for (const subgraph of config.applications.flatMap((application) => application.subgraphs)) {
    if (subgraph.Type === "idp") {
      names.add(subgraph.Name);
    }
  }
  return names;
}

function resolveIdpNamespace(
  context: PlanContext,
  executor: DefinitionRef,
  idpName: string | undefined,
): string {
  const localIdpNames = collectConfigIdpNames(context);
  if (idpName !== undefined) {
    const candidateNames = context.idpNames ?? localIdpNames;
    if (!candidateNames.has(idpName)) {
      const available = [...candidateNames];
      throw locatedCLIError(
        { file: executor.file },
        {
          code: "EXECUTOR_IDP_NOT_FOUND",
          message:
            `Executor "${executor.name}" specifies IdP "${idpName}" in its idpUser trigger, ` +
            `but no IdP with that name is configured. Available IdPs: ${available.join(", ")}`,
          context: { executor: executor.name, idp: idpName, available },
        },
      );
    }
    return idpName;
  }
  if (localIdpNames.size === 0) {
    throw locatedCLIError(
      { file: context.config.path },
      {
        code: "EXECUTOR_IDP_REQUIRED",
        message: `Executor "${executor.name}" uses an idpUser trigger but no IdP is configured.`,
        context: { executor: executor.name },
      },
    );
  }
  if (localIdpNames.size > 1) {
    const available = [...localIdpNames];
    throw locatedCLIError(
      { file: executor.file },
      {
        code: "EXECUTOR_IDP_AMBIGUOUS",
        message:
          `Executor "${executor.name}" uses an idpUser trigger but the project defines multiple IdPs ` +
          `(${available.join(", ")}). Specify which IdP to subscribe to via the trigger's "idp" option.`,
        context: { executor: executor.name, available },
      },
    );
  }
  return assertDefined([...localIdpNames][0], "idp service missing");
}

function defaultGraphQLAppName(context: PlanContext, executor: DefinitionRef): string {
  const available = context.applications.map(({ name }) => name);
  const [only, ...others] = available;
  if (only !== undefined && others.length === 0) return only;
  throw locatedCLIError(
    { file: executor.file },
    {
      code: available.length === 0 ? "EXECUTOR_APP_NAME_REQUIRED" : "EXECUTOR_APP_NAME_AMBIGUOUS",
      message: `Executor "${executor.name}" runs a GraphQL operation without appName, but its config deploys ${available.length === 0 ? "no applications" : `the applications ${available.join(", ")}`}.`,
      suggestion:
        available.length === 0
          ? "Add an application to the config's apps, or remove the operation."
          : `Set appName on the operation to one of ${available.join(", ")}.`,
      context: { executor: executor.name, available },
    },
  );
}

function resolveAuthAccessTokenNamespace(
  context: PlanContext,
  executor: DefinitionRef,
  auth: string | undefined,
): string {
  const available = configAuthNamespaces(context);
  const [only, ...others] = available;
  if (only === undefined) {
    throw locatedCLIError(
      { file: context.config.path },
      {
        code: "AUTH_CONFIG_REQUIRED",
        message: `Executor "${executor.name}" uses an authAccessToken trigger, but its config uses no Auth service.`,
        suggestion:
          'Define an Auth service in this config. A defineConfig() config can instead reference one that another config defines with auth: { name: "<auth-name>", external: true }.',
        context: { executor: executor.name },
      },
    );
  }
  const uses = others.length === 0 ? `Auth "${only}"` : `the Auth services ${available.join(", ")}`;
  if (auth !== undefined) {
    if (available.includes(auth)) return auth;
    throw locatedCLIError(
      { file: executor.file },
      {
        code: "EXECUTOR_AUTH_NOT_FOUND",
        message: `Executor "${executor.name}" names Auth "${auth}" in its authAccessToken trigger, but its config uses ${uses}.`,
        suggestion:
          others.length === 0
            ? `Set the trigger's "auth" to "${only}", or omit it.`
            : `Set the trigger's "auth" to one of ${available.join(", ")}.`,
        context: { executor: executor.name, auth, available },
      },
    );
  }
  if (others.length > 0) {
    throw locatedCLIError(
      { file: executor.file },
      {
        code: "EXECUTOR_AUTH_AMBIGUOUS",
        message: `Executor "${executor.name}" uses an authAccessToken trigger, but its config uses ${uses}.`,
        suggestion: `Set the trigger's "auth" to the Auth service it subscribes to.`,
        context: { executor: executor.name, available },
      },
    );
  }
  return only;
}

function protoExecutor(
  context: PlanContext,
  executor: Executor,
  file: string,
  env: ApplicationEnv,
  invokerScope: InvokerScope,
): MessageInitShape<typeof ExecutorExecutorSchema> {
  const { application } = context;
  const definition: DefinitionRef = { kind: "executor", name: executor.name, file };
  const trigger = executor.trigger;
  let triggerType: ExecutorTriggerType;
  let triggerConfig: MessageInitShape<typeof ExecutorTriggerConfigSchema>;

  const argsExpr = buildExecutorArgsExpr(trigger.kind, env);

  function typedEventTrigger(
    typedConfig: MessageInitShape<typeof ExecutorTriggerEventConfigSchema>["typedConfig"],
  ): MessageInitShape<typeof ExecutorTriggerConfigSchema> {
    return { config: { case: "event", value: omitUndefined({ typedConfig }) } };
  }

  switch (trigger.kind) {
    case "schedule":
      triggerType = ExecutorTriggerType.SCHEDULE;
      triggerConfig = {
        config: {
          case: "schedule",
          value: {
            timezone: trigger.timezone,
            frequency: trigger.cron,
          },
        },
      };
      break;
    case "tailordb":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "tailordb",
        value: {
          eventTypes: trigger.events,
          namespaceName: resolveTailorDBNamespace(
            application,
            definition,
            trigger,
            context.tailorDBTypeNamespaces,
          ),
          typeName: trigger.tableName,
          ...(trigger.condition
            ? { condition: { expr: `(${stringifyFunction(trigger.condition)})(${argsExpr})` } }
            : {}),
        },
      });
      break;
    case "resolverExecuted":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "pipeline",
        value: {
          eventTypes: ["pipeline.resolver.executed"],
          namespaceName: resolveResolverNamespace(
            application,
            definition,
            trigger,
            context.resolverNamespaces,
          ),
          resolverName: trigger.resolverName,
          ...(trigger.condition
            ? { condition: { expr: `(${stringifyFunction(trigger.condition)})(${argsExpr})` } }
            : {}),
        },
      });
      break;
    case "incomingWebhook":
      triggerType = ExecutorTriggerType.INCOMING_WEBHOOK;
      triggerConfig = {
        config: {
          case: "incomingWebhook",
          value: trigger.response
            ? {
                response: {
                  ...(trigger.response.body
                    ? {
                        body: {
                          expr: `(${stringifyFunction(trigger.response.body)})(${argsExpr})`,
                        },
                      }
                    : {}),
                  ...(trigger.response.statusCode != null
                    ? { statusCode: trigger.response.statusCode }
                    : {}),
                },
              }
            : {},
        },
      };
      break;
    case "idpUser":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "idp",
        value: {
          eventTypes: trigger.events,
          namespaceName: resolveIdpNamespace(context, definition, trigger.idp),
        },
      });
      break;
    case "authAccessToken":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "auth",
        value: {
          eventTypes: trigger.events,
          namespaceName: resolveAuthAccessTokenNamespace(context, definition, trigger.auth),
        },
      });
      break;
    case "workflowExecution":
    case "workflowJobExecution":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "workflow",
        value: {
          eventTypes: trigger.events,
          workflowName: trigger.workflowName,
          ...(trigger.condition
            ? { condition: { expr: `(${stringifyFunction(trigger.condition)})(${argsExpr})` } }
            : {}),
        },
      });
      break;
    default:
      throw internalError(`Unknown trigger: ${trigger satisfies never}`);
  }

  const target = executor.operation;
  let targetType: ExecutorTargetType;
  let targetConfig: MessageInitShape<typeof ExecutorTargetConfigSchema>;

  switch (target.kind) {
    case "webhook": {
      targetType = ExecutorTargetType.WEBHOOK;
      targetConfig = {
        config: {
          case: "webhook",
          value: omitUndefined({
            url: {
              expr: `(${stringifyFunction(target.url)})(${argsExpr})`,
            },
            headers: target.headers
              ? Object.entries(target.headers).map(([key, v]) => {
                  let value: MessageInitShape<typeof ExecutorTargetWebhookHeaderSchema>["value"];
                  if (typeof v === "string") {
                    value = {
                      case: "rawValue",
                      value: v,
                    };
                  } else {
                    value = {
                      case: "secretValue",
                      value: {
                        vaultName: v.vault,
                        secretKey: v.key,
                      },
                    };
                  }
                  return { key, value };
                })
              : undefined,
            body: target.requestBody
              ? {
                  expr: `(${stringifyFunction(target.requestBody)})(${argsExpr})`,
                }
              : undefined,
          }),
        },
      };
      break;
    }
    case "graphql": {
      targetType = ExecutorTargetType.TAILOR_GRAPHQL;
      targetConfig = {
        config: {
          case: "tailorGraphql",
          value: omitUndefined({
            appName: target.appName ?? defaultGraphQLAppName(context, definition),
            query: target.query,
            variables: target.variables
              ? {
                  expr: `(${stringifyFunction(target.variables)})(${argsExpr})`,
                }
              : undefined,
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          }),
        },
      };
      break;
    }
    case "function":
    case "jobFunction": {
      if (target.kind === "function") {
        targetType = ExecutorTargetType.FUNCTION;
      } else {
        targetType = ExecutorTargetType.JOB_FUNCTION;
      }

      targetConfig = {
        config: {
          case: "function",
          value: omitUndefined({
            name: "operation",
            scriptRef: executorFunctionName(executor.name),
            variables: {
              expr: argsExpr,
            },
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          }),
        },
      };
      break;
    }
    case "workflow": {
      targetType = ExecutorTargetType.WORKFLOW;
      targetConfig = {
        config: {
          case: "workflow",
          value: omitUndefined({
            workflowName: target.workflowName,
            variables:
              target.args !== undefined
                ? typeof target.args === "function"
                  ? { expr: `(${stringifyFunction(target.args)})(${argsExpr})` }
                  : { expr: JSON.stringify(target.args) }
                : undefined,
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          }),
        },
      };
      break;
    }
    default:
      throw internalError(`Unknown target: ${target satisfies never}`);
  }

  return omitUndefined({
    name: executor.name,
    description: executor.description,
    disabled: executor.disabled,
    triggerType,
    triggerConfig,
    targetType,
    targetConfig,
  });
}
