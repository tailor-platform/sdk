import { executorFunction } from "./target/function";
import { executorGql } from "./target/gql";
import { executorWebhook } from "./target/webhook";
import { type Executor, type TriggerWithArgs } from "./types";

export function createExecutor(
  name: string,
  description?: string,
  options?: { disabled?: boolean },
): ReturnType<typeof createExecutorImpl>;
export function createExecutor(
  name: string,
  options: { disabled?: boolean },
): ReturnType<typeof createExecutorImpl>;
export function createExecutor(
  name: string,
  descriptionOrOptions?: string | { disabled?: boolean },
  options?: { disabled?: boolean },
) {
  let description: string | undefined;
  let finalOptions: { disabled?: boolean } | undefined;

  if (typeof descriptionOrOptions === "string") {
    description = descriptionOrOptions;
    finalOptions = options;
  } else {
    description = undefined;
    finalOptions = descriptionOrOptions;
  }

  return createExecutorImpl(name, description, finalOptions);
}

function createExecutorImpl(
  name: string,
  description: string | undefined,
  options: { disabled?: boolean } | undefined,
) {
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
          disabled: options?.disabled,
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
          disabled: options?.disabled,
        };
      },

      executeGql: (args: Parameters<typeof executorGql<Args>>[0]): Executor => {
        const exec = executorGql(args);
        return {
          name,
          description,
          trigger,
          exec,
          disabled: options?.disabled,
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
          disabled: options?.disabled,
        };
      },
    }),
  };
}
