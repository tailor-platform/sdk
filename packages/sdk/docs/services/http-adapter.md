# HTTP Adapter

HTTP adapters expose REST-style HTTP endpoints on your application's gateway by translating each request into a GraphQL query and (optionally) reshaping the GraphQL response back into an HTTP response.

## Overview

Each HTTP adapter is a single file that declares:

- The HTTP `pathPattern` and `methods` it handles
- An `input` function that converts an incoming HTTP request into a GraphQL request (`query`, `variables`, `operationName`)
- An optional `output` function that converts the GraphQL response into an HTTP response (`statusCode`, `headers`, `body`)

At deploy time the SDK bundles each `input` and `output` function into a standalone JS script that runs in the gateway's sandboxed runtime when a matching request hits `/f/<pathPattern>`.

## Requirements

- Each adapter file must call `defineHttpAdapter` exactly once and `export default` the result
- `name` must be a string literal that matches `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` and be unique across all adapters
- `input` and `output` must be inline arrow or `function` expressions (not references to functions defined elsewhere)
- `input` and `output` **must be synchronous** — `async`/`await` and top-level `await` are not supported by the gateway runtime

## Runtime Constraints

Adapter scripts are bundled to an ES2017 IIFE and executed in the gateway's sandboxed Sobek runtime. The following are **not** available:

- Node built-in modules (`fs`, `path`, `crypto`, `http`, etc.) — rejected at build time
- `async`/`await` and top-level `await` — rejected at build time
- `fetch`, `setTimeout`, `setInterval`, and other browser/host globals
- Any third-party libraries that depend on the above

Each bundled script is capped at 256 KB (with a warning at 64 KB).

## Activation

HTTP adapters are gated by a per-workspace feature flag (`20260413_platform_filter_router`). Until the flag is enabled for a workspace, requests to `/f/<path>` return `404`. Contact your platform admin to enable adapters in your environment.

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
import { defineHttpAdapter } from "@tailor-platform/sdk";

export default defineHttpAdapter({
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

A request to `GET /f/users/abc-123` will invoke `input(req)`, execute the resulting GraphQL query against your application's GraphQL endpoint (with the caller's auth context preserved), then invoke `output(resp)` to produce the HTTP response.

If `output` is omitted, the raw GraphQL response is returned as JSON.

## Path Pattern

- Literal segments must match exactly: `/users/list` matches only `/users/list`
- A `*` in the middle matches exactly one segment: `/api/*/users` matches `/api/v1/users`
- A trailing `*` matches all remaining segments: `/api/*` matches `/api/v1/users/123`

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
