---
"@tailor-platform/sdk-plugin-function-ui": minor
---

Add `@tailor-platform/sdk-plugin-function-ui`, a CLI plugin that runs a function from the browser with `tailor function ui`, on its own and without `tailor studio`.

The page runs a function the way `tailor function run --watch` does, in a worker thread of the server, and shows each run as a card with its status, execution ID, logs, result and error. The function lives in `.tailor/studio/function.ts` (or the file given with `--function-file`) and its JSON5 argument in a file next to it, so the page, your editor and an AI agent can all change them and the page follows. `.tailor/studio/function.result.json` records what the watch is doing and what the last runs returned, so an agent can read the outcome of an edit without a browser, and a `TailorErrors` about the argument underlines the value it points at in the page. The watch belongs to the server and runs against the workspace of `--profile` (or `--workspace-id`); `--watch` starts it as soon as the server is up. A run starts only from a request the page itself sends. The watch runs in a worker thread, so project code that calls `process.exit()` ends the watch and not the server.
