import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { startWorkflow } from "@tailor-platform/sdk/cli";
import config from "../tailor.config";
import simpleCalculationWorkflow from "../src/workflow/simple";
import userProfileSyncWorkflow from "../src/workflow/wrapTailordb";

describe.concurrent("workflow", () => {
  test("simple-calculation: execute workflow and verify success", { timeout: 120000 }, async () => {
    const { executionId, wait } = await startWorkflow({
      workflow: simpleCalculationWorkflow,
      authInvoker: config.auth.invoker("admin"),
      arg: { a: 2, b: 3 },
    });

    console.log(`[simple-calculation] Execution ID: ${executionId}`);

    const result = await wait();
    expect(result).toMatchObject({
      workflowName: "simple-calculation",
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
