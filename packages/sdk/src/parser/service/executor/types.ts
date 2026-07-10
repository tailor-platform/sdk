import type { JsonValue } from "#/types/helpers";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type WorkflowOperationArgs = Exclude<JsonValue, null> | Function;

export type WorkflowOperation = {
  kind: "workflow";
  workflowName: string;
  args?: WorkflowOperationArgs | undefined;
  invoker?: string | { namespace: string; machineUserName: string } | undefined;
};
