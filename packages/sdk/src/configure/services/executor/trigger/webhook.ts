import type { IncomingWebhookTrigger as ParserIncomingWebhookTrigger } from "@/parser/service/executor/types";

export interface IncomingWebhookArgs<T extends IncomingWebhookRequest> {
  body: T["body"];
  headers: T["headers"];
  method: "POST" | "GET" | "PUT" | "DELETE";
  rawBody: string;
}

export interface IncomingWebhookRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export type IncomingWebhookTrigger<Args> = ParserIncomingWebhookTrigger & {
  __args: Args;
};

export function incomingWebhookTrigger<T extends IncomingWebhookRequest>(): IncomingWebhookTrigger<
  IncomingWebhookArgs<T>
> {
  return {
    kind: "incomingWebhook",
    __args: {} as IncomingWebhookArgs<T>,
  };
}
