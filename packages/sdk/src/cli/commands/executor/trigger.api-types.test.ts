// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { createExecutor } from "#/configure/services/executor/index";
import { idpUserCreatedTrigger } from "#/configure/services/executor/trigger/event";
import { scheduleTrigger } from "#/configure/services/executor/trigger/schedule";
import { incomingWebhookTrigger } from "#/configure/services/executor/trigger/webhook";
import { type TriggerExecutorOptions, type TriggerExecutorTypedOptions } from "./trigger";

const incomingWebhookExecutor = createExecutor({
  name: "incoming-webhook-executor",
  trigger: incomingWebhookTrigger<{
    body: { message: string };
    headers: { "x-request-id": string };
  }>(),
  operation: { kind: "function", body: () => {} },
});

const scheduleExecutor = createExecutor({
  name: "schedule-executor",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: { kind: "function", body: () => {} },
});

const eventExecutor = createExecutor({
  name: "event-executor",
  trigger: idpUserCreatedTrigger(),
  operation: { kind: "function", body: () => {} },
});

describe("triggerExecutor API types", () => {
  test("allows payload for incomingWebhook executors", () => {
    const acceptsOptions = (
      _options: TriggerExecutorTypedOptions<typeof incomingWebhookExecutor>,
    ): void => {};

    acceptsOptions({
      executor: incomingWebhookExecutor,
      payload: { body: { message: "hello" }, headers: { "x-request-id": "req-1" } },
    });
  });

  test("disallows payload for schedule executors", () => {
    const acceptsOptions = (
      _options: TriggerExecutorTypedOptions<typeof scheduleExecutor>,
    ): void => {};

    acceptsOptions({ executor: scheduleExecutor });

    acceptsOptions({
      executor: scheduleExecutor,
      // @ts-expect-error - schedule trigger does not accept payload
      payload: { body: { message: "hello" } },
    });
  });

  test("rejects event trigger executors", () => {
    // @ts-expect-error - event trigger executors cannot be triggered manually
    type _InvalidEventTriggerOptions = TriggerExecutorTypedOptions<typeof eventExecutor>;
  });

  test("works with default generic when TriggerExecutorTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: TriggerExecutorTypedOptions): void => {};

    acceptsDefaultOptions({
      executor: incomingWebhookExecutor,
      payload: { body: { message: "hello" }, headers: { "x-request-id": "req-1" } },
    });

    acceptsDefaultOptions({ executor: scheduleExecutor });

    // @ts-expect-error - payload is not allowed for schedule trigger
    acceptsDefaultOptions({
      executor: scheduleExecutor,
      payload: { body: { message: "hello" } },
    });
  });

  test("keeps deprecated TriggerExecutorOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: TriggerExecutorOptions): void => {};

    acceptsDeprecatedOptions({
      executorName: "incoming-webhook-executor",
      payload: { body: { message: "hello" } },
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy executorName shape
      executor: incomingWebhookExecutor,
      payload: { body: { message: "hello" } },
    });
  });
});
