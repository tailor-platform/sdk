# HTTP Adapter

HTTP adapters expose REST-style HTTP endpoints on your application by translating each request into a GraphQL query and (optionally) reshaping the GraphQL response back into an HTTP response.

## Overview

Each HTTP adapter is a single file that declares:

- A `pathPattern` (which methods it handles is derived from the `input` keys)
- An `input` object keyed by lowercase HTTP method (`get`, `post`, `put`, `patch`, `delete`) — each value is a function that converts an incoming HTTP request into a GraphQL request (`query`, `variables`, `operationName`). `query` can be a GraphQL string or a generated `TypedDocumentNode`.
- An optional `output` function — **shared across all methods** — that converts the GraphQL response into an HTTP response (`statusCode`, `headers`, `body`)

Adapters are deployed together with your application. When a request arrives under the `/api/` prefix and matches an adapter, the handler for the request method runs server-side.

For the official Tailor Platform documentation — including the exact URL routing, request/response body limits, execution timeouts, and CORS handling — see https://docs.tailor.tech/.

## Requirements

- Each adapter file must `export default` the result of `createHttpAdapter`; files matched by the glob without one (e.g. shared helpers) are ignored
- `name` must match `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` and be unique across all adapters
- `input` must declare at least one method handler
- All handlers **must be synchronous** — `async`/`await` is rejected at build time

## Constraints

Handlers run server-side and **must be synchronous**: `async`/`await`, Promises, `fetch`, Node APIs (`fs`, `path`, `crypto`, …), and top-level `await` are not available. `async`/`await` and Node built-in imports are rejected at build time. Each adapter's built output (including imported helpers) is capped at 256 KB, with a warning above 64 KB.

Request/response body size, execution timeout, and other limits are enforced by the platform — see the platform documentation linked above.

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

### Typed GraphQL Documents

`input` handlers can return generated `TypedDocumentNode` values instead of query strings. The SDK uses the document's variables type for `variables`, and passes the document's result type to `output` as `resp.data`.

```typescript
import { GetUserDocument } from "../generated/graphql";

get: (req) => ({
  query: GetUserDocument,
  variables: { id: req.path.split("/")[2] ?? "" },
});
```

When multiple methods return different typed documents, `resp.data` is the union of those result types because `output` is shared across the adapter. If a method returns a plain string query, its result type is `unknown`. When extracting an input handler and annotating it separately, pass the document type to `HttpAdapterInputFn` so required variables stay typed.

### Optional fields

Beyond `name`, `pathPattern`, `input`, and `output`, two optional fields control deploy-time behavior:

- `enabled` (default `true`) — set to `false` to deploy the adapter in a disabled state without removing its file. A disabled adapter is uploaded but not served.
- `priority` (non-negative integer, default `0`) — when multiple adapters' `pathPattern`s match the same request path, the adapter with the **lowest** `priority` value wins.

### Why is `output` shared instead of per-method?

`input` and `output` run **in isolation** and cannot share any state; `output` only receives the GraphQL response (not the original request or method). `output` is primarily intended for reshaping the response format (e.g. JSON to XML) — method-specific processing is expected to be handled on the `input`/resolver side. For per-method response shaping, discriminate inside `output` based on the response data shape.

## Path Pattern

`pathPattern` is matched against the request path **after** the `/api/` prefix.

- Literal segments must match exactly
- A `*` in the middle of the pattern matches exactly one path segment (`/users/*/items`)
- A trailing `*` matches the remaining path (`/users/*`)

Exact matching semantics (trailing-slash handling, percent-encoding, etc.) are defined by the platform — refer to the platform documentation for details.

## Types

The request/response shapes (`HttpAdapterRequest`, `HttpAdapterGraphQLRequest`, `HttpAdapterGraphQLResponse`, `HttpAdapterResponse`, …) are exported from `@tailor-platform/sdk`; refer to the type definitions in your editor rather than this document.
