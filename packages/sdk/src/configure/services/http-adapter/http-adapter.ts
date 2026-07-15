import { brandValue } from "#/utils/brand";
import type { HttpAdapterConfigInput } from "#/types/http-adapter.generated";
import type { DocumentNode } from "graphql";

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
export type HttpAdapterGraphQLRequest<Query extends HttpAdapterGraphQLQuery = string> = {
  query: Query;
  operationName?: string;
} & HttpAdapterGraphQLRequestVariables<Query>;

/**
 * Typed GraphQL document accepted by an HTTP adapter input handler.
 * Compatible with generated `TypedDocumentNode` values.
 */
export type HttpAdapterTypedDocumentNode<
  TResult = unknown,
  TVariables = Record<string, unknown>,
> = DocumentNode & {
  __apiType?: (variables: TVariables) => TResult;
  __ensureTypesOfVariablesAndResultMatching?: (variables: TVariables) => TResult;
};

/** GraphQL query value accepted by an HTTP adapter input handler. */
export type HttpAdapterGraphQLQuery = string | DocumentNode;

type HttpAdapterGraphQLData<Query> =
  Query extends HttpAdapterTypedDocumentNode<infer Result, infer _Variables> ? Result : unknown;

type HttpAdapterGraphQLVariables<Query> =
  Query extends HttpAdapterTypedDocumentNode<infer _Result, infer Variables>
    ? Variables
    : Record<string, unknown>;

type HttpAdapterHasRequiredVariables<T> = [T] extends [never]
  ? false
  : T extends object
    ? Record<never, never> extends T
      ? false
      : true
    : false;

type HttpAdapterGraphQLRequestVariables<Query> =
  true extends HttpAdapterHasRequiredVariables<HttpAdapterGraphQLVariables<Query>>
    ? { variables: HttpAdapterGraphQLVariables<Query> }
    : { variables?: HttpAdapterGraphQLVariables<Query> };

/**
 * Converts an incoming HTTP request into a GraphQL request.
 * Pass a typed document type as `Query` when annotating extracted handlers.
 */
export type HttpAdapterInputFn<Query extends HttpAdapterGraphQLQuery = string> = (
  req: HttpAdapterRequest,
) => HttpAdapterGraphQLRequest<Query>;

/** GraphQL execution result passed to the `output` handler. */
export type HttpAdapterGraphQLResponse<Data = unknown> = {
  data?: Data | null;
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
export type HttpAdapterOutputFn<Data = unknown> = (
  resp: HttpAdapterGraphQLResponse<Data>,
) => HttpAdapterResponse;

/**
 * Per-method input handlers. At least one method must be provided.
 * Each handler transforms an HTTP request into a GraphQL request.
 */
export type HttpAdapterInput = Partial<
  Record<HttpMethodKey, HttpAdapterInputFn<HttpAdapterGraphQLQuery>>
>;

type HttpAdapterInputHandlerData<Handler> = Handler extends (
  req: HttpAdapterRequest,
) => infer Request
  ? Request extends { query: infer Query }
    ? HttpAdapterGraphQLData<Query>
    : unknown
  : never;

type HttpAdapterInputData<Input extends HttpAdapterInput> = [
  HttpAdapterInputHandlerData<Input[keyof Input]>,
] extends [never]
  ? unknown
  : HttpAdapterInputHandlerData<Input[keyof Input]>;

type HttpAdapterValidatedRequest<Request> = Request extends {
  query: infer Query extends HttpAdapterGraphQLQuery;
}
  ? Request & HttpAdapterGraphQLRequest<Query>
  : never;

type HttpAdapterValidatedInput<Input extends HttpAdapterInput> = {
  [Method in keyof Input]: Input[Method] extends (req: HttpAdapterRequest) => infer Request
    ? (req: HttpAdapterRequest) => HttpAdapterValidatedRequest<Request>
    : Input[Method];
};

/**
 * HTTP adapter configuration accepted by `createHttpAdapter` with typed
 * `input` and `output` signatures.
 */
// Internally, the parser-side representation is the looser `HttpAdapterConfig`
// from `@/types/http-adapter.generated`, where the function fields are typed
// as `Function`.
export type HttpAdapter<Input extends HttpAdapterInput = HttpAdapterInput> = Omit<
  HttpAdapterConfigInput,
  "input" | "output"
> & {
  input: Input & HttpAdapterValidatedInput<Input>;
  output?: HttpAdapterOutputFn<HttpAdapterInputData<Input>>;
};

/**
 * Defines an HTTP adapter that translates HTTP requests to GraphQL queries
 * and shapes the GraphQL response back into an HTTP response.
 *
 * The adapter MUST be the default export of its file.
 * Files are discovered via the `httpAdapter.files` glob in `defineConfig()`.
 *
 * `input` is an object keyed by lowercase HTTP method (`get`, `post`, `put`,
 * `patch`, `delete`). Each handler can return a GraphQL query string or a
 * typed document node. At least one method must be declared; the methods the
 * adapter serves are derived from these keys.
 *
 * `output` is optional and shared across all methods. If `input` returns typed
 * document nodes, `output` receives the corresponding result type as
 * `resp.data`. If you need different response shapes per method, discriminate
 * inside `output` based on the GraphQL response shape.
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
export function createHttpAdapter<const Input extends HttpAdapterInput>(
  config: HttpAdapter<Input>,
): HttpAdapter<Input> {
  return brandValue({ ...config }, "http-adapter");
}
