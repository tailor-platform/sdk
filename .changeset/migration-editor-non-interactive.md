---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration generate` and `tailor tailordb migration script` open the file they scaffold in `EDITOR` or `VISUAL` only when they run in an interactive terminal outside CI. Run from a script, a CI step, or an agent shell with human output, they used to start the editor and wait for it with no terminal attached, so the command hung. An editor that opens its own window, such as `code --wait`, also no longer opens when the command's input or output is piped.
