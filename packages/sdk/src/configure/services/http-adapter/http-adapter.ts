import { brandValue } from "#src/utils/brand";
import type { HttpAdapterConfigInput } from "#src/types/http-adapter.generated";

/**
 * Lowercase HTTP method keys accepted in `input`, derived from the config
 * schema via the generated type so they cannot drift.
 */
type HttpMethodKey = keyof Required<HttpAdapterConfigInput["input"]>;

/** Incoming HTTP request passed to an `input` handler. */
export type HttpAdapterRequest = {
  method: Uppercase<HttpMethodKey>;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string;
};

/** GraphQL request returned by an `input` handler. */
export type HttpAdapterGraphQLRequest = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

/** Converts an incoming HTTP request into a GraphQL request. */
export type HttpAdapterInputFn = (req: HttpAdapterRequest) => HttpAdapterGraphQLRequest;

/** GraphQL execution result passed to the `output` handler. */
export type HttpAdapterGraphQLResponse = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
};

/** HTTP response returned by the `output` handler. */
export type HttpAdapterResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body: string;
};

/** Converts a GraphQL response into an HTTP response. */
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
// from `@/types/http-adapter.generated`, where the function fields are typed
// as `Function`.
export type HttpAdapter = Omit<HttpAdapterConfigInput, "input" | "output"> & {
  input: HttpAdapterInput;
  output?: HttpAdapterOutputFn;
};

/**
 * Defines an HTTP adapter that translates HTTP requests to GraphQL queries
 * and shapes the GraphQL response back into an HTTP response.
 *
 * The adapter MUST be the default export of its file.
 * Files are discovered via the `httpAdapter.files` glob in `defineConfig()`.
 *
 * `input` is an object keyed by lowercase HTTP method (`get`, `post`, `put`,
 * `patch`, `delete`). At least one method must be declared; the methods the
 * adapter serves are derived from these keys.
 *
 * `output` is optional and shared across all methods. If you need different
 * response shapes per method, discriminate inside `output` based on the
 * GraphQL response shape.
 *
 * Each handler runs server-side and must be synchronous: Node APIs, `fetch`,
 * `async`/`await`, Promises, and top-level `await` are not available.
 *
 * Optional fields: `enabled` (default `true`; set `false` to deploy the adapter
 * without serving it) and `priority` (non-negative integer, default `0`; when
 * multiple adapters match the same request path, the lowest value wins).
 * @param config - HTTP adapter configuration
 * @returns Branded HTTP adapter definition
 * @example
 * export default createHttpAdapter({
 *   name: "get-user",
 *   pathPattern: "/users/*",
 *   input: {
 *     get: (req) => ({
 *       query: `query($id: ID!) { user(id: $id) { id name } }`,
 *       variables: { id: req.path.split("/")[2] },
 *     }),
 *   },
 *   output: (resp) => ({
 *     statusCode: 200,
 *     headers: { "content-type": "application/json" },
 *     body: JSON.stringify(resp.data),
 *   }),
 * });
 */
export function createHttpAdapter(config: HttpAdapter): HttpAdapter {
  return brandValue({ ...config }, "http-adapter");
}
