---
"@tailor-platform/sdk": minor
---

Adopt dispatcher-mode shell completion so generated completion scripts resolve the currently visible `tailor-sdk` binary at completion time, allowing project-local SDK installations to provide matching completions. Published SDK packages now include a bundled zsh completion worker so the dispatcher can skip first-use cache generation.
