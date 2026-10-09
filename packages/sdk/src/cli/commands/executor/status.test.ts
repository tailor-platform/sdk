import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { describe, expect, test } from "vitest";
import { protoEnumNames } from "#/cli/shared/proto-enum";
import {
  classifyExecutorJobStatus,
  executorTargetTypeToString,
  executorTriggerTypeToString,
  parseExecutorJobStatus,
} from "./status";

const EXPECTED_CLASS = {
  UNSPECIFIED: "transient",
  PENDING: "transient",
  RUNNING: "transient",
  SUCCESS: "success",
  FAILED: "failure",
  CANCELED: "failure",
} as const;

describe("classifyExecutorJobStatus", () => {
  test("covers every status the proto defines", () => {
    expect(Object.keys(EXPECTED_CLASS)).toEqual(protoEnumNames(ExecutorJobStatus));
  });

  test.each(Object.entries(EXPECTED_CLASS))("classifies %s as %s", (name, expected) => {
    const status = ExecutorJobStatus[name as keyof typeof EXPECTED_CLASS];
    expect(classifyExecutorJobStatus(status)).toBe(expected);
  });

  test("keeps waiting on a status newer than the stubs", () => {
    expect(classifyExecutorJobStatus(9999 as ExecutorJobStatus)).toBe("transient");
  });
});

describe("parseExecutorJobStatus", () => {
  test("parses a status name case-insensitively", () => {
    expect(parseExecutorJobStatus("success")).toBe(ExecutorJobStatus.SUCCESS);
  });

  test("lists every filterable status in the error", () => {
    expect(() => parseExecutorJobStatus("nope")).toThrow(
      "Invalid status: nope. Valid values: PENDING, RUNNING, SUCCESS, FAILED, CANCELED",
    );
  });

  test("does not accept UNSPECIFIED as a filter", () => {
    expect(() => parseExecutorJobStatus("unspecified")).toThrow("Invalid status: unspecified");
  });
});

describe("executor type names", () => {
  test("names the GraphQL target GRAPHQL", () => {
    expect(executorTargetTypeToString(ExecutorTargetType.TAILOR_GRAPHQL)).toBe("GRAPHQL");
  });

  test("names the other targets after their enum member", () => {
    expect(executorTargetTypeToString(ExecutorTargetType.JOB_FUNCTION)).toBe("JOB_FUNCTION");
    expect(executorTargetTypeToString(ExecutorTargetType.WORKFLOW)).toBe("WORKFLOW");
  });

  test("names a target newer than the stubs UNSPECIFIED", () => {
    expect(executorTargetTypeToString(9999 as ExecutorTargetType)).toBe("UNSPECIFIED");
  });

  test("names the triggers after their enum member", () => {
    expect(executorTriggerTypeToString(ExecutorTriggerType.INCOMING_WEBHOOK)).toBe(
      "INCOMING_WEBHOOK",
    );
  });
});
