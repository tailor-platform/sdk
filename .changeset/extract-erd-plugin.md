---
"@tailor-platform/sdk": major
---

Remove the built-in `tailordb erd` commands. They are now provided by the `@tailor-platform/sdk-plugin-tailordb-erd` CLI plugin: install it with `npm install -D @tailor-platform/sdk-plugin-tailordb-erd` and keep running `tailor tailordb erd <command>` as before — the CLI dispatches to the plugin automatically and suggests the install command when the plugin is missing. The `erdSite` TailorDB setting is unchanged.
