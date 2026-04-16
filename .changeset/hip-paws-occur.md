---
"@tailor-platform/sdk": patch
---

`npx tailor-sdk-skills` now installs the `tailor-sdk` agent skill from the locally installed SDK package instead of fetching the `main` branch from GitHub, so the installed skill always matches the SDK version. Files are copied (not symlinked) so they persist across `pnpm install`. (The command still resolves the `skills` CLI via `npx`, so the `skills` package itself must be cached or installable.)
