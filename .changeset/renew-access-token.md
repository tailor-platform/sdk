---
"@tailor-platform/sdk": patch
---

Long-running `tailor` commands, such as a deploy waiting on a migration job, `tailor workflow start --wait`, or `tailor function logs --follow`, no longer fail with `[unauthenticated] ... invalid token` when the access token expires partway through. They renew the token when it is about to expire, and retry a request once with a new token if the Platform rejects the one it sent. A client from `initOperatorClient` in `@tailor-platform/sdk/cli`, created with a token from `loadAccessToken`, does the same and may refresh and save the stored login while it runs. Commands that use `TAILOR_PLATFORM_TOKEN` or a machine-user login are still limited to the token's lifetime. The notice that a newer config version is available now appears once per command instead of on every read of the config.
