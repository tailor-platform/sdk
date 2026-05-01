---
"@tailor-platform/sdk": minor
---

Detect app renames via a stable, auto-injected `id` field in `tailor.config.ts`.

The SDK now writes a generated `id: "app-<uuid>"` field into the
`defineConfig({...})` call on first apply/generate run, and stamps every
managed resource with an `sdk-app-id` metadata label. Subsequent applies
identify ownership by the stable id rather than by the app name, so renaming
the app (or any of its resources) cleanly removes the old resources before
creating the new ones.

If your `tailor.config.ts` is a wrapper that re-exports `defineConfig` from
another file, the SDK will skip injection on the wrapper and operate against
the file that actually contains the `defineConfig` call. Existing
deployments without the id continue to work and migrate transparently the
next time `apply`/`generate` runs.
