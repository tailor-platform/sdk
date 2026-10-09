import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test } from "vitest";
import { parseProtoEnumName, protoEnumLookup, protoEnumName, protoEnumNames } from "./proto-enum";

describe("protoEnumName", () => {
  test("returns the member name of a proto enum value", () => {
    expect(protoEnumName(WorkflowExecution_Status, WorkflowExecution_Status.PENDING_RESUME)).toBe(
      "PENDING_RESUME",
    );
  });

  test("returns the member name of the zero value", () => {
    expect(protoEnumName(WorkflowExecution_Status, WorkflowExecution_Status.UNSPECIFIED)).toBe(
      "UNSPECIFIED",
    );
  });

  test("returns undefined for a value the enum does not define", () => {
    expect(protoEnumName(WorkflowExecution_Status, 9999)).toBeUndefined();
  });
});

describe("protoEnumNames", () => {
  test("lists every member name and no numeric keys", () => {
    expect(protoEnumNames(WorkflowExecution_Status)).toEqual([
      "UNSPECIFIED",
      "PENDING",
      "PENDING_RESUME",
      "RUNNING",
      "SUCCESS",
      "FAILED",
      "PENDING_RETRY",
      "WAITING",
      "CANCELED",
    ]);
  });
});

describe("parseProtoEnumName", () => {
  test("parses a member name case-insensitively", () => {
    expect(parseProtoEnumName(WorkflowExecution_Status, "pending_resume")).toBe(
      WorkflowExecution_Status.PENDING_RESUME,
    );
  });

  test("returns undefined for an unknown name", () => {
    expect(parseProtoEnumName(WorkflowExecution_Status, "nope")).toBeUndefined();
  });

  test("does not read the numeric reverse mapping", () => {
    expect(parseProtoEnumName(WorkflowExecution_Status, "1")).toBeUndefined();
  });

  test("returns undefined for an excluded member", () => {
    expect(
      parseProtoEnumName(WorkflowExecution_Status, "unspecified", [
        WorkflowExecution_Status.UNSPECIFIED,
      ]),
    ).toBeUndefined();
  });
});

describe("protoEnumLookup", () => {
  const labels = {
    [WorkflowExecution_Status.UNSPECIFIED]: "none",
    [WorkflowExecution_Status.PENDING]: "pending",
    [WorkflowExecution_Status.PENDING_RESUME]: "pending-resume",
    [WorkflowExecution_Status.RUNNING]: "running",
    [WorkflowExecution_Status.SUCCESS]: "success",
    [WorkflowExecution_Status.FAILED]: "failed",
    [WorkflowExecution_Status.PENDING_RETRY]: "pending-retry",
    [WorkflowExecution_Status.WAITING]: "waiting",
    [WorkflowExecution_Status.CANCELED]: "canceled",
  } satisfies Record<WorkflowExecution_Status, string>;

  test("returns the mapped value of a known member", () => {
    expect(protoEnumLookup(labels, WorkflowExecution_Status.SUCCESS, "?")).toBe("success");
  });

  test("returns the fallback for a value the map does not cover", () => {
    expect(protoEnumLookup(labels, 9999 as WorkflowExecution_Status, "?")).toBe("?");
  });

  test("keeps a mapped value that is undefined instead of returning the fallback", () => {
    const optional = {
      [WorkflowExecution_Status.UNSPECIFIED]: undefined,
      [WorkflowExecution_Status.PENDING]: "pending",
      [WorkflowExecution_Status.PENDING_RESUME]: "pending-resume",
      [WorkflowExecution_Status.RUNNING]: "running",
      [WorkflowExecution_Status.SUCCESS]: "success",
      [WorkflowExecution_Status.FAILED]: "failed",
      [WorkflowExecution_Status.PENDING_RETRY]: "pending-retry",
      [WorkflowExecution_Status.WAITING]: "waiting",
      [WorkflowExecution_Status.CANCELED]: "canceled",
    } satisfies Record<WorkflowExecution_Status, string | undefined>;
    expect(
      protoEnumLookup<WorkflowExecution_Status, string | undefined>(
        optional,
        WorkflowExecution_Status.UNSPECIFIED,
        "fallback",
      ),
    ).toBeUndefined();
  });

  test("keeps a mapped value that is null instead of returning the fallback", () => {
    const nullable = { [WorkflowExecution_Status.UNSPECIFIED]: null } as Record<
      WorkflowExecution_Status,
      string | null
    >;
    expect(protoEnumLookup(nullable, WorkflowExecution_Status.UNSPECIFIED, "fallback")).toBeNull();
  });
});
