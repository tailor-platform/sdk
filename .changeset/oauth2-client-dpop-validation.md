---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` warning `Could not validate OAuth2 client "<name>": unresolved attribute`. The pre-flight check could not evaluate the rule that rejects `requireDpop: true` on a browser client, so it skipped it for every OAuth2 client. The rule now runs: a browser client with `requireDpop: true` fails pre-flight, and other client types no longer produce the warning.
