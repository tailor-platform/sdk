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

export function executorFunction<A>({
  name,
  fn,
  dbNamespace,
  jobFunction,
  invoker,
}: {
  name: string;
  fn: (args: A & { client: SqlClient }) => void;
  dbNamespace?: string;
  jobFunction?: boolean;
  invoker?: { authName: string; machineUser: string };
}): FunctionOperationWithManifestAndContext<A> {
  return {
    manifest: {
      Kind: jobFunction ? "job_function" : "function",
      Name: name,
      Invoker: invoker
        ? {
            AuthNamespace: invoker.authName,
            MachineUserName: invoker.machineUser,
          }
        : undefined,
    },
    context: {
      args: {} as A,
      fn,
      dbNamespace,
    },
  };
}
