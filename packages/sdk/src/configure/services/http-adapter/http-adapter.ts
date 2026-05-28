import { brandValue } from "@/utils/brand";
import type { HttpAdapter } from "@/types/http-adapter";

export type {
  HttpAdapter,
  HttpAdapterRequest,
  HttpAdapterInputResult,
  HttpAdapterInputFn,
  HttpAdapterGraphQLResponse,
  HttpAdapterOutputResult,
  HttpAdapterOutputFn,
  HttpMethod,
} from "@/types/http-adapter";

/**
 * Defines an HTTP adapter that translates HTTP requests to GraphQL queries
 * and shapes the GraphQL response back into an HTTP response.
 *
 * The adapter MUST be the default export of its file.
 * Files are discovered via the `httpAdapter.files` glob in `defineConfig()`.
 *
 * The `input` and `output` functions are bundled into JS strings and executed
 * server-side in a sandboxed Sobek (ES2017 subset) runtime. Node APIs, `fetch`,
 * `async`/`await`, and top-level `await` are not available at runtime.
 * @param config - HTTP adapter configuration
 * @returns Branded HTTP adapter definition
 * @example
 * export default createHttpAdapter({
 *   name: "get-user",
 *   pathPattern: "/users/*",
 *   methods: ["GET"],
 *   input: (req) => ({
 *     query: `query($id: ID!) { user(id: $id) { id name } }`,
 *     variables: { id: req.path.split("/")[2] },
 *   }),
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
