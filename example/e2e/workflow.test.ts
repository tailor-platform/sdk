import { describe, expect, test } from "vitest";
import { createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();

  describe("workflows", () => {
    test("workflow applied", async () => {
      const { workflows } = await client.listWorkflows({ workspaceId });

      // There are 2 workflows defined in example/workflows
      expect(workflows.length).toBe(2);

      // Verify order-processing workflow
      const orderProcessing = workflows.find(
        (w) => w.name === "order-processing",
      );
      expect(orderProcessing).toBeDefined();
      expect(orderProcessing).toMatchObject({
        name: "order-processing",
        mainJobFunctionName: "process-order",
      });
      // Verify job functions are registered
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain(
        "process-order",
      );
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain(
        "fetch-customer",
      );
      expect(Object.keys(orderProcessing?.jobFunctions ?? {})).toContain(
        "send-notification",
      );

      // Verify sample-workflow
      const sampleWorkflow = workflows.find(
        (w) => w.name === "sample-workflow",
      );
      expect(sampleWorkflow).toBeDefined();
      expect(sampleWorkflow).toMatchObject({
        name: "sample-workflow",
        mainJobFunctionName: "validate-order",
      });
      // Verify job functions are registered
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain(
        "validate-order",
      );
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain(
        "check-inventory",
      );
      expect(Object.keys(sampleWorkflow?.jobFunctions ?? {})).toContain(
        "process-payment",
      );
    });
  });

  describe("workflow job functions", () => {
    test("job functions applied", async () => {
      const { jobFunctions } = await client.listWorkflowJobFunctions({
        workspaceId,
      });

      // Verify job functions that are used by workflows are bundled
      const jobNames = jobFunctions.map((j) => j.name);

      // Jobs from order-processing workflow
      expect(jobNames).toContain("process-order");
      expect(jobNames).toContain("fetch-customer");
      expect(jobNames).toContain("send-notification");

      // Jobs from sample-workflow
      expect(jobNames).toContain("validate-order");
      expect(jobNames).toContain("check-inventory");
      expect(jobNames).toContain("process-payment");

      // Jobs NOT used by any workflow should NOT be bundled
      expect(jobNames).not.toContain("generate-report");
      expect(jobNames).not.toContain("archive-data");
    });

    test("job function script is bundled", async () => {
      const { jobFunctions } = await client.listWorkflowJobFunctions({
        workspaceId,
      });

      // Verify each job function has a non-empty script
      for (const jobFunction of jobFunctions) {
        expect(jobFunction.script).toBeTruthy();
        expect(jobFunction.script.length).toBeGreaterThan(0);
      }

      // Verify specific job function content
      const fetchCustomer = jobFunctions.find(
        (j) => j.name === "fetch-customer",
      );
      expect(fetchCustomer).toBeDefined();
      expect(fetchCustomer?.script).toBeTruthy();

      const sendNotification = jobFunctions.find(
        (j) => j.name === "send-notification",
      );
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
