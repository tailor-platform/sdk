import { describe, it } from "vitest";
import { createExecutor } from "@/configure/services/executor";
import { idpUserCreatedTrigger } from "@/configure/services/executor/trigger/event";
import { scheduleTrigger } from "@/configure/services/executor/trigger/schedule";
import { incomingWebhookTrigger } from "@/configure/services/executor/trigger/webhook";
import { type TriggerExecutorOptions } from "./trigger";

const incomingWebhookExecutor = createExecutor({
  name: "incoming-webhook-executor",
  trigger: incomingWebhookTrigger<{
    body: { message: string };
    headers: { "x-request-id": string };
  }>(),
  operation: {
    kind: "function",
    body: () => {},
  },
});

const scheduleExecutor = createExecutor({
  name: "schedule-executor",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "function",
    body: () => {},
  },
});

const eventExecutor = createExecutor({
  name: "event-executor",
  trigger: idpUserCreatedTrigger(),
  operation: {
    kind: "function",
    body: () => {},
  },
});

describe("triggerExecutor API types", () => {
  it("allows payload for incomingWebhook executors", () => {
    const acceptsOptions = (
      _options: TriggerExecutorOptions<typeof incomingWebhookExecutor>,
    ): void => {};

    acceptsOptions({
      executor: incomingWebhookExecutor,
      payload: {
        body: { message: "hello" },
        headers: {
          "x-request-id": "req-1",
        },
      },
    });
  });

  it("disallows payload for schedule executors", () => {
    const acceptsOptions = (_options: TriggerExecutorOptions<typeof scheduleExecutor>): void => {};

    acceptsOptions({
      executor: scheduleExecutor,
    });

    acceptsOptions({
      executor: scheduleExecutor,
      // @ts-expect-error - schedule trigger does not accept payload
      payload: {
        body: { message: "hello" },
      },
    });
  });

  it("rejects event trigger executors", () => {
    // @ts-expect-error - event trigger executors cannot be triggered manually
    type _InvalidEventTriggerOptions = TriggerExecutorOptions<typeof eventExecutor>;
  });

  it("works with default generic when TriggerExecutorOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: TriggerExecutorOptions): void => {};

    acceptsDefaultOptions({
      executor: incomingWebhookExecutor,
      payload: {
        body: { message: "hello" },
        headers: { "x-request-id": "req-1" },
      },
    });

    acceptsDefaultOptions({
      executor: scheduleExecutor,
    });

    // @ts-expect-error - payload is not allowed for schedule trigger
    acceptsDefaultOptions({
      executor: scheduleExecutor,
      payload: {
        body: { message: "hello" },
      },
    });
  });
});
