import type { HttpAdapterConfigInput } from "./http-adapter.generated";

export type {
  HttpAdapterConfig,
  HttpAdapterConfigInput,
  HttpAdapterServiceInput,
} from "./http-adapter.generated";

/**
 * Single source of truth for HTTP methods supported by createHttpAdapter.
 * Maps the lowercase config key (`input.get`, `input.post`, ...) to the
 * uppercase wire-format method (`req.method` at runtime). Adding a method
 * here flows automatically to `HttpMethodKey` / `HttpMethod` and to any
 * `Object.keys(HTTP_METHODS)` enumeration.
 */
export const HTTP_METHODS = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
} as const;

export type HttpMethodKey = keyof typeof HTTP_METHODS;

export type HttpMethod = (typeof HTTP_METHODS)[HttpMethodKey];

export const HTTP_METHOD_KEYS = Object.keys(HTTP_METHODS) as readonly HttpMethodKey[];

export type HttpAdapterRequest = {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string;
};

export type HttpAdapterInputResult = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type HttpAdapterInputFn = (req: HttpAdapterRequest) => HttpAdapterInputResult;

export type HttpAdapterGraphQLResponse = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
};

export type HttpAdapterOutputResult = {
  statusCode?: number;
  headers?: Record<string, string>;
  body: string;
};

export type HttpAdapterOutputFn = (resp: HttpAdapterGraphQLResponse) => HttpAdapterOutputResult;

/**
 * Per-method input handlers. At least one method must be provided.
 * Each handler transforms an HTTP request into a GraphQL request.
 */
export type HttpAdapterInput = Partial<Record<HttpMethodKey, HttpAdapterInputFn>>;

/**
 * User-facing HTTP adapter shape with typed `input` and `output` signatures.
 * The runtime/parser representation uses the looser `HttpAdapterConfig` from
 * `./http-adapter.generated` where the function fields are typed as `Function`.
 */
export type HttpAdapter = Omit<HttpAdapterConfigInput, "input" | "output"> & {
  input: HttpAdapterInput;
  output?: HttpAdapterOutputFn;
};
