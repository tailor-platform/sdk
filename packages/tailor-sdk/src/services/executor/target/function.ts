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

export function executorFunction<A>(
  name: string,
  fn: (args: A & { client: SqlClient }) => void,
  options?: { dbNamespace?: string },
): FunctionOperationWithManifestAndContext<A> {
  return {
    manifest: {
      Kind: "function",
      Name: name,
    },
    context: {
      args: undefined as A,
      fn: fn,
      dbNamespace: options?.dbNamespace,
    },
  };
}
