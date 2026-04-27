---
"@tailor-platform/sdk": patch
---

Suppress the spurious `Static website "<name>" not found for CORS configuration` warning during `apply` planning on the first deployment. The warning previously fired whenever `plan` looked up a static website that the same apply run was about to create. Locally-defined static websites referenced via `:url` patterns in `cors` or OAuth2 `redirectURIs` are now treated as expected during planning; missing remote websites still warn when they are not part of the local configuration.
