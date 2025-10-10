import { type SqlClient } from "@/configure/services/pipeline";
import { type FunctionTarget } from "../types";

export function executorFunction<A>({
  name,
  fn,
  dbNamespace,
  jobFunction,
  invoker,
}: {
  name: string;
  fn: (args: A & { client: SqlClient }) => void | Promise<void>;
  dbNamespace?: string;
  jobFunction?: boolean;
  invoker?: { authName: string; machineUser: string };
}): FunctionTarget {
  const argStr = "({ ...args, appNamespace: args.namespaceName })";
  return {
    Kind: jobFunction ? "job_function" : "function",
    Name: name,
    Variables: argStr,
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
