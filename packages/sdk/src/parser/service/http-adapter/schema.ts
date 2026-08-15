import * as v from "valibot";
import { functionSchema } from "../common";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const inputHandlersSchema = v.pipe(
  v.strictObject({
    get: v.optional(v.pipe(functionSchema, v.description("Handler for GET requests"))),
    post: v.optional(v.pipe(functionSchema, v.description("Handler for POST requests"))),
    put: v.optional(v.pipe(functionSchema, v.description("Handler for PUT requests"))),
    patch: v.optional(v.pipe(functionSchema, v.description("Handler for PATCH requests"))),
    delete: v.optional(v.pipe(functionSchema, v.description("Handler for DELETE requests"))),
  }),
  v.check(
    (value) =>
      // valibot drops absent optional keys, but an explicitly passed `undefined` survives
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      Object.values(value).some((handler) => handler !== undefined),
    "input must declare at least one HTTP method handler",
  ),
  v.description("Per-method functions that transform HTTP requests to GraphQL requests"),
);

export const HttpAdapterConfigSchema = v.pipe(
  v.strictObject({
    name: v.pipe(
      v.string(),
      v.regex(
        NAME_PATTERN,
        "name must be 3-63 chars, lowercase alphanumeric with hyphens, not starting or ending with a hyphen",
      ),
      v.description("Unique adapter name within the domain"),
    ),
    pathPattern: v.pipe(
      v.string(),
      v.minLength(1),
      v.description("Path pattern with segment wildcards (trailing or single-segment)"),
    ),
    enabled: v.optional(v.pipe(v.boolean(), v.description("Whether the adapter is active")), true),
    priority: v.optional(
      v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.description("Matching priority; the lowest value wins when multiple adapters match"),
      ),
      0,
    ),
    input: inputHandlersSchema,
    output: v.optional(
      v.pipe(
        functionSchema,
        v.description("Function that transforms GraphQL response to HTTP response"),
      ),
    ),
  }),
  v.brand("HttpAdapterConfig"),
);
