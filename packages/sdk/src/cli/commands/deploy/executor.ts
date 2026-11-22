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
import { CLIError, internalError, locatedCLIError } from "#/cli/shared/errors";
import { buildExecutorArgsExpr } from "#/cli/shared/runtime-exprs";
import { stringifyFunction } from "#/parser/service/tailordb/index";
import { assertDefined } from "#/utils/assert";
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
  listInvokerMachineUsers,
  normalizeInvoker,
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
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { ConfigServices } from "#/cli/services/application";
import type { Executor } from "#/types/executor.generated";
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
  const authNamespaces = configAuthNamespaces(context);
  const invokerScope: InvokerScope = {
    authNamespaces,
    machineUsers: await listInvokerMachineUsers({
      client,
      workspaceId,
      invokers: Object.values(executors).map((executor) =>
        "invoker" in executor.operation ? executor.operation.invoker : undefined,
      ),
      authNamespaces,
      plannedMachineUsers: context.plannedMachineUsers,
    }),
    configPath: context.config.path,
  };
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

/**
 * Resolve a resource's namespace from same-run peer configs, throwing when the
 * name is claimed by more than one namespace in the deploy run.
 * @param sameRunNamespaces - Namespaces keyed by resource name across the deploy run
 * @param resourceName - Resource name to resolve
 * @param resourceLabel - Resource label used in error messages
 * @returns The owning namespace, or undefined when the name is unknown
 */
function resolveSameRunNamespace(
  sameRunNamespaces: ReadonlyMap<string, string | undefined> | undefined,
  resourceName: string,
  resourceLabel: string,
): string | undefined {
  if (!sameRunNamespaces?.has(resourceName)) {
    return undefined;
  }
  const namespace = sameRunNamespaces.get(resourceName);
  if (!namespace) {
    throw CLIError({
      code: "DEPLOY_RESOURCE_NAMESPACE_AMBIGUOUS",
      message:
        `${resourceLabel} "${resourceName}" is defined in multiple namespaces in this deploy run. ` +
        `Move the trigger to the application that owns it or use unique names.`,
    });
  }
  return namespace;
}

/**
 * Find the local TailorDB namespace that declares the given table.
 * @param application - Services the config defines
 * @param tableName - TailorDB table name to look up
 * @returns The declaring namespace, or undefined when no local service has it
 */
function findTailorDBNamespace(
  application: Readonly<ConfigServices>,
  tableName: string,
): string | undefined {
  return application.tailorDBServices.find((service) => Object.hasOwn(service.types, tableName))
    ?.namespace;
}

/**
 * Find the local resolver namespace that declares the given resolver.
 * @param application - Services the config defines
 * @param resolverName - Resolver name to look up
 * @returns The declaring namespace, or undefined when no local service has it
 */
export function findResolverNamespace(
  application: Readonly<ConfigServices>,
  resolverName: string,
): string | undefined {
  return application.resolverServices.find((service) =>
    Object.values(service.resolvers).some((resolver) => resolver.name === resolverName),
  )?.namespace;
}

function resolveNamespace(params: {
  resourceLabel: string;
  resourceName: string;
  localNamespaces: ReadonlyArray<string>;
  findLocalNamespace: () => string | undefined;
  sameRunNamespaces?: ReadonlyMap<string, string | undefined>;
}): string {
  const { resourceLabel, resourceName, localNamespaces, findLocalNamespace, sameRunNamespaces } =
    params;
  const localNamespace = findLocalNamespace();
  if (localNamespace !== undefined) {
    return localNamespace;
  }
  const sameRunNamespace = resolveSameRunNamespace(sameRunNamespaces, resourceName, resourceLabel);
  if (sameRunNamespace !== undefined) {
    return sameRunNamespace;
  }
  const sameRunAvailableNamespaces = sameRunNamespaces
    ? [...new Set([...sameRunNamespaces.values()].filter((value) => value !== undefined))]
    : [];
  const availableNamespaces = [...localNamespaces, ...sameRunAvailableNamespaces];
  throw CLIError({
    code: "DEPLOY_RESOURCE_NOT_FOUND",
    message: `${resourceLabel} "${resourceName}" not found in any namespace. Available namespaces: ${availableNamespaces.join(", ")}`,
  });
}

function resolveTailorDBNamespace(
  application: Readonly<ConfigServices>,
  typeName: string,
  sameRunNamespaces?: ReadonlyMap<string, string | undefined>,
): string {
  return resolveNamespace({
    resourceLabel: "TailorDB table",
    resourceName: typeName,
    localNamespaces: application.tailorDBServices.map((service) => service.namespace),
    findLocalNamespace: () => findTailorDBNamespace(application, typeName),
    sameRunNamespaces,
  });
}

