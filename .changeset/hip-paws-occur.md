---
"@tailor-platform/sdk": minor
---

Add `tailor-sdk skills install` subcommand for installing the `tailor-sdk` agent skill from the locally installed SDK package, replacing the standalone `tailor-sdk-skills` binary that fetched `main` from GitHub. The skill version now always matches the installed SDK version, and files are copied (not symlinked) so they persist across `pnpm install`.

The `tailor-sdk-skills` binary is kept as a deprecated shim that prints a runtime warning and delegates to `tailor-sdk skills install`. It will be removed in v2.
