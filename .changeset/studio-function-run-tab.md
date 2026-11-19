---
"@tailor-platform/sdk-plugin-studio": minor
---

Add a Function run tab to `tailor studio`.

Write a function in the tab's code editor (TypeScript highlighting, light and dark themes) and give it an optional JSON argument, and the tab runs it with `tailor function run --watch --json`. Each run appears as a card with its status, execution ID, logs, result and error, and the function runs again a moment after you stop typing. The code is kept in a temporary file outside the project that can import the project's installed packages, and the file is removed when the run ends. Stop ends the watch, and closing the page stops it too. A run starts only from a request that carries the shell's per-run token.
