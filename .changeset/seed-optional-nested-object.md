---
"@tailor-platform/sdk": patch
---

Stop seed validation from reporting missing required fields inside a nested object that a row leaves out or gives a non-object value, and report the wrong shape against the field itself instead. Applies to both single nested objects and elements of a nested array.
