import type { HttpAdapterConfigInput } from "#src/types/http-adapter.generated";

/**
 * Maps the lowercase `input` handler keys to the HTTP methods they serve.
 * The key set is tied to `inputHandlersSchema` in `./schema` via the
 * zinfer-generated config type, so the two cannot drift apart.
 */
export const HTTP_METHODS = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
} as const satisfies Record<keyof Required<HttpAdapterConfigInput["input"]>, string>;

export type HttpMethodKey = keyof typeof HTTP_METHODS;

export const HTTP_METHOD_KEYS = Object.keys(HTTP_METHODS) as readonly HttpMethodKey[];
