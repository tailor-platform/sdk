import { SqlClient } from "@/services/pipeline";
import { FunctionOperation, ManifestAndContext } from "../types";

type FunctionOperationContext<A> = {
  args: A;
  fn: (args: A & { client: SqlClient }) => void;
  dbNamespace?: string;
};

type FunctionOperationWithManifestAndContext<A> = ManifestAndContext<
  FunctionOperation,
  FunctionOperationContext<A>
>;

export function executorFunction<A, V = A>({
  name,
  fn,
  variables,
  dbNamespace,
  jobFunction,
  invoker,
}: {
  name: string;
  fn: (args: V & { client: SqlClient }) => void;
  variables?: (args: A) => V;
  dbNamespace?: string;
  jobFunction?: boolean;
  invoker?: { authName: string; machineUser: string };
}): FunctionOperationWithManifestAndContext<V> {
  const argStr = "({ ...args, appNamespace: args.namespaceName })";
  return {
    manifest: {
      Kind: jobFunction ? "job_function" : "function",
      Name: name,
      Variables: {
        Expr: variables ? `(${variables.toString()})${argStr}` : argStr,
      },
      Invoker: invoker
        ? {
            AuthNamespace: invoker.authName,
            MachineUserName: invoker.machineUser,
          }
        : undefined,
    },
    context: {
      args: {} as V,
      fn,
      dbNamespace,
    },
  };
}
