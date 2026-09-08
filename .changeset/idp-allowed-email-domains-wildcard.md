---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` rejecting IdP `userAuthPolicy.allowedEmailDomains: ["*"]` with "must be a valid hostname" during pre-flight validation. The bundled protobuf descriptors carried the platform's older hostname-only rule, so the wildcard entry documented in 2.14.1 could be written but never deployed.
