import type { HttpAdapterConfigInput } from "./http-adapter.generated";

export type {
  HttpAdapterConfig,
  HttpAdapterConfigInput,
  HttpAdapterServiceInput,
} from "./http-adapter.generated";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export type HttpAdapterRequest = {
  method: string;
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
 * User-facing HTTP adapter shape with typed `input` and `output` signatures.
 * The runtime/parser representation uses the looser `HttpAdapterConfig` from
 * `./http-adapter.generated` where these fields are typed as `Function`.
 */
export type HttpAdapter = Omit<HttpAdapterConfigInput, "input" | "output"> & {
  input: HttpAdapterInputFn;
  output?: HttpAdapterOutputFn;
};
