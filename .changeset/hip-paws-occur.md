---
"@tailor-platform/sdk": patch
---

`npx tailor-sdk-skills` now installs the `tailor-sdk` agent skill from the locally installed SDK package instead of fetching the `main` branch from GitHub. The installed skill always matches the SDK version and works offline. Files are copied (not symlinked) so they persist across `pnpm install`.
