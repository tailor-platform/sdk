---
"@tailor-platform/sdk": minor
---

More state-changing commands now print a JSON result on stdout under `--json`, so scripts can confirm what changed without parsing stderr: `login`, `logout`, `remove`, `profile delete`, `user switch`, `user pat delete`, `secret vault create`, `authconnection authorize`, `workspace user invite`, `workspace user update`, `workspace ttl set`, `workspace ttl clear`, `crashreport send`, and `tailordb migration script`. Each result carries a `changed` boolean that is `false` when the command finished without changing anything, such as `logout` when nobody is logged in, `user switch` to the current user, or `workspace ttl clear` on a workspace with no TTL. Output without `--json` is unchanged.
