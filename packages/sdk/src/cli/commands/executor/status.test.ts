import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { describe, expect, test } from "vitest";
import { isFunctionExecutionTerminalStatus } from "./status";

describe("isFunctionExecutionTerminalStatus", () => {
  test.each([
    [FunctionExecution_Status.SUCCESS, true],
    [FunctionExecution_Status.FAILED, true],
    [FunctionExecution_Status.CANCELED, true],
    [FunctionExecution_Status.UNSPECIFIED, false],
    [FunctionExecution_Status.RUNNING, false],
    [FunctionExecution_Status.SUSPEND, false],
    [FunctionExecution_Status.CANCELING, false],
  ])("classifies %s as terminal=%s", (status, expected) => {
    expect(isFunctionExecutionTerminalStatus(status)).toBe(expected);
  });
});
