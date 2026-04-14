import type { TailorEnv } from "@/configure/types/env";
import type { JsonValue } from "@/configure/types/helpers";
import type { IncomingWebhookTrigger as ParserIncomingWebhookTrigger } from "@/types/executor.generated";

export interface IncomingWebhookArgs<T extends IncomingWebhookRequest> {
  body: T["body"];
  headers: T["headers"];
  method: "POST" | "GET" | "PUT" | "DELETE";
  rawBody: string;
  env: TailorEnv;
}

export interface IncomingWebhookRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface IncomingWebhookResponse<Args> {
  /**
   * Expression that returns the webhook HTTP response body.
   * Receives the same args as the executor operation.
   */
  body?: (args: Args) => JsonValue;
  /**
   * HTTP status code for the response.
   * If omitted and `body` is set, the platform uses 200.
   */
  statusCode?: number;
}

export interface IncomingWebhookTriggerOptions<Args> {
  response?: IncomingWebhookResponse<Args>;
}

export type IncomingWebhookTrigger<Args> = ParserIncomingWebhookTrigger & {
  __args: Args;
};

/**
 * Create a trigger for incoming webhook requests.
 * @template T
 * @param options - Optional trigger options including response configuration
 * @returns Incoming webhook trigger
 */
export function incomingWebhookTrigger<T extends IncomingWebhookRequest>(
  options?: IncomingWebhookTriggerOptions<IncomingWebhookArgs<T>>,
): IncomingWebhookTrigger<IncomingWebhookArgs<T>> {
  return {
    kind: "incomingWebhook",
    ...(options?.response ? { response: options.response } : {}),
    __args: {} as IncomingWebhookArgs<T>,
  };
}
