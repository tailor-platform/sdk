import { describe, expect, test } from "vitest";
import {
  createRunId,
  readWorkflowRunMarker,
  runIdStartedAt,
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
  test("marks a whole-file run with the run key", () => {
    expect(workflowRunLabels({ kind: "script", runId: "r1" })).toEqual({
      "sdk-workflow-run": "r1",
    });
  });

  test("marks a single-job run with the job key only", () => {
    expect(workflowRunLabels({ kind: "job", runId: "r1" })).toEqual({
      "sdk-workflow-run-job": "r1",
    });
  });

  test("never carries an owner label, so a deploy does not treat the resource as an orphan of its app", () => {
    for (const kind of ["script", "job"] as const) {
      const keys = Object.keys(workflowRunLabels({ kind, runId: "r1" }));
      expect(keys.filter((key) => key === "sdk-name" || key === "sdk-app-id")).toEqual([]);
    }
  });
});

describe("readWorkflowRunMarker", () => {
  test("reads the kind and run id back from the labels it wrote", () => {
    for (const kind of ["script", "job"] as const) {
      const labels = workflowRunLabels({ kind, runId: "r42" });
      expect(readWorkflowRunMarker(labels)).toEqual({ kind, runId: "r42" });
    }
  });

  test("matches keys exactly: the job key starts with the run key but is not a run", () => {
    expect(readWorkflowRunMarker({ "sdk-workflow-run-job": "r1" })).toEqual({
      kind: "job",
      runId: "r1",
    });
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
