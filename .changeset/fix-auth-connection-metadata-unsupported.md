---
"@tailor-platform/sdk": patch
---

fix(cli): stop deleting externally-managed auth connections on deploy

`deploy` no longer deletes auth connections it did not create. Because the platform does not expose metadata for auth connections, the SDK could not determine connection ownership and would delete every auth connection absent from your local config on each deploy — including connections created outside the SDK (e.g. Terraform or the console). The SDK now only removes connections it previously created itself, and any auth connection deletion is shown in the deletion confirmation prompt.
