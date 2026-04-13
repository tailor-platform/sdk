import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateExecutorExecutorRequestSchema,
  type DeleteExecutorExecutorRequestSchema,
  type UpdateExecutorExecutorRequestSchema,
} from "@tailor-proto/tailor/v1/executor_pb";
import {
  type ExecutorExecutorSchema,
  type ExecutorTargetConfigSchema,
  ExecutorTargetType,
  type ExecutorTargetWebhookHeaderSchema,
  type ExecutorTriggerConfigSchema,
  type ExecutorTriggerEventConfigSchema,
  ExecutorTriggerType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { buildExecutorArgsExpr } from "@/cli/shared/runtime-args";
import { stringifyFunction } from "@/parser/service/tailordb";
import { normalizeAuthInvoker } from "./auth-invoker";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual, normalizeProtoConfig } from "./compare";
import { executorFunctionName } from "./function-registry";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/apply/apply";
import type { Application } from "@/cli/services/application";
import type { Executor } from "@/types/executor.generated";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

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
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateExecutorExecutor(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Executors
    await Promise.all(changeSet.deletes.map((del) => client.deleteExecutorExecutor(del.request)));
  }
}

type CreateExecutor = {
  name: string;
  request: MessageInitShape<typeof CreateExecutorExecutorRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateExecutor = {
  name: string;
  request: MessageInitShape<typeof UpdateExecutorExecutorRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteExecutor = {
  name: string;
  request: MessageInitShape<typeof DeleteExecutorExecutorRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:executor:${name}`;
}

/**
 * Plan executor-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planExecutor(context: PlanContext) {
  const { client, workspaceId, application, forRemoval } = context;
  const changeSet = createChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor>("Executors");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { executors, nextPageToken } = await client.listExecutorExecutors({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [executors, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingExecutors: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.name),
      });
      existingExecutors[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  const executors = forRemoval ? {} : ((await application.executorService?.loadExecutors()) ?? {});
  for (const executor of Object.values(executors)) {
    const existing = existingExecutors[executor.name];
    const metaRequest = await buildMetaRequest(trn(workspaceId, executor.name), application.name);
    const desiredExecutor = protoExecutor(application, executor);
    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Executor",
          resourceName: executor.name,
        });
      } else if (existing.label !== application.name) {
        conflicts.push({
          resourceType: "Executor",
          resourceName: executor.name,
          currentOwner: existing.label,
        });
      }

      if (
        existing.label === application.name &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areExecutorsEqual(existing.resource, desiredExecutor)
      ) {
        changeSet.unchanged.push({ name: executor.name });
      } else {
        changeSet.updates.push({
          name: executor.name,
          request: {
            workspaceId,
            executor: desiredExecutor,
          },
          metaRequest,
        });
      }
      delete existingExecutors[executor.name];
    } else {
      changeSet.creates.push({
        name: executor.name,
        request: {
          workspaceId,
          executor: desiredExecutor,
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingExecutors).forEach(([name]) => {
    const label = existingExecutors[name]?.label;
    if (label && label !== application.name) {
      resourceOwners.add(label);
    }
    // Only delete executors managed by this application
    if (label === application.name) {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          name,
        },
      });
    }
  });

  changeSet.print();
  return { changeSet, conflicts, unmanaged, resourceOwners };
}

function normalizeComparableExecutor(executor: MessageInitShape<typeof ExecutorExecutorSchema>) {
  const normalized = normalizeProtoConfig(executor) ?? {};
  const webhookHeaders =
    normalized.targetConfig?.config?.case === "webhook"
      ? [...(normalized.targetConfig.config.value.headers ?? [])].sort((left, right) =>
          (left.key ?? "").localeCompare(right.key ?? ""),
        )
      : undefined;
  const triggerConfig =
    normalized.triggerConfig?.config?.case === "incomingWebhook"
      ? {
          ...normalized.triggerConfig,
          config: {
            ...normalized.triggerConfig.config,
            value: {},
          },
        }
      : normalized.triggerConfig?.config?.case === "event"
        ? {
            ...normalized.triggerConfig,
            config: {
              ...normalized.triggerConfig.config,
              value: {
                ...normalized.triggerConfig.config.value,
                // The platform fills this field in responses even though the SDK never sets it.
                eventType: undefined,
              },
            },
          }
        : normalized.triggerConfig;
  return {
    name: normalized.name,
    description: normalized.description ?? "",
    disabled: normalized.disabled ?? false,
    triggerType: normalized.triggerType,
    triggerConfig,
    targetType: normalized.targetType,
    targetConfig:
      normalized.targetConfig?.config?.case === "webhook"
        ? {
            ...normalized.targetConfig,
            config: {
              ...normalized.targetConfig.config,
              value: {
                ...normalized.targetConfig.config.value,
                headers: webhookHeaders,
              },
            },
          }
        : normalized.targetConfig?.config?.case === "function"
          ? {
              ...normalized.targetConfig,
              config: {
                ...normalized.targetConfig.config,
                value: {
                  ...normalized.targetConfig.config.value,
                  script: undefined,
                },
              },
            }
          : normalized.targetConfig,
  };
}

function areExecutorsEqual(
  existing: MessageInitShape<typeof ExecutorExecutorSchema>,
  desired: MessageInitShape<typeof ExecutorExecutorSchema>,
): boolean {
  return areNormalizedEqual(
    normalizeComparableExecutor(existing),
    normalizeComparableExecutor(desired),
  );
}

function resolveTailorDBNamespace(application: Readonly<Application>, typeName: string): string {
  for (const service of application.tailorDBServices) {
    if (service.types[typeName]) {
      return service.namespace;
    }
  }
  throw new Error(
    `TailorDB type "${typeName}" not found in any namespace. Available namespaces: ${application.tailorDBServices.map((s) => s.namespace).join(", ")}`,
  );
}

function resolveResolverNamespace(
  application: Readonly<Application>,
  resolverName: string,
): string {
  for (const service of application.resolverServices) {
    if (Object.values(service.resolvers).some((r) => r.name === resolverName)) {
      return service.namespace;
    }
  }
  throw new Error(
    `Resolver "${resolverName}" not found in any namespace. Available namespaces: ${application.resolverServices.map((s) => s.namespace).join(", ")}`,
  );
}

function resolveIdpNamespace(application: Readonly<Application>): string {
  if (application.idpServices.length === 0) {
    throw new Error("No IdP service configured");
  }
  if (application.idpServices.length > 1) {
    throw new Error(
      "Multiple IdP services found; cannot determine which to use for executor trigger",
    );
  }
  return application.idpServices[0].name;
}

function resolveAuthNamespace(application: Readonly<Application>): string {
  if (!application.authService) {
    throw new Error("No Auth service configured");
  }
  return application.authService.parsedConfig.name;
}

function protoExecutor(
  application: Readonly<Application>,
  executor: Executor,
): MessageInitShape<typeof ExecutorExecutorSchema> {
  const appName = application.name;
  const env = application.env;
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
          namespaceName: resolveTailorDBNamespace(application, trigger.typeName),
          typeName: trigger.typeName,
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
          namespaceName: resolveResolverNamespace(application, trigger.resolverName),
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
          value: {},
        },
      };
      break;
    case "idpUser":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "idp",
        value: {
          eventTypes: trigger.events,
          namespaceName: resolveIdpNamespace(application),
        },
      });
      break;
    case "authAccessToken":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = typedEventTrigger({
        case: "auth",
        value: {
          eventTypes: trigger.events,
          namespaceName: resolveAuthNamespace(application),
        },
      });
      break;
    default:
      throw new Error(`Unknown trigger: ${trigger satisfies never}`);
  }

  const target = executor.operation;
  let targetType: ExecutorTargetType;
  let targetConfig: MessageInitShape<typeof ExecutorTargetConfigSchema>;

  const authNamespace = application.authService?.parsedConfig.name;
  const invokerContext = `Executor "${executor.name}"`;

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
            appName: target.appName ?? appName,
            query: target.query,
            variables: target.variables
              ? {
                  expr: `(${stringifyFunction(target.variables)})(${argsExpr})`,
                }
              : undefined,
            invoker: normalizeAuthInvoker(target.authInvoker, authNamespace, invokerContext),
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
            invoker: normalizeAuthInvoker(target.authInvoker, authNamespace, invokerContext),
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
            variables: target.args
              ? typeof target.args === "function"
                ? { expr: `(${stringifyFunction(target.args)})(${argsExpr})` }
                : { expr: JSON.stringify(target.args) }
              : undefined,
            invoker: normalizeAuthInvoker(target.authInvoker, authNamespace, invokerContext),
          },
        },
      };
      break;
    }
    default:
      throw new Error(`Unknown target: ${target satisfies never}`);
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
