import * as fs from "node:fs";
import * as path from "node:path";

import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { getDistDir } from "@/configure/config";
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
import { type Executor } from "@/configure/services";
import { type Application } from "@/cli/application";
import { ChangeSet } from ".";
import { type ApplyPhase } from "..";
import { fetchAll, type OperatorClient } from "../client";

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
  switch (trigger.Kind) {
    case "Schedule":
      triggerType = ExecutorTriggerType.SCHEDULE;
      triggerConfig = {
        config: {
          case: "schedule",
          value: {
            timezone: trigger.Timezone,
            frequency: trigger.Frequency,
          },
        },
      };
      break;
    case "Event":
      triggerType = ExecutorTriggerType.EVENT;
      triggerConfig = {
        config: {
          case: "event",
          value: {
            eventType: trigger.EventType.kind,
            condition: {
              expr: trigger.Condition,
            },
          },
        },
      };
      break;
    case "IncomingWebhook":
      triggerType = ExecutorTriggerType.INCOMING_WEBHOOK;
      triggerConfig = {
        config: {
          case: "incomingWebhook",
          value: {},
        },
      };
      break;
  }

  const target = executor.exec;
  let targetType: ExecutorTargetType;
  let targetConfig: MessageInitShape<typeof ExecutorTargetConfigSchema>;
  switch (target.Kind) {
    case "webhook": {
      targetType = ExecutorTargetType.WEBHOOK;
      targetConfig = {
        config: {
          case: "webhook",
          value: {
            url: {
              expr: target.URL,
            },
            headers: target.Headers?.map((header) => {
              let value: MessageInitShape<
                typeof ExecutorTargetWebhookHeaderSchema
              >["value"];
              if (typeof header.Value === "string") {
                value = {
                  case: "rawValue",
                  value: header.Value,
                };
              } else {
                value = {
                  case: "secretValue",
                  value: {
                    vaultName: header.Value.VaultName,
                    secretKey: header.Value.SecretKey,
                  },
                };
              }
              return {
                key: header.Key,
                value,
              };
            }),
            body: target.Body
              ? {
                  expr: target.Body,
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
            appName: target.AppName,
            query: target.Query,
            variables: target.Variables
              ? {
                  expr: target.Variables,
                }
              : undefined,
            invoker: target.Invoker
              ? {
                  namespace: target.Invoker.AuthNamespace,
                  machineUserName: target.Invoker.MachineUserName,
                }
              : undefined,
          },
        },
      };
      break;
    case "function": {
      const scriptPath = path.join(
        getDistDir(),
        "executors",
        `${executor.name}.js`,
      );
      const script = fs.readFileSync(scriptPath, "utf-8");
      targetType = ExecutorTargetType.FUNCTION;
      targetConfig = {
        config: {
          case: "function",
          value: {
            name: target.Name,
            script,
            variables: target.Variables
              ? {
                  expr: target.Variables,
                }
              : undefined,
            invoker: target.Invoker
              ? {
                  namespace: target.Invoker.AuthNamespace,
                  machineUserName: target.Invoker.MachineUserName,
                }
              : undefined,
          },
        },
      };
      break;
    }
    case "job_function": {
      const scriptPath = path.join(
        getDistDir(),
        "executors",
        `${executor.name}.js`,
      );
      const script = fs.readFileSync(scriptPath, "utf-8");
      targetType = ExecutorTargetType.JOB_FUNCTION;
      targetConfig = {
        config: {
          case: "function",
          value: {
            name: target.Name,
            script,
            variables: target.Variables
              ? {
                  expr: target.Variables,
                }
              : undefined,
            invoker: target.Invoker
              ? {
                  namespace: target.Invoker.AuthNamespace,
                  machineUserName: target.Invoker.MachineUserName,
                }
              : undefined,
          },
        },
      };
      break;
    }
  }

  return {
    name: executor.name,
    description: executor.description,
    triggerType,
    triggerConfig,
    targetType,
    targetConfig,
  };
}
