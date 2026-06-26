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

const aiGateway = defineAIGateway("my-aigateway", {
  authNamespace: "default",
});

export default defineConfig({
  name: "my-app",
  aiGateways: [aiGateway],
});
```

## Options

### authNamespace

The auth namespace used to resolve request tokens against your workspace's auth configuration. Must match an existing auth namespace.

```typescript
defineAIGateway("my-aigateway", {
  authNamespace: "default",
});
```

### cors

Optional list of allowed origins for browser-based clients. Each entry is one of:

- `*` — any origin (any scheme, any host)
- `http(s)://*` — any host on the given scheme
- `http(s)://*.example.com` — any subdomain of `example.com` on the given scheme
- `http(s)://app.example.com` — an exact origin

An optional `:port` may be appended in all URL forms. Omitting `cors` (or passing `[]`) disables cross-origin access — browsers will block any cross-origin reads.

```typescript
defineAIGateway("my-aigateway", {
  authNamespace: "default",
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
  // Name of an auth namespace in your workspace; request tokens are resolved against it.
  authNamespace: "default",
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
