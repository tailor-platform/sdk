import fs from "node:fs";
import path from "node:path";

import { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { getDistDir } from "@/config";
import {
  CreateExecutorExecutorRequestSchema,
  DeleteExecutorExecutorRequestSchema,
  UpdateExecutorExecutorRequestSchema,
} from "@tailor-platform/tailor-proto/executor_pb";
import {
  ExecutorExecutorSchema,
  ExecutorTargetConfigSchema,
  ExecutorTargetType,
  ExecutorTargetWebhookHeaderSchema,
  ExecutorTriggerConfigSchema,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { ApplyOptions } from "@/generator/options";
import { Executor } from "@/services";
import { Workspace } from "@/workspace";
import { ChangeSet } from ".";
import { fetchAll, OperatorClient } from "../client";

export async function applyExecutor(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
  options: ApplyOptions,
) {
  const changeSet = await planExecutor(client, workspaceId, workspace);
  if (options.dryRun) {
    return;
  }

  // Executors
  for (const create of changeSet.creates) {
    await client.createExecutorExecutor(create.request);
  }
  for (const update of changeSet.updates) {
    await client.updateExecutorExecutor(update.request);
  }
  for (const del of changeSet.deletes) {
    await client.deleteExecutorExecutor(del.request);
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

async function planExecutor(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
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

  const executors = (await workspace.executorService?.loadExecutors()) ?? {};
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
  const trigger = executor.trigger.manifest;
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
            eventType: trigger.EventType,
            condition: trigger.Condition
              ? {
                  expr: trigger.Condition.Expr,
                }
              : undefined,
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

  const target = executor.exec.manifest;
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
              expr: target.URL.Expr,
            },
            secret: target.Secret
              ? {
                  vaultName: target.Secret.VaultName,
                  secretKey: target.Secret.SecretKey,
                }
              : undefined,
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
                    vaultName: header.Value?.VaultName,
                    secretKey: header.Value?.SecretKey,
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
                  expr: target.Body.Expr,
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
                  expr: target.Variables.Expr,
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
                  expr: target.Variables.Expr,
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
                  expr: target.Variables.Expr,
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
