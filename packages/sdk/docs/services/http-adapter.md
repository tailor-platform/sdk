# HTTP Adapter

HTTP adapters expose REST-style HTTP endpoints on your application's gateway by translating each request into a GraphQL query and (optionally) reshaping the GraphQL response back into an HTTP response.

## Overview

Each HTTP adapter is a single file that declares:

- A `pathPattern` (which methods it handles is derived from the `input` keys)
- An `input` object keyed by lowercase HTTP method (`get`, `post`, `put`, `patch`, `delete`) — each value is a function that converts an incoming HTTP request into a GraphQL request (`query`, `variables`, `operationName`)
- An optional `output` function — **shared across all methods** — that converts the GraphQL response into an HTTP response (`statusCode`, `headers`, `body`)

At deploy time the SDK bundles `input` (with a generated method dispatcher) and `output` into standalone JS scripts that run in the gateway's sandboxed runtime when a matching request reaches the application gateway under the `/api/` prefix.

For the official Tailor Platform documentation — including the exact URL routing, request/response body limits, execution timeouts, CORS handling, and other gateway-runtime behavior — see https://docs.tailor.tech/.

## Requirements

- Each adapter file must call `createHttpAdapter` exactly once and `export default` the result
- `name` must be a string literal that matches `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` and be unique across all adapters
- `input` must be an object literal with at least one method handler
- Each method handler and `output` must be inline arrow or `function` expressions (not references to functions defined elsewhere)
- All handlers **must be synchronous** — the SDK rejects `async`/`await` at build time because the gateway runtime does not support it

## Build-time Limits

The SDK bundles each adapter function into a standalone ES2017 IIFE for the gateway runtime. The bundle is rejected if it imports Node built-in modules (`fs`, `path`, `crypto`, etc.) or exceeds 256 KB; a warning is emitted above 64 KB.

Gateway-side runtime limits (request/response body size, execution timeout, available globals) are enforced separately by the platform — see the platform documentation linked above.

## Configuration

Add an `httpAdapter` entry to `defineConfig`:

```typescript
// tailor.config.ts
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  httpAdapter: {
    files: ["adapters/**/*.ts"],
  },
});
```

## Defining an Adapter

```typescript
// adapters/user.ts
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "user",
  pathPattern: "/users/*",
  input: {
    get: (req) => ({
      query: `query GetUser($id: ID!) { user(id: $id) { id name email } }`,
      variables: { id: req.path.split("/")[2] },
    }),
    post: (req) => ({
      query: `mutation CreateUser($input: CreateUserInput!) { createUser(input: $input) { id } }`,
      variables: { input: JSON.parse(req.body) },
    }),
  },
  output: (resp) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resp.data ?? null),
  }),
});
```

A request to `GET /api/users/abc-123` invokes the `get` handler, runs the resulting GraphQL query against your application's GraphQL endpoint (with the caller's auth context preserved), then invokes `output(resp)` to produce the HTTP response. A `POST /api/users/...` would instead invoke the `post` handler with the same shared `output`.

If `output` is omitted, the raw GraphQL response is returned as JSON.

### Optional fields

Beyond `name`, `pathPattern`, `input`, and `output`, two optional fields control deploy-time behavior:

- `enabled` (default `true`) — set to `false` to deploy the adapter in a disabled state without removing its file. A disabled adapter is uploaded but not served by the gateway.
- `priority` (non-negative integer, default `0`) — reserved for forward compatibility. The value is plumbed through to the platform, but the gateway's path matcher does not currently rely on it.

```typescript
export default createHttpAdapter({
  name: "user",
  pathPattern: "/users/*",
  enabled: false, // uploaded but not served
  priority: 10, // reserved; not yet used by the matcher
  input: {
    get: (req) => ({ query: `query { ... }` }),
  },
});
```

### Why is `output` shared instead of per-method?

The gateway runs `input` and `output` in **separate JavaScript VMs** with no shared globals, and the `output` callback only receives the GraphQL response (not the original request or method). For per-method response shaping, discriminate inside `output` based on the response data shape.

## Path Pattern

`pathPattern` is matched against the request path **after** the platform-side `/api/` prefix.

- Literal segments must match exactly
- A `*` in the middle of the pattern matches exactly one path segment (`/users/*/items`)
- A trailing `*` matches the remaining path (`/users/*`)

Exact matching semantics (trailing-slash handling, percent-encoding, etc.) are defined by the platform — refer to the platform documentation for details.

## Type Reference

```typescript
type HttpAdapter = {
  name: string;
  pathPattern: string;
  input: HttpAdapterInput;
  output?: HttpAdapterOutputFn;
  /** Whether the adapter is served by the gateway. Defaults to true. */
  enabled?: boolean;
  /** Reserved for forward compatibility; not yet used by the matcher. Defaults to 0. */
  priority?: number;
};

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type HttpMethodKey = "get" | "post" | "put" | "patch" | "delete";

type HttpAdapterRequest = {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string;
};

type HttpAdapterInputResult = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

type HttpAdapterInputFn = (req: HttpAdapterRequest) => HttpAdapterInputResult;

type HttpAdapterInput = Partial<Record<HttpMethodKey, HttpAdapterInputFn>>;

type HttpAdapterGraphQLResponse = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
};

type HttpAdapterOutputResult = {
  statusCode?: number;
  headers?: Record<string, string>;
  body: string;
};
```
