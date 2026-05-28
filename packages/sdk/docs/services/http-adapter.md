# HTTP Adapter

HTTP adapters expose REST-style HTTP endpoints on your application's gateway by translating each request into a GraphQL query and (optionally) reshaping the GraphQL response back into an HTTP response.

## Overview

Each HTTP adapter is a single file that declares:

- The HTTP `pathPattern` and `methods` it handles
- An `input` function that converts an incoming HTTP request into a GraphQL request (`query`, `variables`, `operationName`)
- An optional `output` function that converts the GraphQL response into an HTTP response (`statusCode`, `headers`, `body`)

At deploy time the SDK bundles each `input` and `output` function into a standalone JS script that runs in the gateway's sandboxed runtime when a matching request reaches the application gateway under the `/api/` prefix.

For the official Tailor Platform documentation — including the exact URL routing, request/response body limits, execution timeouts, CORS handling, and other gateway-runtime behavior — see https://docs.tailor.tech/.

## Requirements

- Each adapter file must call `createHttpAdapter` exactly once and `export default` the result
- `name` must be a string literal that matches `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` and be unique across all adapters
- `input` and `output` must be inline arrow or `function` expressions (not references to functions defined elsewhere)
- `input` and `output` **must be synchronous** — the SDK rejects `async`/`await` at build time because the gateway runtime does not support it

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
// adapters/get-user.ts
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  methods: ["GET"],
  input: (req) => ({
    query: `query GetUser($id: ID!) { user(id: $id) { id name email } }`,
    variables: { id: req.path.split("/")[2] },
  }),
  output: (resp) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resp.data?.user ?? null),
  }),
});
```

A request to `GET /api/users/abc-123` will invoke `input(req)`, execute the resulting GraphQL query against your application's GraphQL endpoint (with the caller's auth context preserved), then invoke `output(resp)` to produce the HTTP response.

If `output` is omitted, the raw GraphQL response is returned as JSON.

## Path Pattern

`pathPattern` is matched against the request path **after** the platform-side `/api/` prefix.

- Literal segments must match exactly
- A `*` in the middle of the pattern matches exactly one path segment (`/users/*/items`)
- A trailing `*` matches the remaining path (`/users/*`)

Exact matching semantics (trailing-slash handling, percent-encoding, etc.) are defined by the platform — refer to the platform documentation for details.

## Type Reference

```typescript
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

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
