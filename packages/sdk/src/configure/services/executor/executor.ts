import type { Operation } from "./operation";
import type { Trigger } from "./trigger";
import type { ExecutorInput } from "@/parser/service/executor/types";

export type Executor<Args, O extends Operation<Args>> = Omit<
  ExecutorInput,
  "trigger" | "operation"
> & {
  trigger: Trigger<Args>;
  operation: O;
};

export function createExecutor<Args, O extends Operation<Args>>(
  config: Executor<Args, O>,
) {
  if (config.operation.kind === "graphql") {
    config.operation.query = config.operation.query.toString();
  }
  return config;
}
