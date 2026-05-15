---
"@tailor-platform/sdk": patch
---

Fix `tailor-sdk deploy --no-schema-check` to reconcile the TailorDB migration label to the working tree's latest migration number when it completes. Previously, running `deploy --no-schema-check` from a revision whose working tree is older than the remote left the remote migration label stale; the next `deploy` then reconstructed a snapshot at a label that no longer existed in the working tree and aborted with a false "Remote schema drift detected" error.
