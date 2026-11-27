---
"@tailor-platform/sdk-plugin-studio": minor
---

Add a Function run tab to `tailor studio`, provided by `@tailor-platform/sdk-plugin-function-ui`. The tab runs the function the way `tailor function run --watch` does and shows each run as a card, against the workspace selected in the shell's bar; the watch is restarted on the new workspace when the selection, or the workspace a selected profile points to, changes. `--function-file` picks the function to edit and `--function-watch` starts the watch as soon as the server is up.
