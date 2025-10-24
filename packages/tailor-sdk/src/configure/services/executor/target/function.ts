import { type FunctionTarget } from "../types";

export function executorFunction<A>({
  name,
  fn,
  jobFunction,
  invoker,
}: {
  name: string;
  fn: (args: A) => void | Promise<void>;
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
  };
}
