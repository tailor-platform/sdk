---
paths:
  - "packages/sdk/src/**/*.ts"
  - "packages/sdk-codemod/src/registry.ts"
---

# Deprecating a Public API

Before you add, edit, or remove a `@deprecated` tag, remove or rename anything reachable from `packages/sdk/package.json#exports`, or edit `packages/sdk-codemod/src/registry.ts`, read [Deprecating a Public API](../../docs/deprecation.md). It sets the tag format, the codemod that ships in the same change, and the registry's `since` / `until` versions.
