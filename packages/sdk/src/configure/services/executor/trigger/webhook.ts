import type { TailorEnv } from "@/types/env";
import type { IncomingWebhookTrigger as ParserIncomingWebhookTrigger } from "@/types/executor.generated";
import type { JsonValue } from "@/types/helpers";

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

export interface IncomingWebhookResponseConfig<Args> {
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

export type IncomingWebhookResponse<Args> =
  | ((args: Args) => JsonValue)
  | IncomingWebhookResponseConfig<Args>;

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
  const response =
    typeof options?.response === "function" ? { body: options.response } : options?.response;
  return {
    kind: "incomingWebhook",
    ...(response ? { response } : {}),
    __args: {} as IncomingWebhookArgs<T>,
  };
}
