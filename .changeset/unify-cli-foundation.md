---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Export the CLI foundation (`logger`, `styles`, `defineAppCommand`, `createCommonArgs`, the shared argument shapes, and the `arg`/`defineCommand`/`runCommand`/`runMain` command toolkit) from `@tailor-platform/sdk/cli`, and move the CLI plugins onto it. Plugins previously bundled their own copy of the logger, so `--json` and `--verbose` set by a plugin never reached the SDK code paths it calls; both flags now feed one logger state, and `--verbose` also enables `logger.debug` output.
