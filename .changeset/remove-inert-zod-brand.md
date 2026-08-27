---
"@tailor-platform/sdk": patch
---

Remove unused internal `.brand()` calls from config schemas. This is invisible to users: the generated public types were already unaffected by these calls.
