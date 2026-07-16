---
"@tailor-platform/sdk": major
---

Remove the built-in `tailordb erd` commands. They are now provided by the `@tailor-platform/sdk-tailordb-erd-plugin` CLI plugin: install it with `npm install -D @tailor-platform/sdk-tailordb-erd-plugin` and keep running `tailor tailordb erd <command>` as before — the CLI dispatches to the plugin automatically and suggests the install command when the plugin is missing. The `erdSite` TailorDB setting is unchanged.
