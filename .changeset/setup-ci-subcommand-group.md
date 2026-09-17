---
"@tailor-platform/sdk-plugin-setup": minor
---

Move the `branch`, `tag`, `preview`, `action`, and `coordinate` generators under a new `ci` subcommand group: `tailor setup branch` is now `tailor setup ci branch` (likewise for `tag`, `preview`, `action`, and `coordinate`). `setup deps`, `setup check`, and `setup delete` are unchanged.

The `--branch` alias of `setup branch`'s `--target` option is removed instead of being kept until v3 as previously announced; use `--target`. `setup` remains a beta command, so this and the regrouping above ship as an immediate breaking change rather than going through a deprecation cycle.

`setup check` no longer takes a `--ci` flag: it now detects automatically whether it is running inside CI (the same way the rest of the CLI does) and adjusts its checks accordingly. Drop `--ci` from any script that passes it.
