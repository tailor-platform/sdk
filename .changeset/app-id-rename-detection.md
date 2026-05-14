---
"@tailor-platform/sdk": minor
---

Detect app renames via a stable, auto-injected `id` field in `tailor.config.ts`.

The SDK now writes a generated `id: "<uuid>"` field into the
`defineConfig({...})` call on first `deploy`, and stamps every managed
resource with an `sdk-app-id` metadata label. Subsequent deploys identify
ownership by the stable id rather than by the app name, so renaming the
app (or any of its resources) cleanly removes the old resources before
creating the new ones. The id is a plain UUID; the SDK adds the
label-compatible `app-` prefix internally at the metadata boundary.

If your `tailor.config.ts` is a wrapper that re-exports `defineConfig` from
another file, the SDK skips id injection on the wrapper — add the `id`
field manually to the file that contains the actual `defineConfig({...})`
call. Existing deployments without the id continue to work and migrate
transparently on the next `deploy` run.
