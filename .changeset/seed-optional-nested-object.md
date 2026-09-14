---
"@tailor-platform/sdk": patch
---

Stop seed validation from reporting missing required fields inside an optional nested object that a row leaves out, and report the wrong shape when such a field is given a non-object value.
