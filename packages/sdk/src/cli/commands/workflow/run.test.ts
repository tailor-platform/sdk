import { describe, expect, test } from "vitest";
import { assertSelectedJob } from "./run";

describe("assertSelectedJob", () => {
  test("accepts the workflow job that was asked for", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: "workflow-job", functionName: "greet" }),
    ).not.toThrow();
  });

  test("accepts a run without --job whatever the file holds", () => {
    expect(() =>
      assertSelectedJob({ job: undefined, functionType: "plain", functionName: "slow" }),
    ).not.toThrow();
  });

  test("rejects --job when the file exports no workflow jobs and would run its main", () => {
    expect(() =>
      assertSelectedJob({ job: "missing", functionType: "plain", functionName: "slow" }),
    ).toThrow(/WORKFLOW_RUN_JOB_NOT_FOUND|Workflow job "missing"/);
  });

  test("rejects --job when a resolver was detected first", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: "resolver", functionName: "add" }),
    ).toThrow(/Workflow job "greet"/);
  });

  test("rejects --job for a pre-bundled file, which has no jobs to choose from", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: undefined, functionName: undefined }),
    ).toThrow(/pre-bundled|\.ts/);
  });
});
