import { brandValue } from "@/utils/brand";
import type { HttpAdapter } from "@/types/http-adapter";

export type {
  HttpAdapter,
  HttpAdapterInput,
  HttpAdapterRequest,
  HttpAdapterInputResult,
  HttpAdapterInputFn,
  HttpAdapterGraphQLResponse,
  HttpAdapterOutputResult,
  HttpAdapterOutputFn,
  HttpMethod,
  HttpMethodKey,
} from "@/types/http-adapter";

/**
 * Defines an HTTP adapter that translates HTTP requests to GraphQL queries
 * and shapes the GraphQL response back into an HTTP response.
 *
 * The adapter MUST be the default export of its file.
 * Files are discovered via the `httpAdapter.files` glob in `defineConfig()`.
 *
 * `input` is an object keyed by lowercase HTTP method (`get`, `post`, `put`,
 * `patch`, `delete`). At least one method must be declared; the SDK derives
 * the adapter's matched methods from these keys and generates a per-method
 * dispatcher at bundle time.
 *
 * `output` is optional and shared across all methods. If you need different
 * response shapes per method, discriminate inside `output` based on the
 * GraphQL response shape.
 *
 * Each handler is bundled into a JS string and executed server-side in a
 * sandboxed Sobek runtime (a goja fork — ES5.1 with most of ES6). Bundles are
 * downleveled to ES2017 syntax; that target (rather than the runtime's actual
 * level) is intentional, so `async`/`await` stays detectable and is rejected at
 * build time. Node APIs, `fetch`, `async`/`await`, and top-level `await` are
 * not available at runtime.
 *
 * Optional fields: `enabled` (default `true`; set `false` to deploy the adapter
 * without serving it) and `priority` (non-negative integer, default `0`;
 * reserved for forward compatibility and not yet used by the gateway matcher).
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
