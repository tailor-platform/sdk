import { describe, expect, expectTypeOf, test } from "vitest";
import { t } from "@/configure/types";
import { createResolver } from "../resolver";
import { db } from "../tailordb";
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

  test("function args include client and event args", () => {
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
            result: { result: boolean } | undefined;
            error: string | undefined;
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
            result: { result: boolean } | undefined;
            error: string | undefined;
          }>();
        },
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
        body: (args) => {
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

  test("can not return invalid type from body", () => {
    createExecutor({
      name: "test",
      trigger: incomingWebhookTrigger(),
      operation: {
        kind: "webhook",
        url: () => "https://example.com/webhook",
        // @ts-expect-error invalid return type
        body: () => {
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
