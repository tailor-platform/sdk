import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { describe, expect, test } from "vitest";
import { functionExecutionStatusToString } from "./function-execution";

describe("functionExecutionStatusToString", () => {
  test.each([
    [FunctionExecution_Status.UNSPECIFIED, "UNSPECIFIED"],
    [FunctionExecution_Status.RUNNING, "RUNNING"],
    [FunctionExecution_Status.SUCCESS, "SUCCESS"],
    [FunctionExecution_Status.FAILED, "FAILED"],
    [FunctionExecution_Status.SUSPEND, "SUSPEND"],
    [FunctionExecution_Status.CANCELING, "CANCELING"],
    [FunctionExecution_Status.CANCELED, "CANCELED"],
  ])("converts %s to %s", (status, expected) => {
    expect(functionExecutionStatusToString(status)).toBe(expected);
  });
});
