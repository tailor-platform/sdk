import { describe, expect, expectTypeOf, test } from "vitest";
import { createExecutor } from "./executor";
import {
  incomingWebhookTrigger,
  recordCreatedTrigger,
  recordDeletedTrigger,
  recordUpdatedTrigger,
  resolverExecutedTrigger,
  scheduleTrigger,
} from "./trigger";
import { createResolver, type SqlClient } from "../pipeline";
import { db } from "../tailordb";
import { t } from "@/configure/types";

describe("scheduleTrigger", () => {
  test("can specify valid cron", () => {
    const trigger = scheduleTrigger("* * * * *");
    expect(trigger.Frequency).toBe("* * * * *");
  });

  test("can not specify invalid cron", () => {
    // @ts-expect-error invalid cron
    scheduleTrigger("* * * *");
  });

  test("default timezone is UTC", () => {
    const trigger = scheduleTrigger("* * * * *");
    expect(trigger.Timezone).toBe("UTC");
  });

  test("can specify timezone", () => {
    const trigger = scheduleTrigger("* * * * *", "Asia/Tokyo");
    expect(trigger.Timezone).toBe("Asia/Tokyo");
  });

  test("can not specify invalid timezone", () => {
    // @ts-expect-error invalid timezone
    scheduleTrigger("* * * * *", "Invalid/Timezone");
  });

  test("function args do not include client when dbNamespace is not set", () => {
    createExecutor("test")
      .on(scheduleTrigger("* * * * *"))
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).not.toExtend<{
            client: SqlClient;
          }>();
        },
      });
  });

  test("function args include client when dbNamespace is set", () => {
    createExecutor("test")
      .on(scheduleTrigger("* * * * *"))
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            client: SqlClient;
          }>();
        },
        dbNamespace: "test-namespace",
      });
  });
});

describe("webhookTrigger", () => {
  test("function args include webhook args", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            body: Record<string, unknown>;
            headers: Record<string, string>;
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
        },
      });
  });

  test("can narrow webhook args", () => {
    createExecutor("test")
      .on(
        incomingWebhookTrigger<{
          body: { id: string };
          headers: { "x-custom-header": string };
        }>(),
      )
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
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
    recordCreatedTrigger(user);
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordCreatedTrigger(user, (args) => args.newRecord.age >= 18);
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    // @ts-expect-error invalid return type
    recordCreatedTrigger(user, () => {
      return "invalid";
    });
  });

  test("function args include event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor("test")
      .on(
        recordCreatedTrigger(user, (args) => {
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
        }),
      )
      .executeFunction({
        fn: (args) => {
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
      });
  });
});

describe("recordUpdatedTrigger", () => {
  test("can omit condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordUpdatedTrigger(user);
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordUpdatedTrigger(
      user,
      (args) => args.oldRecord.age < 18 && args.newRecord.age >= 18,
    );
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    // @ts-expect-error invalid return type
    recordUpdatedTrigger(user, () => {
      return "invalid";
    });
  });

  test("function args include and event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor("test")
      .on(
        recordUpdatedTrigger(user, (args) => {
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
        }),
      )
      .executeFunction({
        fn: (args) => {
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
      });
  });
});

describe("recordDeletedTrigger", () => {
  test("can omit condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordDeletedTrigger(user);
  });

  test("can specify condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    recordDeletedTrigger(user, (args) => args.oldRecord.age < 18);
  });

  test("can not return invalid type from condition", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    // @ts-expect-error invalid return type
    recordDeletedTrigger(user, () => {
      return "invalid";
    });
  });

  test("function args include event args", () => {
    const user = db.type("User", {
      name: db.string(),
      age: db.int(),
    });
    createExecutor("test")
      .on(
        recordDeletedTrigger(user, (args) => {
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
        }),
      )
      .executeFunction({
        fn: (args) => {
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
      });
  });
});

describe("resolverExecutedTrigger", () => {
  test("can omit condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.type({ result: t.bool() }),
    });
    resolverExecutedTrigger(resolver);
  });

  test("can specify condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.type({ result: t.bool() }),
    });
    resolverExecutedTrigger(resolver, (args) => !args.error);
  });

  test("can not return invalid type from condition", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.type({ result: t.bool() }),
    });
    // @ts-expect-error invalid return type
    resolverExecutedTrigger(resolver, () => {
      return "invalid";
    });
  });

  test("function args include client and event args", () => {
    const resolver = createResolver({
      name: "test",
      operation: "query",
      body: () => ({ result: true }),
      output: t.type({ result: t.bool() }),
    });
    createExecutor("test")
      .on(
        resolverExecutedTrigger(resolver, (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            resolverName: string;
            result: { result: boolean } | undefined;
            error: string | undefined;
          }>();
          return true;
        }),
      )
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            workspaceId: string;
            appNamespace: string;
            resolverName: string;
            result: { result: boolean } | undefined;
            error: string | undefined;
          }>();
        },
      });
  });
});

describe("functionTarget", () => {
  test("can return void from fn", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeFunction({
        fn: () => {
          return;
        },
      });

    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeFunction({
        fn: async () => {
          return;
        },
      });
  });

  test("can not return invalid type from fn", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeFunction({
        // @ts-expect-error invalid return type
        fn: () => {
          return "invalid";
        },
      });
  });
});

describe("gqlTarget", () => {
  test("can specify query as string", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeGql({
        appName: "test-app",
        query: `
          query TestQuery {
            testField
          }
        `,
      });
  });

  test("can specify variables", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeGql({
        appName: "test-app",
        query: `
          query TestQuery($id: ID!) {
            testField(id: $id)
          }
        `,
        variables: () => ({
          id: "test-id",
        }),
      });
  });

  test("variables receive args", () => {
    createExecutor("test")
      .on(
        incomingWebhookTrigger<{
          body: { id: string };
          headers: { "x-custom-header": string };
        }>(),
      )
      .executeGql({
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
      });
  });
});

describe("webhookTarget", () => {
  test("url receive args", () => {
    createExecutor("test")
      .on(
        incomingWebhookTrigger<{
          body: { id: string };
          headers: { "x-custom-header": string };
        }>(),
      )
      .executeWebhook({
        url: (args) => {
          expectTypeOf(args).toExtend<{
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
          return `https://example.com/webhook/${args.body.id}`;
        },
      });
  });

  test("can not return invalid type from url", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeWebhook({
        // @ts-expect-error invalid return type
        url: () => {
          return 123;
        },
      });
  });

  test("body receive args", () => {
    createExecutor("test")
      .on(
        incomingWebhookTrigger<{
          body: { id: string };
          headers: { "x-custom-header": string };
        }>(),
      )
      .executeWebhook({
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
      });
  });

  test("can not return invalid type from body", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeWebhook({
        url: () => "https://example.com/webhook",
        // @ts-expect-error invalid return type
        body: () => {
          return 123;
        },
      });
  });

  test("can specify headers", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeWebhook({
        url: () => "https://example.com/webhook",
        headers: {
          "Content-Type": "application/json",
          Authorization: { vault: "my-vault", key: "my-secret" },
        },
      });
  });
});
