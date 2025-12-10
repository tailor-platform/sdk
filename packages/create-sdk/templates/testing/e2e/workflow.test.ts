import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { workflowStart } from "@tailor-platform/sdk/cli";

describe.concurrent("workflow", () => {
  test(
    "simple-calculation: execute workflow and verify success",
    { timeout: 120000 },
    async () => {
      const result = await workflowStart({
        nameOrId: "simple-calculation",
        machineUser: "admin",
        arg: JSON.stringify({ a: 2, b: 3 }),
        wait: true,
        format: "json",
      });

      expect(result).toMatchObject({
        workflowName: "simple-calculation",
        status: "SUCCESS",
      });
    },
  );

  test(
    "user-profile-sync: execute workflow and verify success",
    { timeout: 120000 },
    async () => {
      const uuid = randomUUID();
      const testEmail = `workflow-test-${uuid}@example.com`;

      const result = await workflowStart({
        nameOrId: "user-profile-sync",
        machineUser: "admin",
        arg: JSON.stringify({
          name: "workflow-test-user",
          email: testEmail,
          age: 25,
        }),
        wait: true,
        format: "json",
      });

      expect(result).toMatchObject({
        workflowName: "user-profile-sync",
        status: "SUCCESS",
      });
    },
  );
});
