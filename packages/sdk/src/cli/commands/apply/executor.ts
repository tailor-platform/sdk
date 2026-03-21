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
  ExecutorTriggerType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { buildExecutorArgsExpr } from "@/cli/shared/runtime-args";
import { stringifyFunction } from "@/parser/service/tailordb";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual, normalizeProtoConfig } from "./compare";
import { executorFunctionName } from "./function-registry";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/apply/apply";
import type { Executor, Trigger } from "@/types/executor.generated";
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
      };
    }),
  );

  const executors = forRemoval ? {} : ((await application.executorService?.loadExecutors()) ?? {});
  for (const executor of Object.values(executors)) {
    const existing = existingExecutors[executor.name];
    const metaRequest = await buildMetaRequest(trn(workspaceId, executor.name), application.name);
    const desiredExecutor = protoExecutor(application.name, executor, application.env);
    const normalizedDesiredExecutor = normalizeComparableExecutor(desiredExecutor);
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
        areNormalizedEqual(
          normalizeComparableExecutor(existing.resource),
          normalizedDesiredExecutor,
        )
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
  return {
    name: normalized.name,
    description: normalized.description ?? "",
    disabled: normalized.disabled ?? false,
    triggerType: normalized.triggerType,
    triggerConfig:
      normalized.triggerConfig?.config?.case === "incomingWebhook"
        ? {
            ...normalized.triggerConfig,
            config: {
              ...normalized.triggerConfig.config,
              value: {},
            },
          }
        : normalized.triggerConfig,
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

function protoExecutor(
  appName: string,
  executor: Executor,
  env: Record<string, string | number | boolean>,
): MessageInitShape<typeof ExecutorExecutorSchema> {
  const trigger = executor.trigger;
  let triggerType: ExecutorTriggerType;
  let triggerConfig: MessageInitShape<typeof ExecutorTriggerConfigSchema>;

  const argsExpr = buildExecutorArgsExpr(trigger.kind, env);

  const eventType: { [key in Trigger["kind"]]?: string } = {
    recordCreated: "tailordb.type_record.created",
    recordUpdated: "tailordb.type_record.updated",
    recordDeleted: "tailordb.type_record.deleted",
    resolverExecuted: "pipeline.resolver.executed",
    idpUserCreated: "idp.user.created",
    idpUserUpdated: "idp.user.updated",
    idpUserDeleted: "idp.user.deleted",
    authAccessTokenIssued: "auth.access_token.issued",
    authAccessTokenRefreshed: "auth.access_token.refreshed",
    authAccessTokenRevoked: "auth.access_token.revoked",
  };
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
    case "recordCreated":
    case "recordUpdated":
    case "recordDeleted":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = {
        config: {
          case: "event",
          value: {
            eventType: eventType[trigger.kind],
            condition: {
              expr: [
                /* js */ `args.typeName === "${trigger.typeName}"`,
                ...(trigger.condition
                  ? [/* js */ `(${stringifyFunction(trigger.condition)})(${argsExpr})`]
                  : []),
              ].join(" && "),
            },
          },
        },
      };
      break;
    case "resolverExecuted":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = {
        config: {
          case: "event",
          value: {
            eventType: eventType[trigger.kind],
            condition: {
              expr: [
                /* js */ `args.resolverName === "${trigger.resolverName}"`,
                ...(trigger.condition
                  ? [/* js */ `(${stringifyFunction(trigger.condition)})(${argsExpr})`]
                  : []),
              ].join(" && "),
            },
          },
        },
      };
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
    case "idpUserCreated":
    case "idpUserUpdated":
    case "idpUserDeleted":
    case "authAccessTokenIssued":
    case "authAccessTokenRefreshed":
    case "authAccessTokenRevoked":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = {
        config: {
          case: "event",
          value: {
            eventType: eventType[trigger.kind],
          },
        },
      };
      break;
    default:
      throw new Error(`Unknown trigger: ${trigger satisfies never}`);
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
            appName: target.appName ?? appName,
            query: target.query,
            variables: target.variables
              ? {
                  expr: `(${stringifyFunction(target.variables)})(${argsExpr})`,
                }
              : undefined,
            invoker: target.authInvoker ?? undefined,
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
            invoker: target.authInvoker ?? undefined,
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
            invoker: target.authInvoker ?? undefined,
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
