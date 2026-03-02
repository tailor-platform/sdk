import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { startWorkflow } from "@tailor-platform/sdk/cli";
import config from "../tailor.config";
import orderFulfillmentWorkflow from "../src/workflow/order-fulfillment";
import userProfileSyncWorkflow from "../src/workflow/sync-profile";

describe.concurrent("workflow", () => {
  test("order-fulfillment: execute workflow and verify success", { timeout: 120000 }, async () => {
    const { executionId, wait } = await startWorkflow({
      workflow: orderFulfillmentWorkflow,
      authInvoker: config.auth.invoker("admin"),
      arg: { orderId: "order-001", amount: 100 },
    });

    console.log(`[order-fulfillment] Execution ID: ${executionId}`);

    const result = await wait();
    expect(result).toMatchObject({
      workflowName: "order-fulfillment",
      status: "SUCCESS",
    });
  });

  test("user-profile-sync: execute workflow and verify success", { timeout: 120000 }, async () => {
    const uuid = randomUUID();
    const testEmail = `workflow-test-${uuid}@example.com`;

    const { executionId, wait } = await startWorkflow({
      workflow: userProfileSyncWorkflow,
      authInvoker: config.auth.invoker("admin"),
      arg: {
        name: "workflow-test-user",
        email: testEmail,
        age: 25,
      },
    });

    console.log(`[user-profile-sync] Execution ID: ${executionId}`);

    const result = await wait();
    expect(result).toMatchObject({
      workflowName: "user-profile-sync",
      status: "SUCCESS",
    });
  });
});
