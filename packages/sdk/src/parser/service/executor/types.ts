import type { JsonValue } from "#/types/helpers";

// Workflow argument callbacks can use any callable signature.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type WorkflowOperationFunction = Function;

export type WorkflowOperation = {
  kind: "workflow";
  workflowName: string;
  args?: Exclude<JsonValue, null> | WorkflowOperationFunction | undefined;
  invoker?: string | { namespace: string; machineUserName: string } | undefined;
};
