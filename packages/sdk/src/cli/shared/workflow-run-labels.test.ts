import { describe, expect, test } from "vitest";
import {
  createRunId,
  createRunIdSuffix,
  functionRunResourceName,
  readWorkflowRunMarker,
  runIdStartedAt,
  isFunctionRunResourceName,
  isTemporaryRunResourceName,
  workflowRunJobFunctionName,
  workflowRunLabels,
  workflowRunResourceName,
} from "./workflow-run-labels";

const LABEL_VALUE = /^[a-z][a-z0-9_-]{0,62}$/;

describe("createRunId", () => {
  test("is a valid label value", () => {
    expect(createRunId(new Date("2026-11-18T13:00:00Z"), "k3j9x2")).toMatch(LABEL_VALUE);
  });

  test("differs for runs started in different seconds", () => {
    const first = createRunId(new Date("2026-11-18T13:00:00Z"), "aaaaaa");
    const second = createRunId(new Date("2026-11-18T13:00:01Z"), "aaaaaa");
    expect(first).not.toBe(second);
  });

  test("sorts by start time so the oldest leftover can be told from the newest", () => {
    const earlier = createRunId(new Date("2026-11-18T13:00:00Z"), "zzzzzz");
    const later = createRunId(new Date("2026-11-18T13:00:01Z"), "aaaaaa");
    expect(earlier < later).toBe(true);
  });
});

describe("workflowRunLabels", () => {
  test("marks a run with the job key", () => {
    expect(workflowRunLabels({ runId: "r1" })).toEqual({
      "sdk-workflow-run-job": "r1",
    });
  });

  test("never carries an owner label, so a deploy does not treat the resource as an orphan of its app", () => {
    const keys = Object.keys(workflowRunLabels({ runId: "r1" }));
    expect(keys.filter((key) => key === "sdk-name" || key === "sdk-app-id")).toEqual([]);
  });
});

describe("readWorkflowRunMarker", () => {
  test("reads the run id back from the labels it wrote", () => {
    expect(readWorkflowRunMarker(workflowRunLabels({ runId: "r42" }))).toEqual({ runId: "r42" });
  });

  test("ignores a key that only starts with the run key", () => {
    expect(readWorkflowRunMarker({ "sdk-workflow-run-other": "r1" })).toBeUndefined();
  });

  test("returns nothing for a resource of a deploy or without labels", () => {
    expect(readWorkflowRunMarker({ "sdk-name": "app" })).toBeUndefined();
    expect(readWorkflowRunMarker(undefined)).toBeUndefined();
  });
});

describe("workflowRunResourceName", () => {
  test("derives a distinct name from the run id", () => {
    expect(workflowRunResourceName("r1")).not.toBe(workflowRunResourceName("r2"));
  });

  test("starts with tmp-run-, the prefix a prune looks for", () => {
    expect(workflowRunResourceName("r1")).toBe("tmp-run-r1");
    expect(isTemporaryRunResourceName("tmp-run-r1")).toBe(true);
    expect(isTemporaryRunResourceName("tmp-fn-r1")).toBe(true);
    expect(isTemporaryRunResourceName("tmp-r1")).toBe(false);
    expect(isTemporaryRunResourceName("validate-order")).toBe(false);
  });
});

describe("workflowRunJobFunctionName", () => {
  test("keeps the job name apart from the names of deployed jobs of the same name", () => {
    expect(workflowRunJobFunctionName("r1", "validate-order")).toBe("tmp-run-r1-validate-order");
  });

  test("differs between runs of the same job", () => {
    expect(workflowRunJobFunctionName("r1", "a")).not.toBe(workflowRunJobFunctionName("r2", "a"));
  });

  describe("for a job name too long to fit the length the Platform accepts", () => {
    const runId = createRunId(new Date("2026-11-18T13:00:00Z"), "aaaaaa");
    const long = (tail: string) => `send-the-quarterly-compliance-report-to-every-${tail}`;
    const PLATFORM_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

    test("is cut to a name the Platform accepts", () => {
      expect(workflowRunJobFunctionName(runId, long("region"))).toMatch(PLATFORM_NAME);
    });

    test("keeps the run's prefix, so a sweep still finds it with the run", () => {
      expect(workflowRunJobFunctionName(runId, long("region"))).toMatch(
        new RegExp(`^${workflowRunResourceName(runId)}-`),
      );
    });

    test("keeps two long names that start alike apart", () => {
      expect(workflowRunJobFunctionName(runId, long("region-a"))).not.toBe(
        workflowRunJobFunctionName(runId, long("region-b")),
      );
    });

    test("gives the same name each time, so registration and the rewritten calls agree", () => {
      expect(workflowRunJobFunctionName(runId, long("region"))).toBe(
        workflowRunJobFunctionName(runId, long("region")),
      );
    });

    test("leaves a name that fits as it is", () => {
      expect(workflowRunJobFunctionName(runId, "validate-order")).toBe(
        `tmp-run-${runId}-validate-order`,
      );
    });
  });
});

describe("runIdStartedAt", () => {
  test("reads back the second the run id was created in", () => {
    const now = new Date("2026-11-18T13:00:07Z");
    expect(runIdStartedAt(createRunId(now, "k3j9x2"))).toEqual(now);
  });

  test("returns nothing for an id this module did not create", () => {
    expect(runIdStartedAt("nightly")).toBeUndefined();
  });
});

describe("functionRunResourceName", () => {
  test("starts with a prefix of its own, which a workflow run's resources do not use", () => {
    const runId = createRunId(new Date(), "c0a100");
    expect(functionRunResourceName(runId)).toBe(`tmp-fn-${runId}`);
    expect(functionRunResourceName(runId)).not.toBe(workflowRunResourceName(runId));
  });
});

describe("isFunctionRunResourceName", () => {
  const runId = createRunId(new Date(), "c0a100");

  test("is true for the name `function run --async` gives its function", () => {
    expect(isFunctionRunResourceName(functionRunResourceName(runId))).toBe(true);
  });

  test("is true for the name a freshly created run id gives its function", () => {
    const fresh = createRunId(new Date(), createRunIdSuffix());
    expect(isFunctionRunResourceName(functionRunResourceName(fresh))).toBe(true);
  });

  test("is false for the resources of a workflow run", () => {
    expect(isFunctionRunResourceName(workflowRunResourceName(runId))).toBe(false);
    expect(isFunctionRunResourceName(workflowRunJobFunctionName(runId, "cleanup"))).toBe(false);
  });

  test("is false for a deployed job that only starts with the prefix", () => {
    expect(isFunctionRunResourceName("tmp-fn-cleanup")).toBe(false);
  });

  test("is false for a deployed job named like a run id with a suffix no run makes", () => {
    expect(isFunctionRunResourceName("tmp-fn-r20261124-backfill")).toBe(false);
  });
});
