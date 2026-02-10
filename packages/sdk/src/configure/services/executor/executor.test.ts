import { describe, expect, expectTypeOf, test } from "vitest";
import { t } from "@/configure/types";
import { createResolver } from "../resolver";
import { db } from "../tailordb";
import { createWorkflow, createWorkflowJob } from "../workflow";
import { createExecutor } from "./executor";
import {
  recordCreatedTrigger,
  recordDeletedTrigger,
  recordUpdatedTrigger,
  resolverExecutedTrigger,
} from "./trigger/event";
import { scheduleTrigger } from "./trigger/schedule";
import { incomingWebhookTrigger } from "./trigger/webhook";

describe("createExecutor", () => {
  test("can disable executor", () => {
    const disabled = createExecutor({
      name: "test-executor",
      description: "A test executor",
      disabled: true,
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: () => {},
      },
    });
    expect(disabled.description).toBe("A test executor");
    expect(disabled.disabled).toBe(true);

    const disabledWithoutDescription = createExecutor({
      name: "test-executor",
      disabled: true,
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: () => {},
      },
    });
    expect(disabledWithoutDescription.description).toBeUndefined();
    expect(disabledWithoutDescription.disabled).toBe(true);

    const enabled = createExecutor({
      name: "test-executor",
      description: "A test executor",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: () => {},
      },
    });
    expect(enabled.description).toBe("A test executor");
    expect(enabled.disabled).toBeUndefined();

    const enabledWithoutDescription = createExecutor({
      name: "test-executor",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: () => {},
      },
    });
    expect(enabledWithoutDescription.description).toBeUndefined();
    expect(enabledWithoutDescription.disabled).toBeUndefined();
  });
});

describe("scheduleTrigger", () => {
  test("can specify valid cron", () => {
    const trigger = scheduleTrigger({
      cron: "* * * * *",
    });
    expect(trigger.cron).toBe("* * * * *");
  });

  test("can not specify invalid cron", () => {
    scheduleTrigger({
      // @ts-expect-error invalid cron
      cron: "* * * *",
    });
  });

  test("can specify timezone", () => {
    const trigger = scheduleTrigger({
      cron: "* * * * *",
      timezone: "Asia/Tokyo",
    });
    expect(trigger.timezone).toBe("Asia/Tokyo");
  });

  test("can not specify invalid timezone", () => {
    scheduleTrigger({
      cron: "* * * * *",
      // @ts-expect-error invalid timezone
      timezone: "Invalid/Timezone",
    });
  });
});

describe("webhookTrigger", () => {
  test("function args include webhook args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            body: Record<string, unknown>;
            headers: Record<string, string>;
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
        },
      },
    });
  });

  test("can narrow webhook args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
        },
      },
    });
  });
});

describe("recordCreatedTrigger", () => {
  test("can omit condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordCreatedTrigger({
      type: user,
    });
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordCreatedTrigger({
      type: user,
      condition: (args) => args.newRecord.age >= 18,
    });
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordCreatedTrigger({
      type: user,
      // @ts-expect-error invalid return type
      condition: () => {
        return "invalid";
      },
    });
  });

  test("function args include event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor({
      name: "test",
      trigger: recordCreatedTrigger({
        type: user,
        condition: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            newRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
          return true;
        },
      }),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            newRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
        },
      },
    });
  });
});

describe("recordUpdatedTrigger", () => {
  test("can omit condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordUpdatedTrigger({
      type: user,
    });
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordUpdatedTrigger({
      type: user,
      condition: (args) => args.oldRecord.age < 18 && args.newRecord.age >= 18,
    });
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordUpdatedTrigger({
      type: user,
      // @ts-expect-error invalid return type
      condition: () => {
        return "invalid";
      },
    });
  });

  test("function args include and event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor({
      name: "test",
      trigger: recordUpdatedTrigger({
        type: user,
        condition: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            newRecord: {
              id: string;
              name: string;
              age: number;
            };
            oldRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
          return true;
        },
      }),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            newRecord: {
              id: string;
              name: string;
              age: number;
            };
            oldRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
        },
      },
    });
  });
});

