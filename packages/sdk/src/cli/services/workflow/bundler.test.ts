import { describe, expect, it } from "vitest";
import { bundleWorkflowJobs } from "./bundler";

describe("bundleWorkflowJobs", () => {
  it("does not throw when no workflow jobs are provided", async () => {
    await expect(bundleWorkflowJobs([], [], {})).resolves.toEqual({
      mainJobDeps: {},
      usedJobNames: [],
      bundledCode: new Map(),
    });
  });
});
