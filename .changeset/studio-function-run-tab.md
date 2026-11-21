---
"@tailor-platform/sdk-plugin-studio": minor
---

Add a Function run tab to `tailor studio`.

The tab runs a function with `tailor function run --watch --json` and shows each run as a card with its status, execution ID, logs, result and error. The function lives in `.tailor/studio/function.ts` (or the file given with `--function-file`) and its JSON5 argument in a file next to it, so the page, your editor and an AI agent can all change them and the page follows. `.tailor/studio/function.result.json` records what the watch is doing and what the last runs returned, so an agent can read the outcome of an edit without a browser, and a `TailorErrors` about the argument underlines the value it points at in the page. The watch belongs to the server, runs against the workspace selected in the shell's bar and is stopped when that selection changes; `--function-watch` starts it as soon as the server is up. A run starts only from a request that carries the shell's per-run token.