describe("recordDeletedTrigger", () => {
  test("can omit condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordDeletedTrigger({
      type: user,
    });
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordDeletedTrigger({
      type: user,
      condition: (args) => args.oldRecord.age < 18,
    });
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordDeletedTrigger({
      type: user,
      // @ts-expect-error invalid return type
      condition: () => {
        return "invalid";
      },
    });
  });

  test("function args include event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor({
      name: "test",
      trigger: recordDeletedTrigger({
        type: user,
        condition: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            oldRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
          return true;
        },
      }),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            typeName: string;
            oldRecord: {
              id: string;
              name: string;
              age: number;
            };
          }>();
        },
      },
    });
  });
});

describe("resolverExecutedTrigger", () => {
  test("can omit condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.object({ result: t.bool() }),
    });
    resolverExecutedTrigger({
      resolver,
    });
  });

  test("can specify condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.object({ result: t.bool() }),
    });
    resolverExecutedTrigger({
      resolver,
      condition: (args) => !args.error,
    });
  });

  test("can not return invalid type from condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.object({ result: t.bool() }),
    });
    resolverExecutedTrigger({
      resolver,
      // @ts-expect-error invalid return type
      condition: () => {
        return "invalid";
      },
    });
  });

  test("function args include client and event args with success tag", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.object({ result: t.bool() }),
    });
    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
        condition: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            resolverName: string;
            success: boolean;
          }>();
          return true;
        },
      }),
      operation: {
        kind: "function",
        body: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            resolverName: string;
            success: boolean;
          }>();

          // Test tagged union narrowing with success
          if (args.success) {
            expectTypeOf(args.result).toEqualTypeOf<{ result: boolean }>();
            expectTypeOf(args.error).toEqualTypeOf<undefined>();
          } else {
            expectTypeOf(args.result).toEqualTypeOf<undefined>();
            expectTypeOf(args.error).toEqualTypeOf<string>();
          }
        },
      },
    });
  });

  test("result type is correctly inferred from resolver output (not any)", () => {
    // This test ensures that the result type is correctly inferred from the resolver's output type,
    // preventing regression where result becomes `any` due to type inference issues.
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ data: { items: ["a", "b", "c"] }, count: 3 }),
      output: t.object({
        data: t.object({
          items: t.string({ array: true }),
        }),
        count: t.int(),
      }),
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
      }),
      operation: {
        kind: "function",
        body: (args) => {
          // Verify success is a boolean for tagged union
          expectTypeOf(args.success).toEqualTypeOf<boolean>();

          // Verify exact type structure when success is true
          if (args.success) {
            // result should not be `any` - if it were, this test would pass incorrectly
            expectTypeOf(args.result).not.toBeAny();
            expectTypeOf(args.result.data).not.toBeAny();
            expectTypeOf(args.result.data.items).toEqualTypeOf<string[]>();
            expectTypeOf(args.result.count).toEqualTypeOf<number>();

            // This should cause a type error (property doesn't exist)
            // @ts-expect-error - nonExistent property should not exist
            void args.result.nonExistent;
          } else {
            // error should be string when success is false
            expectTypeOf(args.error).toEqualTypeOf<string>();
          }
        },
      },
    });
  });

  test("result type preserves nested object structure from resolver output", () => {
    const resolver = createResolver({
      name: "nestedOutput",
      operation: "query",
      body: () => ({
        user: {
          profile: {
            name: "John",
            settings: {
              theme: "dark",
            },
          },
        },
      }),
      output: t.object({
        user: t.object({
          profile: t.object({
            name: t.string(),
            settings: t.object({
              theme: t.string(),
            }),
          }),
        }),
      }),
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
      }),
      operation: {
        kind: "function",
        body: (args) => {
          if (args.success) {
            // Deeply nested properties should be correctly typed
            expectTypeOf(args.result.user.profile.name).toEqualTypeOf<string>();
            expectTypeOf(args.result.user.profile.settings.theme).toEqualTypeOf<string>();

            // Invalid property access should fail
            // @ts-expect-error - invalid nested property
            void args.result.user.invalid;
          }
        },
      },
    });
  });

  test("webhook operation also receives correctly typed result", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ id: "123", status: "active" }),
      output: t.object({
        id: t.string(),
        status: t.string(),
      }),
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
      }),
      operation: {
        kind: "webhook",
        url: (args) => {
          // success tag should be available in webhook url function
          expectTypeOf(args.success).toEqualTypeOf<boolean>();
          if (args.success) {
            expectTypeOf(args.result.id).toEqualTypeOf<string>();
            expectTypeOf(args.result.status).toEqualTypeOf<string>();
          }
          return "https://example.com/webhook";
        },
        requestBody: (args) => {
          // success tag should be available in webhook body function
          expectTypeOf(args.success).toEqualTypeOf<boolean>();
          if (args.success) {
            return { data: args.result };
          }
          return { error: args.error };
        },
      },
    });
  });

  test("graphql operation variables receives correctly typed result", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ userId: "user-123" }),
      output: t.object({
        userId: t.string(),
      }),
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
      }),
      operation: {
        kind: "graphql",
        appName: "test-app",
        query: "query { test }",
        variables: (args) => {
          // success tag should be available in graphql variables function
          expectTypeOf(args.success).toEqualTypeOf<boolean>();
          if (args.success) {
            expectTypeOf(args.result.userId).toEqualTypeOf<string>();
            return { id: args.result.userId };
          }
          return { error: args.error };
        },
      },
    });
  });

  test("workflow operation args receives correctly typed result", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ orderId: "order-123", total: 100 }),
      output: t.object({
        orderId: t.string(),
        total: t.int(),
      }),
    });

    const processOrder = createWorkflowJob({
      name: "process-order",
      body: (input: { orderId: string; total: number }) => ({ processed: true, ...input }),
    });

    const workflow = createWorkflow({
      name: "order-workflow",
      mainJob: processOrder,
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
      }),
      operation: {
        kind: "workflow",
        workflow,
        args: (args) => {
          // success tag should be available in workflow args function
          expectTypeOf(args.success).toEqualTypeOf<boolean>();
          if (args.success) {
            expectTypeOf(args.result.orderId).toEqualTypeOf<string>();
            expectTypeOf(args.result.total).toEqualTypeOf<number>();
            return { orderId: args.result.orderId, total: args.result.total };
          }
          return { orderId: "unknown", total: 0 };
        },
      },
    });
  });

  test("condition function can narrow type using success", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ value: 42 }),
      output: t.object({
        value: t.int(),
      }),
    });

    createExecutor({
      name: "test",
      trigger: resolverExecutedTrigger({
        resolver,
        // Condition can use success to filter only successful executions
        condition: (args) => {
          expectTypeOf(args.success).toEqualTypeOf<boolean>();
          // Type narrowing should work in condition
          if (args.success) {
            expectTypeOf(args.result.value).toEqualTypeOf<number>();
            return args.result.value > 0;
          }
          return false;
        },
      }),
      operation: {
        kind: "function",
        body: () => {},
      },
    });
  });
});

