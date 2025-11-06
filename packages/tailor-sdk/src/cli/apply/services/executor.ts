import * as fs from "node:fs";
import * as path from "node:path";
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
import { type Application } from "@/cli/application";
import { getDistDir } from "@/configure/config";
import { type ApplyPhase } from "..";
import { fetchAll, type OperatorClient } from "../../client";
import { ChangeSet } from ".";
import type { Executor, Trigger } from "@/parser/service/executor";

export async function applyExecutor(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planExecutor>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Executors
    for (const create of changeSet.creates) {
      await client.createExecutorExecutor(create.request);
    }
    for (const update of changeSet.updates) {
      await client.updateExecutorExecutor(update.request);
    }
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Executors
    for (const del of changeSet.deletes) {
      await client.deleteExecutorExecutor(del.request);
    }
  }
}

type CreateExecutor = {
  name: string;
  request: MessageInitShape<typeof CreateExecutorExecutorRequestSchema>;
};

type UpdateExecutor = {
  name: string;
  request: MessageInitShape<typeof UpdateExecutorExecutorRequestSchema>;
};

type DeleteExecutor = {
  name: string;
  request: MessageInitShape<typeof DeleteExecutorExecutorRequestSchema>;
};

export async function planExecutor(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
) {
  const changeSet: ChangeSet<CreateExecutor, UpdateExecutor, DeleteExecutor> =
    new ChangeSet("Executors");

  const existingExecutors = await fetchAll(async (pageToken) => {
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
  const existingNameSet = new Set<string>();
  existingExecutors.forEach((executor) => {
    existingNameSet.add(executor.name);
  });

  const executors = (await application.executorService?.loadExecutors()) ?? {};
  for (const executor of Object.values(executors)) {
    if (existingNameSet.has(executor.name)) {
      changeSet.updates.push({
        name: executor.name,
        request: {
          workspaceId,
          executor: protoExecutor(executor),
        },
      });
      existingNameSet.delete(executor.name);
    } else {
      changeSet.creates.push({
        name: executor.name,
        request: {
          workspaceId,
          executor: protoExecutor(executor),
        },
      });
    }
  }
  existingNameSet.forEach((name) => {
    changeSet.deletes.push({
      name,
      request: {
        workspaceId,
        name,
      },
    });
  });

  changeSet.print();
  return changeSet;
}

function protoExecutor(
  executor: Executor,
): MessageInitShape<typeof ExecutorExecutorSchema> {
  const trigger = executor.trigger;
  let triggerType: ExecutorTriggerType;
  let triggerConfig: MessageInitShape<typeof ExecutorTriggerConfigSchema>;
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
                  ? [
                      /* js */ `(${trigger.condition.toString()})({ ...args, appNamespace: args.namespaceName })`,
                    ]
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
                      /* js */ `(${trigger.condition.toString()})({ ...args, appNamespace: args.namespaceName, result: args.succeeded?.result, error: args.failed?.error })`,
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
  switch (target.kind) {
    case "webhook": {
      targetType = ExecutorTargetType.WEBHOOK;
      targetConfig = {
        config: {
          case: "webhook",
          value: {
            url: {
              expr: `(${target.url.toString()})(args)`,
            },
            headers: target.headers
              ? Object.entries(target.headers).map(([key, v]) => {
                  let value: MessageInitShape<
                    typeof ExecutorTargetWebhookHeaderSchema
                  >["value"];
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
            body: target.body
              ? {
                  expr: `(${target.body.toString()})(args)`,
                }
              : undefined,
          },
        },
      };
      break;
    }
    case "graphql":
      targetType = ExecutorTargetType.TAILOR_GRAPHQL;
      targetConfig = {
        config: {
          case: "tailorGraphql",
          value: {
            appName: target.appName,
            query: target.query,
            variables: target.variables
              ? {
                  expr: `(${target.variables.toString()})(args)`,
                }
              : undefined,
            invoker: target.invoker
              ? {
                  namespace: target.invoker.authName,
                  machineUserName: target.invoker.machineUser,
                }
              : undefined,
          },
        },
      };
      break;
    case "function":
    case "jobFunction": {
      if (target.kind === "function") {
        targetType = ExecutorTargetType.FUNCTION;
      } else {
        targetType = ExecutorTargetType.JOB_FUNCTION;
      }

      const scriptPath = path.join(
        getDistDir(),
        "executors",
        `${executor.name}.js`,
      );
      const script = fs.readFileSync(scriptPath, "utf-8");
      targetConfig = {
        config: {
          case: "function",
          value: {
            name: `${executor.name}__target`,
            script,
            variables: {
              expr: "({ ...args, appNamespace: args.namespaceName })",
            },
            invoker: target.invoker
              ? {
                  namespace: target.invoker.authName,
                  machineUserName: target.invoker.machineUser,
                }
              : undefined,
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
