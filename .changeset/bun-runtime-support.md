---
"@tailor-platform/sdk": minor
---

Add Bun runtime support for CLI and expand CI test matrix

- Detect Bun/Deno runtimes and skip tsx registration for native TypeScript execution
- Use connect-web (fetch-based) transport on Bun/Deno instead of connect-node (HTTP/2)
- Add `@connectrpc/connect-web` dependency
- Expand CI smoke tests across OS, Node version, package manager, and runtime combinations