describe("functionTarget", () => {
  test("can return void from fn", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: () => {
          return;
        },
      },
    });

    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        body: async () => {
          return;
        },
      },
    });
  });

  test("can not return invalid type from fn", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "function",
        // @ts-expect-error invalid return type
        body: () => {
          return "invalid";
        },
      },
    });
  });

  test("can extract body with type", () => {
    const executor = createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "function",
        body: (_args) => {},
      },
    });

    expectTypeOf(executor.operation.body).parameters.toExtend<
      [
        {
          body: { id: string };
          headers: { "x-custom-header": string };
          method: "POST" | "GET" | "PUT" | "DELETE";
          rawBody: string;
        },
      ]
    >();
  });
});

describe("gqlTarget", () => {
  test("can specify query as string", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "graphql",
        appName: "test-app",
        query: `
          query TestQuery {
            testField
          }
        `,
      },
    });
  });

  test("can specify variables", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "graphql",
        appName: "test-app",
        query: `
          query TestQuery($id: ID!) {
            testField(id: $id)
          }
        `,
        variables: () => ({
          id: "test-id",
        }),
      },
    });
  });

  test("variables receive args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "graphql",
        appName: "test-app",
        query: `
          query TestQuery($id: ID!) {
            testField(id: $id)
          }
        `,
        variables: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
          return {
            id: args.body.id,
          };
        },
      },
    });
  });
});

