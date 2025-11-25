import { describe, it, expect } from "vitest";
import { collectJobNamesFromWorkflow } from "./workflow";
import type { Workflow } from "@/parser/service/workflow";

describe("workflow apply service", () => {
  describe("collectJobNamesFromWorkflow", () => {
    it("should collect main job name", () => {
      const workflow: Workflow = {
        name: "simple-workflow",
        mainJob: {
          name: "main-job",
          body: () => "result",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(1);
      expect(jobNames.has("main-job")).toBe(true);
    });

    it("should collect all dependent job names", () => {
      const depJob1 = {
        name: "dep-job-1",
        body: () => "dep1",
      };

      const depJob2 = {
        name: "dep-job-2",
        body: () => "dep2",
      };

      const workflow: Workflow = {
        name: "workflow-with-deps",
        mainJob: {
          name: "main-job",
          deps: [depJob1, depJob2],
          body: () => "main",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(3);
      expect(jobNames.has("main-job")).toBe(true);
      expect(jobNames.has("dep-job-1")).toBe(true);
      expect(jobNames.has("dep-job-2")).toBe(true);
    });

    it("should collect nested dependencies recursively", () => {
      const leafJob = {
        name: "leaf-job",
        body: () => "leaf",
      };

      const middleJob = {
        name: "middle-job",
        deps: [leafJob],
        body: () => "middle",
      };

      const workflow: Workflow = {
        name: "nested-workflow",
        mainJob: {
          name: "root-job",
          deps: [middleJob],
          body: () => "root",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(3);
      expect(jobNames.has("root-job")).toBe(true);
      expect(jobNames.has("middle-job")).toBe(true);
      expect(jobNames.has("leaf-job")).toBe(true);
    });

    it("should handle circular dependencies without infinite loop", () => {
      // Create jobs with circular reference
      const jobA: any = {
        name: "job-a",
        body: () => "a",
      };

      const jobB: any = {
        name: "job-b",
        deps: [jobA],
        body: () => "b",
      };

      // Create circular reference: A depends on B which depends on A
      jobA.deps = [jobB];

      const workflow: Workflow = {
        name: "circular-workflow",
        mainJob: jobA,
      };

      // This should not hang or throw
      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(2);
      expect(jobNames.has("job-a")).toBe(true);
      expect(jobNames.has("job-b")).toBe(true);
    });

    it("should handle shared dependencies (diamond pattern)", () => {
      const sharedJob = {
        name: "shared-job",
        body: () => "shared",
      };

      const branchA = {
        name: "branch-a",
        deps: [sharedJob],
        body: () => "a",
      };

      const branchB = {
        name: "branch-b",
        deps: [sharedJob],
        body: () => "b",
      };

      const workflow: Workflow = {
        name: "diamond-workflow",
        mainJob: {
          name: "main-job",
          deps: [branchA, branchB],
          body: () => "main",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      // shared-job should only appear once
      expect(jobNames.size).toBe(4);
      expect(jobNames.has("main-job")).toBe(true);
      expect(jobNames.has("branch-a")).toBe(true);
      expect(jobNames.has("branch-b")).toBe(true);
      expect(jobNames.has("shared-job")).toBe(true);
    });

    it("should handle jobs with empty deps array", () => {
      const workflow: Workflow = {
        name: "empty-deps-workflow",
        mainJob: {
          name: "main-job",
          deps: [],
          body: () => "main",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(1);
      expect(jobNames.has("main-job")).toBe(true);
    });

    it("should handle jobs with undefined deps", () => {
      const workflow: Workflow = {
        name: "undefined-deps-workflow",
        mainJob: {
          name: "main-job",
          body: () => "main",
        },
      };

      const jobNames = collectJobNamesFromWorkflow(workflow);

      expect(jobNames.size).toBe(1);
      expect(jobNames.has("main-job")).toBe(true);
    });
  });
});
