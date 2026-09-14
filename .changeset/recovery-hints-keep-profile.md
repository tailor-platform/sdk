---
"@tailor-platform/sdk": patch
---

Keep the run's `--profile` and `--workspace-id` on the follow-up commands the CLI suggests, so copying a suggested command after `tailor workspace create --profile dev --ttl 24h`, `tailor auth status --profile dev`, `tailor authconnection authorize --profile dev`, `tailor executor list --profile dev`, or `tailor executor webhook list --profile dev` targets the same Platform and workspace as the run that printed it. `auth status` now reports a missing login as a `NOT_AUTHENTICATED` error whose suggested next command is `tailor login` with the same profile.
