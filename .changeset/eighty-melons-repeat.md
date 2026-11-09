---
"@tailor-platform/sdk": patch
---

`tailor deploy` now deletes the application of a config that no longer defines or references any TailorDB namespace, resolver namespace, IdP, or Auth service. Before, the application kept the services it was last deployed with, so it kept serving them, and a deploy that dropped one of those services deleted its tables or resolvers and then failed with `... is used by applications`. A config already in that state deletes its leftover application on the next deploy. `deploy` asks for confirmation before deleting it, so a non-interactive run needs `--yes`.
