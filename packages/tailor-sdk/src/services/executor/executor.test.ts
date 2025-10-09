import { describe, expect, expectTypeOf, test } from "vitest";
import { createExecutor } from "./executor";
import { scheduleTrigger } from "./trigger";
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
