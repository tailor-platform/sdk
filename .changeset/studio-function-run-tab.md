---
"@tailor-platform/sdk-plugin-studio": minor
---

Add a Function run tab to `tailor studio`.

Enter a function file in the project (for example `resolvers/add.ts`) and an optional JSON argument, and the tab runs `tailor function run <file> --watch --json` for you. Each run appears as a card with its status, execution ID, logs, result and error, and the function runs again whenever you save the file or a file it imports. Stop ends the watch, and closing the page stops it too. Only files inside the project can be run, and the run starts only from a request that carries the shell's per-run token.