function resolveResolverNamespace(
  application: Readonly<ConfigServices>,
  resolverName: string,
  sameRunNamespaces?: ReadonlyMap<string, string | undefined>,
): string {
  return resolveNamespace({
    resourceLabel: "Resolver",
    resourceName: resolverName,
    localNamespaces: application.resolverServices.map((service) => service.namespace),
    findLocalNamespace: () => findResolverNamespace(application, resolverName),
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
      throw locatedCLIError(executor.file, {
        code: "EXECUTOR_IDP_NOT_FOUND",
        message:
          `Executor "${executor.name}" specifies IdP "${idpName}" in its idpUser trigger, ` +
          `but no IdP with that name is configured. Available IdPs: ${available.join(", ")}`,
        context: { executor: executor.name, idp: idpName, available },
      });
    }
    return idpName;
  }
  if (localIdpNames.size === 0) {
    throw locatedCLIError(context.config.path, {
      code: "EXECUTOR_IDP_REQUIRED",
      message: `Executor "${executor.name}" uses an idpUser trigger but no IdP is configured.`,
      context: { executor: executor.name },
    });
  }
  if (localIdpNames.size > 1) {
    const available = [...localIdpNames];
    throw locatedCLIError(executor.file, {
      code: "EXECUTOR_IDP_AMBIGUOUS",
      message:
        `Executor "${executor.name}" uses an idpUser trigger but the project defines multiple IdPs ` +
        `(${available.join(", ")}). Specify which IdP to subscribe to via the trigger's "idp" option.`,
      context: { executor: executor.name, available },
    });
  }
  return assertDefined([...localIdpNames][0], "idp service missing");
}

function defaultGraphQLAppName(context: PlanContext, executorName: string): string {
  const available = context.applications.map(({ name }) => name);
  const [only, ...others] = available;
  if (only !== undefined && others.length === 0) return only;
  throw CLIError({
    code: available.length === 0 ? "EXECUTOR_APP_NAME_REQUIRED" : "EXECUTOR_APP_NAME_AMBIGUOUS",
    message: `Executor "${executorName}" runs a GraphQL operation without appName, but its config deploys ${available.length === 0 ? "no applications" : `the applications ${available.join(", ")}`}.`,
    suggestion:
      available.length === 0
        ? "Add an application to the config's apps, or remove the operation."
        : `Set appName on the operation to one of ${available.join(", ")}.`,
    context: { executor: executorName, available },
  });
}

function resolveAuthAccessTokenNamespace(
  context: PlanContext,
  executor: DefinitionRef,
  auth: string | undefined,
): string {
  const available = configAuthNamespaces(context);
  const [only, ...others] = available;
  if (only === undefined) {
    throw locatedCLIError(context.config.path, {
      code: "AUTH_CONFIG_REQUIRED",
      message: `Executor "${executor.name}" uses an authAccessToken trigger, but its config uses no Auth service.`,
      suggestion:
        'Define an Auth service in this config. A defineConfig() config can instead reference one that another config defines with auth: { name: "<auth-name>", external: true }.',
      context: { executor: executor.name },
    });
  }
  const uses = others.length === 0 ? `Auth "${only}"` : `the Auth services ${available.join(", ")}`;
  if (auth !== undefined) {
    if (available.includes(auth)) return auth;
    throw locatedCLIError(executor.file, {
      code: "EXECUTOR_AUTH_NOT_FOUND",
      message: `Executor "${executor.name}" names Auth "${auth}" in its authAccessToken trigger, but its config uses ${uses}.`,
      suggestion:
        others.length === 0
          ? `Set the trigger's "auth" to "${only}", or omit it.`
          : `Set the trigger's "auth" to one of ${available.join(", ")}.`,
      context: { executor: executor.name, auth, available },
    });
  }
  if (others.length > 0) {
    throw locatedCLIError(executor.file, {
      code: "EXECUTOR_AUTH_AMBIGUOUS",
      message: `Executor "${executor.name}" uses an authAccessToken trigger, but its config uses ${uses}.`,
      suggestion: `Set the trigger's "auth" to the Auth service it subscribes to.`,
      context: { executor: executor.name, available },
    });
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
    return { config: { case: "event", value: { typedConfig } } };
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
            trigger.tableName,
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
            trigger.resolverName,
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
          value: {
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
          },
        },
      };
      break;
    }
    case "graphql": {
      targetType = ExecutorTargetType.TAILOR_GRAPHQL;
      targetConfig = {
        config: {
          case: "tailorGraphql",
          value: {
            appName: target.appName ?? defaultGraphQLAppName(context, executor.name),
            query: target.query,
            variables: target.variables
              ? {
                  expr: `(${stringifyFunction(target.variables)})(${argsExpr})`,
                }
              : undefined,
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          },
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
          value: {
            name: "operation",
            scriptRef: executorFunctionName(executor.name),
            variables: {
              expr: argsExpr,
            },
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          },
        },
      };
      break;
    }
    case "workflow": {
      targetType = ExecutorTargetType.WORKFLOW;
      targetConfig = {
        config: {
          case: "workflow",
          value: {
            workflowName: target.workflowName,
            variables:
              target.args !== undefined
                ? typeof target.args === "function"
                  ? { expr: `(${stringifyFunction(target.args)})(${argsExpr})` }
                  : { expr: JSON.stringify(target.args) }
                : undefined,
            invoker: normalizeInvoker(target.invoker, invokerScope, definition),
          },
        },
      };
      break;
    }
    default:
      throw internalError(`Unknown target: ${target satisfies never}`);
  }

  return {
    name: executor.name,
    description: executor.description,
    disabled: executor.disabled,
    triggerType,
    triggerConfig,
    targetType,
    targetConfig,
  };
}
