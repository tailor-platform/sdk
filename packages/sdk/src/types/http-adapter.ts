import type { HttpAdapterConfigInput } from "./http-adapter.generated";

export type { HttpAdapterConfig, HttpAdapterConfigInput } from "./http-adapter.generated";

/**
 * `httpAdapter` entry of `defineConfig`. Follows the same shape as the other
 * file-discovery services (resolver/executor/workflow).
 */
export type HttpAdapterServiceInput = {
  /** Glob patterns matching HTTP adapter files */
  files: string[];
  /** Glob patterns to exclude */
  ignores?: string[];
};

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

export type HttpAdapterGraphQLRequest = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type HttpAdapterInputFn = (req: HttpAdapterRequest) => HttpAdapterGraphQLRequest;

export type HttpAdapterGraphQLResponse = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
};

export type HttpAdapterResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body: string;
};

export type HttpAdapterOutputFn = (resp: HttpAdapterGraphQLResponse) => HttpAdapterResponse;

/**
 * Per-method input handlers. At least one method must be provided.
 * Each handler transforms an HTTP request into a GraphQL request.
 */
export type HttpAdapterInput = Partial<Record<HttpMethodKey, HttpAdapterInputFn>>;

/**
 * HTTP adapter configuration accepted by `createHttpAdapter` with typed
 * `input` and `output` signatures.
 */
// Internally, the parser-side representation is the looser `HttpAdapterConfig`
// from `./http-adapter.generated`, where the function fields are typed as
// `Function`.
export type HttpAdapter = Omit<HttpAdapterConfigInput, "input" | "output"> & {
  input: HttpAdapterInput;
  output?: HttpAdapterOutputFn;
};
