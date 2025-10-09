import { describe, expect, expectTypeOf, test } from "vitest";
import { createExecutor } from "./executor";
import { incomingWebhookTrigger, scheduleTrigger } from "./trigger";
import type { SqlClient } from "../pipeline";

describe("scheduleTrigger", () => {
  test("can specify valid cron", () => {
    const trigger = scheduleTrigger("* * * * *");
    expect(trigger.manifest.Frequency).toBe("* * * * *");
  });

  test("can not specify invalid cron", () => {
    // @ts-expect-error invalid cron
    scheduleTrigger("* * * *");
  });

  test("default timezone is UTC", () => {
    const trigger = scheduleTrigger("* * * * *");
    expect(trigger.manifest.Timezone).toBe("UTC");
  });

  test("can specify timezone", () => {
    const trigger = scheduleTrigger("* * * * *", "Asia/Tokyo");
    expect(trigger.manifest.Timezone).toBe("Asia/Tokyo");
  });

  test("can not specify invalid timezone", () => {
    // @ts-expect-error invalid timezone
    scheduleTrigger("* * * * *", "Invalid/Timezone");
  });

  test("function args include client", () => {
    createExecutor("test")
      .on(scheduleTrigger("* * * * *"))
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            client: SqlClient;
          }>();
        },
      });
  });
});

describe("webhookTrigger", () => {
  test("function args include client and webhook args", () => {
    createExecutor("test")
      .on(incomingWebhookTrigger())
      .executeFunction({
        fn: (args) => {
          expectTypeOf(args).toExtend<{
            client: SqlClient;
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
            client: SqlClient;
            body: { id: string };
            headers: { "x-custom-header": string };
            method: "POST" | "GET" | "PUT" | "DELETE";
            rawBody: string;
          }>();
        },
      });
  });
});
