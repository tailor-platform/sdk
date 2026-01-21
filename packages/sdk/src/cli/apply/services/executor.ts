import * as fs from "node:fs";
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
import * as path from "pathe";
import { getDistDir } from "@/configure/config";
import { stringifyFunction } from "@/parser/service/tailordb";
import { fetchAll, type OperatorClient } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { ChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Executor, Trigger } from "@/parser/service/executor";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

/**
 * Apply executor-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned executor changes
 * @param [phase] - Apply phase (defaults to "create-update")
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
export async function planExecutor({ client, workspaceId, application, forRemoval }: PlanContext) {
  const changeSet: ChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor> = new ChangeSet(
    "Executors",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { executors, nextPageToken } = await client.listExecutorExecutors({
        workspaceId,
        pageToken,
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

      changeSet.updates.push({
        name: executor.name,
        request: {
          workspaceId,
          executor: protoExecutor(application.name, executor, application.env),
        },
        metaRequest,
      });
      delete existingExecutors[executor.name];
    } else {
      changeSet.creates.push({
        name: executor.name,
        request: {
          workspaceId,
          executor: protoExecutor(application.name, executor, application.env),
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

/**
 * Build args expression for resolverExecuted trigger.
 * Transforms server's succeeded/failed fields to success/result/error fields.
 * @param [additionalFields] - Additional fields to include in the args expression
 * @returns JavaScript expression for resolverExecuted trigger args
 */
function buildResolverExecutedArgsExpr(additionalFields?: string): string {
  const baseFields = `...args, appNamespace: args.namespaceName, success: !!args.succeeded, result: args.succeeded?.result.resolver, error: args.failed?.error`;
  return additionalFields ? `({ ${baseFields}, ${additionalFields} })` : `({ ${baseFields} })`;
}

function protoExecutor(
  appName: string,
  executor: Executor,
  env: Record<string, string | number | boolean>,
): MessageInitShape<typeof ExecutorExecutorSchema> {
  const trigger = executor.trigger;
  let triggerType: ExecutorTriggerType;
  let triggerConfig: MessageInitShape<typeof ExecutorTriggerConfigSchema>;

  // Common args expressions with env
  const envField = `env: ${JSON.stringify(env)}`;
  const baseArgsExpr = `({ ...args, appNamespace: args.namespaceName, ${envField} })`;

  const eventType: { [key in Trigger["kind"]]?: string } = {
    recordCreated: "tailordb.type_record.created",
    recordUpdated: "tailordb.type_record.updated",
    recordDeleted: "tailordb.type_record.deleted",
    resolverExecuted: "pipeline.resolver.executed",
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
                  ? [/* js */ `(${stringifyFunction(trigger.condition)})(${baseArgsExpr})`]
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
                  ? [
                      /* js */ `(${stringifyFunction(trigger.condition)})(${buildResolverExecutedArgsExpr(envField)})`,
                    ]
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
    default:
      throw new Error(`Unknown trigger: ${trigger satisfies never}`);
  }

  const target = executor.operation;
  let targetType: ExecutorTargetType;
  let targetConfig: MessageInitShape<typeof ExecutorTargetConfigSchema>;

  // Build args expression for target operations
  const argsExpr =
    trigger.kind === "resolverExecuted" ? buildResolverExecutedArgsExpr(envField) : baseArgsExpr;

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

      const scriptPath = path.join(getDistDir(), "executors", `${executor.name}.js`);
      const script = fs.readFileSync(scriptPath, "utf-8");

      targetConfig = {
        config: {
          case: "function",
          value: {
            name: `${executor.name}__target`,
            script,
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
