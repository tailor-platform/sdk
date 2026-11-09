import type { TailorEnv } from "#/runtime/types";
import type { IncomingWebhookTrigger as ParserIncomingWebhookTrigger } from "#/types/executor.generated";
import type { JsonValue } from "#/types/helpers";

export interface IncomingWebhookArgs<T extends IncomingWebhookRequest> {
  body: T["body"];
  /**
   * Request headers, with names in lower case. A header sent on one line is a string, and a header
   * sent on more than one line is an array of strings. When the executor is triggered manually with
   * `tailor executor trigger` or `triggerExecutor`, these are the headers passed with the trigger.
   */
  headers: T["headers"];
  method: "POST" | "GET" | "PUT" | "DELETE";
  /**
   * Raw request body, base64-encoded. Absent when the executor is triggered
   * manually with `tailor executor trigger` or `triggerExecutor`.
   */
  rawBody: string;
  env: TailorEnv;
}

type ListHeaderName =
  | "accept"
  | "accept-charset"
  | "accept-encoding"
  | "accept-language"
  | "allow"
  | "cache-control"
  | "connection"
  | "content-encoding"
  | "content-language"
  | "expect"
  | "forwarded"
  | "if-match"
  | "if-none-match"
  | "pragma"
  | "te"
  | "trailer"
  | "transfer-encoding"
  | "upgrade"
  | "vary"
  | "via"
  | "x-forwarded-for";

/**
 * Request headers of an incoming webhook when `incomingWebhookTrigger` has no type argument.
 * The headers that RFC 9110 defines as comma-separated lists, such as `accept` and `via`, and
 * `x-forwarded-for` are a string or an array of strings, because a client may send them on more
 * than one line. Any other header is a string. To change the type of a header, name only that
 * header in the `headers` of the type argument.
 */
export type IncomingWebhookHeaders = { [K in ListHeaderName]?: string | string[] } & Record<
  string,
  string
>;

export interface IncomingWebhookRequest {
  body: Record<string, unknown>;
  headers: Record<string, string | string[]>;
}

/**
 * Type argument of `incomingWebhookTrigger`. Name only what you want to override: `body` replaces
 * the body type, and each header in `headers` replaces the type of that header. Everything that is
 * not named keeps its default type.
 */
export interface IncomingWebhookRequestOverrides {
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
}

type OverrideHeaders<H> = { [K in keyof H]: H[K] } & {
  [K in Exclude<ListHeaderName, keyof H>]?: string | string[];
} & Record<string, string>;

type ResolveIncomingWebhookRequest<T extends IncomingWebhookRequestOverrides> = {
  body: T extends { body: infer B extends Record<string, unknown> } ? B : Record<string, unknown>;
  headers: T extends { headers: infer H extends Record<string, string | string[]> }
    ? OverrideHeaders<H>
    : IncomingWebhookHeaders;
};

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
export function incomingWebhookTrigger<
  T extends IncomingWebhookRequestOverrides = IncomingWebhookRequestOverrides,
>(
  options?: IncomingWebhookTriggerOptions<IncomingWebhookArgs<ResolveIncomingWebhookRequest<T>>>,
): IncomingWebhookTrigger<IncomingWebhookArgs<ResolveIncomingWebhookRequest<T>>> {
  const response =
    typeof options?.response === "function" ? { body: options.response } : options?.response;
  return {
    kind: "incomingWebhook",
    ...(response ? { response } : {}),
    __args: {} as IncomingWebhookArgs<ResolveIncomingWebhookRequest<T>>,
  };
}
