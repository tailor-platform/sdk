---
"@tailor-platform/sdk": minor
---

Add `tailor-sdk skills install` subcommand for installing the `tailor-sdk` agent skill from the locally installed SDK package, replacing the standalone `tailor-sdk-skills` binary that fetched `main` from GitHub. The skill version now always matches the installed SDK version, and files are copied (not symlinked) so they persist across `pnpm install`.

**Breaking**: The `tailor-sdk-skills` binary has been removed. Use `npx tailor-sdk skills install` (or `npx tailor-sdk skills install -a codex -y`) instead.
