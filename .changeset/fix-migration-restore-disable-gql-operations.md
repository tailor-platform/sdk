---
"@tailor-platform/sdk": patch
---

Harden `deploy`'s TailorDB migration restore step so it always sends complete GraphQL operation restriction settings for a table when restoring them.