describe("webhookTarget", () => {
  test("url receive args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "webhook",
        url: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
          return `https://example.com/webhook/${args.body.id}`;
        },
      },
    });
  });

  test("can not return invalid type from url", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "webhook",
        // @ts-expect-error invalid return type
        url: () => {
          return 123;
        },
      },
    });
  });

  test("body receive args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "webhook",
        url: () => "https://example.com/webhook",
        requestBody: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
          return {
            id: args.body.id,
          };
        },
      },
    });
  });

  test("can not return invalid type from requestBody", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "webhook",
        url: () => "https://example.com/webhook",
        // @ts-expect-error invalid return type
        requestBody: () => {
          return 123;
        },
      },
    });
  });

  test("can specify headers", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "webhook",
        url: () => "https://example.com/webhook",
        headers: {
          "Content-Type": "application/json",
          Authorization: { vault: "my-vault", key: "my-secret" },
        },
      },
    });
  });
});

describe("workflowTarget", () => {
  const testJob = createWorkflowJob({
    name: "test-job",
    body: (input: { orderId: string }) => ({ processed: input.orderId }),
  });

  const testWorkflow = createWorkflow({
    name: "test-workflow",
    mainJob: testJob,
  });

  test("can specify workflow target with static args", () => {
    const executor = createExecutor({
      name: "test",
      trigger: scheduleTrigger({ cron: "0 12 * * *" }),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        args: { orderId: "test-id" },
      },
    });
    expect(executor.operation.kind).toBe("workflow");
    expect(executor.operation.workflow.name).toBe("test-workflow");
  });

  test("args can be a function", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: Record<string, string>;
      }>(),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        args: (triggerArgs) => ({ orderId: triggerArgs.body.id }),
      },
    });
  });

  test("args function receives trigger args", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: { "x-custom-header": string };
      }>(),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        args: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
          return { orderId: args.body.id };
        },
      },
    });
  });

  test("args type must match workflow mainJob input", () => {
    createExecutor({
      name: "test",
      trigger: scheduleTrigger({ cron: "0 12 * * *" }),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        // @ts-expect-error - args doesn't match mainJob input type
        args: { wrongField: "value" },
      },
    });
  });

  test("args function must return workflow mainJob input type", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger<{
        body: { id: string };
        headers: Record<string, string>;
      }>(),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        // @ts-expect-error - function return type doesn't match mainJob input
        args: (args) => ({ wrongField: args.body.id }),
      },
    });
  });

  test("can specify authInvoker", () => {
    createExecutor({
      name: "test",
      trigger: scheduleTrigger({ cron: "0 12 * * *" }),
      operation: {
        kind: "workflow",
        workflow: testWorkflow,
        args: { orderId: "test-id" },
        authInvoker: { namespace: "my-auth", machineUserName: "admin" },
      },
    });
  });

  test("can omit args for workflow with undefined input", () => {
    const noInputJob = createWorkflowJob({
      name: "no-input-job",
      body: () => ({ result: "done" }),
    });

    const noInputWorkflow = createWorkflow({
      name: "no-input-workflow",
      mainJob: noInputJob,
    });

    createExecutor({
      name: "test",
      trigger: scheduleTrigger({ cron: "0 12 * * *" }),
      operation: {
        kind: "workflow",
        workflow: noInputWorkflow,
      },
    });
  });
});
