# AI Gateway

AI Gateway provides a unified endpoint for accessing a range of large language models through a single OpenAI-compatible API, with platform-managed credentials and workspace-scoped authentication.

## Overview

AI Gateway provides:

- A unified, OpenAI-compatible endpoint for multiple LLM models
- Mandatory authentication via your workspace's auth (request tokens are resolved against the configured auth namespace)
- Per-workspace isolation: each gateway is provisioned with its own platform-assigned URL
- Optional CORS allow-list for browser-based clients
- Built-in usage tracking and rate limiting (configured platform-side)

## Configuration

Configure an AI Gateway using `defineAIGateway()`:

**Definition Rules:**

- **Multiple gateways allowed**: You can define multiple AI Gateways in your config file
- **Configuration location**: Define in `tailor.config.ts` and add to the `aiGateways` array
- **Uniqueness**: Gateway names must be unique across all AI Gateways
- **Name pattern**: `name` must match `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (lowercase alphanumeric and hyphens, 3-30 characters)

```typescript
import { defineAIGateway, defineConfig } from "@tailor-platform/sdk";

const aiGateway = defineAIGateway("my-aigateway", {});

export default defineConfig({
  name: "my-app",
  aiGateways: [aiGateway],
});
```

## Options

### authNamespace

The auth namespace used to resolve request tokens against your workspace's auth configuration. Optional — when omitted, it defaults to your application's own Auth service (local or external, the name passed to `defineAuth()`), which is what most AI Gateways need. Omitting it without an Auth service configured is rejected by `deploy`/`generate`, asking you to either define one or set `authNamespace` explicitly:

```typescript
import { defineAIGateway, defineAuth, defineConfig } from "@tailor-platform/sdk";

const auth = defineAuth("my-auth", {
  // ...auth configuration...
});

const aiGateway = defineAIGateway("my-aigateway", {}); // defaults to "my-auth"

export default defineConfig({
  name: "my-app",
  auth,
  aiGateways: [aiGateway],
});
```

Type-checked and autocompleted against your own Auth service name via the generated `tailor.d.ts` (the `AuthNamespaceNameRegistry` interface). Run `tailor generate` (or `deploy`) after defining an Auth service to refresh it. Before the first generate run, `authNamespace` accepts any string.

To authenticate against a **different** application's Auth service, reference it as an [external resource](../configuration.md#external-resources) in your own config — `authNamespace` then defaults to it like any other Auth service:

```typescript
import { defineAIGateway, defineConfig } from "@tailor-platform/sdk";

const aiGateway = defineAIGateway("my-aigateway", {}); // defaults to "shared-auth"

export default defineConfig({
  name: "my-app",
  auth: { name: "shared-auth", external: true },
  aiGateways: [aiGateway],
});
```

An `authNamespace` that doesn't match any auth namespace in your workspace surfaces only at runtime, as `401 Unauthorized` on every request to the gateway.

### cors

Optional list of allowed origins for browser-based clients. Each entry is one of:

- `*` — any origin (any scheme, any host)
- `http(s)://*` — any host on the given scheme
- `http(s)://*.example.com` — any subdomain of `example.com` on the given scheme
- `http(s)://app.example.com` — an exact origin

An optional `:port` may be appended in all URL forms. Omitting `cors` (or passing `[]`) disables cross-origin access — browsers will block any cross-origin reads.

```typescript
defineAIGateway("my-aigateway", {
  cors: ["https://app.example.com", "https://*.example.com"],
});
```

## Complete Example

```typescript
import {
  defineAIGateway,
  defineAuth,
  defineConfig,
  defineStaticWebSite,
} from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
});

const aiGateway = defineAIGateway("my-aigateway", {
  // authNamespace omitted: defaults to this app's own Auth service, declared below.
  cors: [website.url],
});

const auth = defineAuth("my-auth", {
  // ...auth configuration...
});

export default defineConfig({
  name: "my-app",
  auth,
  staticWebsites: [website],
  aiGateways: [aiGateway],
});
```

## Runtime Usage

Resolvers, executors, and workflow jobs can resolve a gateway's platform-assigned URL by name via `aigateway.get()`. The name is type-checked and autocompleted against the AI Gateways defined in `aiGateways`:

```typescript
import { aigateway } from "@tailor-platform/sdk/runtime";

const { url } = await aigateway.get("my-aigateway");

// await aigateway.get("unknown"); // Type error — only "my-aigateway" is allowed
```

Type narrowing is provided by the generated `tailor.d.ts` (the `AIGatewayNameRegistry` interface). Run `tailor generate` (or `deploy`) after defining new AI Gateways to refresh it. Before the first generate run, `get()` accepts any string.

The same URL is also shown by `tailor show`, which lists the URL of each AI Gateway defined in `aiGateways` once it has been deployed.
