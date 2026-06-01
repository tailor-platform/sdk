---
"@tailor-platform/sdk": patch
---

Make `tailor-sdk api --field` tab completion faster by pre-enumerating candidates into the generated shell script. Field names, enum values, and `true`/`false` for bool fields are now resolved from a static lookup table at TAB time instead of spawning a Node process per keystroke.
