import { describe, expect, test } from "vitest";
import {
  filterByMetadataWithName,
  filterUniqueNamesByMetadata,
  jobFunctionTrn,
  workflowTrn,
} from "./metadata";
import { createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();

  describe("workflows", () => {
    test("workflow applied", async () => {
      const { workflows } = await client.listWorkflows({ workspaceId });
      const ownedWorkflows = await filterByMetadataWithName(client, workflows, workflowTrn);

      // There are 2 workflows defined in example/workflows
      expect(ownedWorkflows.length).toBe(2);

      // Verify order-processing workflow
      const orderProcessing = ownedWorkflows.find((w) => w.name === "order-processing");
      expect(orderProcessing).toBeDefined();
      expect(orderProcessing).toMatchObject({
        name: "order-processing",
        mainJobFunctionName: "process-order",
      });
      // Verify job functions are registered
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain("process-order");
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain("fetch-customer");
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain("send-notification");

      // Verify sample-workflow
      const sampleWorkflow = ownedWorkflows.find((w) => w.name === "sample-workflow");
      expect(sampleWorkflow).toBeDefined();
      expect(sampleWorkflow).toMatchObject({
        name: "sample-workflow",
        mainJobFunctionName: "validate-order",
      });
      // Verify job functions are registered
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain("validate-order");
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain("check-inventory");
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain("process-payment");
    });
  });

  describe("workflow job functions", () => {
    test("job functions applied", async () => {
      const { jobFunctions } = await client.listWorkflowJobFunctions({
        workspaceId,
      });

      // Get unique job function names and filter by metadata
      const jobNames = jobFunctions.map((j) => j.name);
      const ownedJobNames = await filterUniqueNamesByMetadata(client, jobNames, jobFunctionTrn);

      // There are exactly 6 job functions used by the 2 workflows
      expect(ownedJobNames).toHaveLength(6);

      // Jobs from order-processing workflow
      expect(ownedJobNames).toContain("process-order");
      expect(ownedJobNames).toContain("fetch-customer");
      expect(ownedJobNames).toContain("send-notification");

      // Jobs from sample-workflow
      expect(ownedJobNames).toContain("validate-order");
      expect(ownedJobNames).toContain("check-inventory");
      expect(ownedJobNames).toContain("process-payment");
    });

    test("job function script is bundled", async () => {
      const { jobFunctions } = await client.listWorkflowJobFunctions({
        workspaceId,
      });

      // Get unique job function names and filter by metadata
      const jobNames = jobFunctions.map((j) => j.name);
      const ownedJobNames = await filterUniqueNamesByMetadata(client, jobNames, jobFunctionTrn);

      // Get one job function per owned name (for script verification)
      const ownedJobFunctions = ownedJobNames.map((name) =>
        jobFunctions.find((j) => j.name === name),
      );

      // Verify each owned job function has a non-empty script
      for (const jobFunction of ownedJobFunctions) {
        expect(jobFunction?.script).toBeTruthy();
        expect(jobFunction?.script?.length).toBeGreaterThan(0);
      }

      // Verify specific job function content
      const fetchCustomer = ownedJobFunctions.find((j) => j?.name === "fetch-customer");
      expect(fetchCustomer).toBeDefined();
      expect(fetchCustomer?.script).toBeTruthy();

      const sendNotification = ownedJobFunctions.find((j) => j?.name === "send-notification");
      expect(sendNotification).toBeDefined();
      expect(sendNotification?.script).toBeTruthy();
    });

    test("job function script contains env variables", async () => {
      // Get the job function by name (returns the latest version)
      const { jobFunction } = await client.getWorkflowJobFunctionByName({
        workspaceId,
        jobFunctionName: "process-order",
      });

      expect(jobFunction).toBeDefined();
      expect(jobFunction?.script).toBeTruthy();

      // Verify that env variables from tailor.config.ts are embedded in the script
      // The config has: env: { foo: 1, bar: "hello", baz: true }
      // After minification, the format may vary (e.g., foo:1 or "foo":1)
      expect(jobFunction?.script).toMatch(/foo[`"']?:1/);
      expect(jobFunction?.script).toMatch(/bar[`"']?:[`"']?hello[`"']?/);
      expect(jobFunction?.script).toMatch(/baz[`"']?:!0|baz[`"']?:true/);
    });
  });
});
