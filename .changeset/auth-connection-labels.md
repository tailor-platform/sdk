---
"@tailor-platform/sdk": patch
---

fix(cli): track auth connection ownership via platform labels

`deploy` now tags auth connections with SDK ownership labels and uses them to decide which connections to manage, matching every other auth resource. This relies on platform metadata support for the `auth_connection` TRN; on platforms without it, deploy falls back to the local secrets-state so connections created outside the SDK (e.g. Terraform or the console) are never deleted. Auth connection deletions are also shown in the deletion confirmation prompt.
