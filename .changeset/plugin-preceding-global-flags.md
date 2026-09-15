---
"@tailor-platform/sdk": patch
---

Forward global flags typed before a CLI plugin command to the plugin.

`tailor --json tailordb erd export` now runs the plugin in JSON mode, the same as
`tailor tailordb erd export --json`. Previously only the arguments following the plugin name were
forwarded, so a global flag placed before it was consumed by the host CLI and never reached the
plugin. The same applies to `--verbose`, `--env-file`, and `--env-file-if-exists`, and the forwarded
flags now also feed the plugin's platform-context injection.

When the same flag appears on both sides of the plugin name, the later one wins. A flag the plugin
itself does not declare still has to be typed after the plugin's own subcommand.
