---
"@tailor-platform/sdk": patch
---

`defineAuth`'s `idProvider` and the exported `SAML` and `IdProviderConfig` types now accept a SAML provider without `enableSignRequest`, which defaults to `false`. `enableSignRequest` is optional on `SAML` and `IdProviderConfig`.
