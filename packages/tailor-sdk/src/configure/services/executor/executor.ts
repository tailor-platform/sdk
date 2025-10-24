import { executorFunction } from "./target/function";
import { executorGql } from "./target/gql";
import { executorWebhook } from "./target/webhook";
import { type Executor, type TriggerWithArgs } from "./types";

export function createExecutor(name: string, description?: string) {
  return {
    on: <Args>(trigger: TriggerWithArgs<Args>) => ({
      executeFunction: ({
        fn,
        invoker,
      }: {
        fn: (args: Args) => void | Promise<void>;
        invoker?: { authName: string; machineUser: string };
      }): Executor => {
        const exec = executorFunction({
          name: `${name}__target`,
          fn,
          invoker,
        });
        return {
          name,
          description,
          trigger,
          exec,
        };
      },

      executeJobFunction: ({
        fn,
        invoker,
      }: {
        fn: (args: Args) => void | Promise<void>;
        invoker?: { authName: string; machineUser: string };
      }): Executor => {
        const exec = executorFunction({
          name: `${name}__target`,
          fn,
          invoker,
          jobFunction: true,
        });
        return {
          name,
          description,
          trigger,
          exec,
        };
      },

      executeGql: (args: Parameters<typeof executorGql<Args>>[0]): Executor => {
        const exec = executorGql(args);
        return {
          name,
          description,
          trigger,
          exec,
        };
      },

      executeWebhook: (
        args: Parameters<typeof executorWebhook<Args>>[0],
      ): Executor => {
        const exec = executorWebhook(args);
        return {
          name,
          description,
          trigger,
          exec,
        };
      },
    }),
  };
}
