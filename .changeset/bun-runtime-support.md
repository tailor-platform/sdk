---
"@tailor-platform/sdk": minor
---

Add Bun runtime support for CLI and expand CI test matrix

- Detect Bun/Deno runtimes and skip tsx registration for native TypeScript execution
- Use dynamic import for connect-node transport to support Bun runtime
- Expand CI smoke tests across OS, Node version, package manager, and runtime combinations
