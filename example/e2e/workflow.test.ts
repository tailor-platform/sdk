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

      // There are 4 workflows defined in example/workflows
      expect(ownedWorkflows.length).toBe(4);

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

      // Verify approval-workflow
      const approvalWorkflow = ownedWorkflows.find((w) => w.name === "approval-workflow");
      expect(approvalWorkflow).toBeDefined();
      expect(approvalWorkflow).toMatchObject({
        name: "approval-workflow",
        mainJobFunctionName: "process-with-approval",
      });
      expect(Object.keys(approvalWorkflow?.jobFunctions ?? {})).toContain("process-with-approval");

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

      // Verify audit-workflow
      const auditWorkflow = ownedWorkflows.find((w) => w.name === "audit-workflow");
      expect(auditWorkflow).toBeDefined();
      expect(auditWorkflow).toMatchObject({
        name: "audit-workflow",
        mainJobFunctionName: "record-audit",
      });
    });

    test("execution events stay off for a disabled subscriber", async () => {
      const { workflows } = await client.listWorkflows({ workspaceId });
      const ownedWorkflows = await filterByMetadataWithName(client, workflows, workflowTrn);

      // The only executor with a workflow execution trigger is disabled, so
      // nothing needs audit-workflow's execution events.
      const auditWorkflow = ownedWorkflows.find((w) => w.name === "audit-workflow");
      expect(auditWorkflow?.publishExecutionEvents).toBe(false);

      // A workflow's jobs carry their own value, driven by job execution
      // triggers. No executor carries one, disabled or otherwise.
      const { jobFunctions } = await client.listWorkflowJobFunctions({ workspaceId });
      const recordAudit = jobFunctions.find((j) => j.name === "record-audit");
      expect(recordAudit?.publishExecutionEvents).toBe(false);
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

      // There are exactly 8 job functions used by the 4 workflows
      expect(ownedJobNames).toHaveLength(8);

      // Jobs from order-processing workflow
      expect(ownedJobNames).toContain("process-order");
      expect(ownedJobNames).toContain("fetch-customer");
      expect(ownedJobNames).toContain("send-notification");

      // Job from approval-workflow
      expect(ownedJobNames).toContain("process-with-approval");

      // Jobs from sample-workflow
      expect(ownedJobNames).toContain("validate-order");
      expect(ownedJobNames).toContain("check-inventory");
      expect(ownedJobNames).toContain("process-payment");

      // Job from audit-workflow
      expect(ownedJobNames).toContain("record-audit");
    });

    test("job function scripts are stored in function registry", async () => {
      const { jobFunctions } = await client.listWorkflowJobFunctions({
        workspaceId,
      });

      // Get unique job function names and filter by metadata
      const jobNames = jobFunctions.map((j) => j.name);
      const ownedJobNames = await filterUniqueNamesByMetadata(client, jobNames, jobFunctionTrn);

      // Verify each owned job function has a corresponding function registry entry
      const { functions } = await client.listFunctionRegistries({ workspaceId });
      for (const jobName of ownedJobNames) {
        const registryEntry = functions.find((f) => f.name === `workflow--${jobName}`);
        expect(registryEntry, `Function registry entry for ${jobName}`).toBeDefined();
        expect(registryEntry?.contentHash).toBeTruthy();
      }
    });

    test("job function scripts are registered in function registry", async () => {
      // Verify function registry contains the workflow job scripts
      const { functions } = await client.listFunctionRegistries({
        workspaceId,
      });

      const workflowJobFunctions = functions.filter((f) => f.name.startsWith("workflow--"));

      // There are 8 workflow job functions
      expect(workflowJobFunctions).toHaveLength(8);

      // Verify specific job functions exist with non-empty content hashes
      const processOrder = workflowJobFunctions.find((f) => f.name === "workflow--process-order");
      expect(processOrder).toBeDefined();
      expect(processOrder?.contentHash).toBeTruthy();
    });
  });
});
