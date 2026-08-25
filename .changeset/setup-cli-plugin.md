---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-setup": minor
---

Move the `tailor setup` commands into the optional `@tailor-platform/sdk-plugin-setup` CLI plugin.

`setup` generates GitHub repository automation, which not every project uses, but its workflow templates and its `@croct/json5-parser` / `json5` dependencies shipped with the SDK for everyone. Splitting it out follows the same CLI plugin mechanism as `tailor tailordb erd`.

To keep using `tailor setup <command>`, install the plugin next to the SDK:

```bash
npm install -D @tailor-platform/sdk-plugin-setup
```

The commands, options, generated files, and the `.github/tailor.lock` format are unchanged.
