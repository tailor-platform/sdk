---
"@tailor-platform/sdk": patch
---

`tailor staticwebsite domain list` and `domain get` now report a domain being removed as `removing` instead of `unknown`, and `tailor api` can inspect and call the custom domain transfer endpoints (`RequestCustomDomainTransfer`, `CancelCustomDomainTransfer`, `AcceptCustomDomainTransfer`, `GetCustomDomainTransfer`, `ListCustomDomainTransfers`).
