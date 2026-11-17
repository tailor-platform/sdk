// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { createExecutor } from "#/configure/services/executor/index";
import { idpUserCreatedTrigger } from "#/configure/services/executor/trigger/event";
import { scheduleTrigger } from "#/configure/services/executor/trigger/schedule";
import { incomingWebhookTrigger } from "#/configure/services/executor/trigger/webhook";
import { type TriggerExecutorTypedOptions } from "./trigger";

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
      payload: { message: "hello" },
    });
  });

  test("allows headers for incomingWebhook executors, as a string or a list of strings", () => {
    const acceptsOptions = (
      _options: TriggerExecutorTypedOptions<typeof incomingWebhookExecutor>,
    ): void => {};

    acceptsOptions({
      executor: incomingWebhookExecutor,
      headers: { "x-request-id": "req-1", accept: ["application/json", "text/html"] },
    });

    acceptsOptions({
      executor: incomingWebhookExecutor,
      // @ts-expect-error - a header value is a string or a list of strings
      headers: { "x-request-id": 1 },
    });
  });

  test("disallows headers for schedule executors", () => {
    const acceptsOptions = (
      _options: TriggerExecutorTypedOptions<typeof scheduleExecutor>,
    ): void => {};

    acceptsOptions({
      executor: scheduleExecutor,
      // @ts-expect-error - schedule trigger does not accept headers
      headers: { "x-request-id": "req-1" },
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
      payload: { message: "hello" },
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
      payload: { message: "hello" },
    });

    acceptsDefaultOptions({ executor: scheduleExecutor });

    // @ts-expect-error - payload is not allowed for schedule trigger
    acceptsDefaultOptions({
      executor: scheduleExecutor,
      payload: { message: "hello" },
    });
  });
});
