import { type IncomingWebhookTrigger, type WithArgs } from "../types";

interface WebhookArgs<
  T extends {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
> {
  body: T["body"] extends undefined ? Record<string, unknown> : T["body"];
  headers: T["headers"] extends undefined
    ? Record<string, string>
    : T["headers"];
  method: "POST" | "GET" | "PUT" | "DELETE";
  rawBody: string;
}

export function incomingWebhookTrigger<
  T extends {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {
    body: Record<string, unknown>;
    headers: Record<string, string>;
  },
>(): IncomingWebhookTrigger & WithArgs<WebhookArgs<T>> {
  return {
    Kind: "IncomingWebhook",
    _args: {} as WebhookArgs<T>,
  };
}
