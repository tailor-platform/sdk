import { IncomingWebhookTrigger, ManifestAndContext } from "../types";

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

export type IncomingWebhookTriggerContext<
  T extends {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
> = {
  args: WebhookArgs<T>;
};

export type IncomingWebhookTriggerWithManifestAndContext<
  T extends {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
> = ManifestAndContext<
  IncomingWebhookTrigger,
  IncomingWebhookTriggerContext<T>
>;

export function incomingWebhookTrigger<
  T extends {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {
    body: Record<string, unknown>;
    headers: Record<string, string>;
  },
>(): IncomingWebhookTriggerWithManifestAndContext<T> {
  return {
    manifest: { Kind: "IncomingWebhook" },
    context: { args: {} as WebhookArgs<T> },
  };
}
