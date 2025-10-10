import { type SqlClient } from "@/configure/services/pipeline";
import { type FunctionTarget } from "../types";

export function executorFunction<A, V = A>({
  name,
  fn,
  variables,
  dbNamespace,
  jobFunction,
  invoker,
}: {
  name: string;
  fn: (args: V & { client: SqlClient }) => void | Promise<void>;
  variables?: (args: A) => V;
  dbNamespace?: string;
  jobFunction?: boolean;
  invoker?: { authName: string; machineUser: string };
}): FunctionTarget {
  const argStr = "({ ...args, appNamespace: args.namespaceName })";
  return {
    Kind: jobFunction ? "job_function" : "function",
    Name: name,
    Variables: variables ? `(${variables.toString()})${argStr}` : argStr,
    Invoker: invoker
      ? {
          AuthNamespace: invoker.authName,
          MachineUserName: invoker.machineUser,
        }
      : undefined,
    fn,
    dbNamespace,
  };
}
