import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test } from "vitest";
import { protoEnumNames } from "#/cli/shared/proto-enum";
import {
  classifyWorkflowExecutionStatus,
  isWorkflowExecutionFailureStatus,
  isWorkflowExecutionSuspendedStatus,
} from "./status";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

function execution(status: number, jobStatuses: number[] = []): WorkflowExecution {
  return {
    status,
    jobExecutions: jobStatuses.map((jobStatus) => ({ status: jobStatus })),
  } as unknown as WorkflowExecution;
}

const EXPECTED_CLASS = {
  UNSPECIFIED: "transient",
  PENDING: "transient",
  PENDING_RESUME: "suspended",
  RUNNING: "transient",
  SUCCESS: "success",
  FAILED: "failure",
  PENDING_RETRY: "transient",
  WAITING: "suspended",
  CANCELED: "failure",
} as const;

const EXPECTED_JOB_SUSPENDED = {
  UNSPECIFIED: false,
  RUNNING: false,
  SUSPEND: true,
  SUCCESS: false,
  FAILED: false,
  WAITING: true,
  CANCELED: false,
} as const;

describe("classifyWorkflowExecutionStatus", () => {
  test("covers every status the proto defines", () => {
    expect(Object.keys(EXPECTED_CLASS)).toEqual(protoEnumNames(WorkflowExecution_Status));
  });

  test.each(Object.entries(EXPECTED_CLASS))("classifies %s as %s", (name, expected) => {
    const status = WorkflowExecution_Status[name as keyof typeof EXPECTED_CLASS];
    expect(classifyWorkflowExecutionStatus(execution(status)).statusClass).toBe(expected);
  });

  test("keeps waiting on a status newer than the stubs", () => {
    expect(classifyWorkflowExecutionStatus(execution(9999)).statusClass).toBe("transient");
  });

  test("treats a running execution as suspended while one of its jobs waits", () => {
    const waiting = execution(WorkflowExecution_Status.RUNNING, [
      WorkflowJobExecution_Status.WAITING,
    ]);
    expect(classifyWorkflowExecutionStatus(waiting).statusClass).toBe("suspended");
  });

  test("covers every job status the proto defines", () => {
    expect(Object.keys(EXPECTED_JOB_SUSPENDED)).toEqual(
      protoEnumNames(WorkflowJobExecution_Status),
    );
  });

  test.each(Object.entries(EXPECTED_JOB_SUSPENDED))(
    "treats a job in %s as suspended: %s",
    (name, suspended) => {
      const jobStatus = WorkflowJobExecution_Status[name as keyof typeof EXPECTED_JOB_SUSPENDED];
      const running = execution(WorkflowExecution_Status.RUNNING, [jobStatus]);
      expect(classifyWorkflowExecutionStatus(running).statusClass).toBe(
        suspended ? "suspended" : "transient",
      );
    },
  );

  test("keeps a running execution transient while its jobs run", () => {
    const running = execution(WorkflowExecution_Status.RUNNING, [
      WorkflowJobExecution_Status.RUNNING,
    ]);
    expect(classifyWorkflowExecutionStatus(running).statusClass).toBe("transient");
  });
});

describe("workflow execution status predicates", () => {
  test("flags FAILED and CANCELED as failure", () => {
    expect(isWorkflowExecutionFailureStatus(WorkflowExecution_Status.FAILED)).toBe(true);
    expect(isWorkflowExecutionFailureStatus(WorkflowExecution_Status.CANCELED)).toBe(true);
    expect(isWorkflowExecutionFailureStatus(WorkflowExecution_Status.SUCCESS)).toBe(false);
  });

  test("flags PENDING_RESUME and WAITING as suspended", () => {
    expect(isWorkflowExecutionSuspendedStatus(WorkflowExecution_Status.PENDING_RESUME)).toBe(true);
    expect(isWorkflowExecutionSuspendedStatus(WorkflowExecution_Status.WAITING)).toBe(true);
    expect(isWorkflowExecutionSuspendedStatus(WorkflowExecution_Status.RUNNING)).toBe(false);
  });
});
