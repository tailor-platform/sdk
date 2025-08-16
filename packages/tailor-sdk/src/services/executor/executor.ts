import { SqlClient } from "../pipeline";
import { executorFunction } from "./target/function";
import { executorGql } from "./target/gql";
import { executorWebhook } from "./target/webhook";
import { Executor, Trigger, ManifestAndContext, TriggerContext } from "./types";

// Helper type to extract args from trigger context
type ExtractTriggerArgs<T> =
  T extends ManifestAndContext<Trigger, infer C>
    ? C extends { args: infer A }
      ? A
      : never
    : never;

export function createExecutor(name: string, description?: string) {
  return {
    on: <TTrigger extends ManifestAndContext<Trigger, TriggerContext>>(
      trigger: TTrigger,
    ) => ({
      executeFunction: <V = ExtractTriggerArgs<TTrigger>>({
        fn,
        variables,
        dbNamespace,
        invoker,
      }: {
        fn: (args: V & { client: SqlClient }) => void;
        variables?: (args: ExtractTriggerArgs<TTrigger>) => V;
        dbNamespace?: string;
        invoker?: { authName: string; machineUser: string };
      }) => {
        const exec = executorFunction({
          name: `${name}__target`,
          fn,
          variables,
          dbNamespace,
          invoker,
        });
        return {
          name,
          description,
          trigger,
          exec,
        } as const satisfies Executor<TTrigger, V>;
      },

      executeJobFunction: <V = ExtractTriggerArgs<TTrigger>>({
        fn,
        variables,
        dbNamespace,
        invoker,
      }: {
        fn: (args: V & { client: SqlClient }) => void;
        variables?: (args: ExtractTriggerArgs<TTrigger>) => V;
        dbNamespace?: string;
        invoker?: { authName: string; machineUser: string };
      }) => {
        const exec = executorFunction({
          name: `${name}__target`,
          fn,
          variables,
          dbNamespace,
          invoker,
          jobFunction: true,
        });
        return {
          name,
          description,
          trigger,
          exec,
        } as const satisfies Executor<TTrigger, V>;
      },

      executeGql: (
        args: Parameters<typeof executorGql<ExtractTriggerArgs<TTrigger>>>[0],
      ) => {
        const exec = executorGql(args);
        return {
          name,
          description,
          trigger,
          exec,
        } as const satisfies Executor<TTrigger>;
      },

      executeWebhook: (
        args: Parameters<
          typeof executorWebhook<ExtractTriggerArgs<TTrigger>>
        >[0],
      ) => {
        const exec = executorWebhook(args);
        return {
          name,
          description,
          trigger,
          exec,
        } as const satisfies Executor<TTrigger>;
      },
    }),
  };
}
