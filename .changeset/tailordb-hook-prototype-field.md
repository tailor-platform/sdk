---
"@tailor-platform/sdk": patch
---

`createTailorDBHook` now takes each field from the data's own properties. A type declaring a field named after a member of `Object` — `toString`, say — used to get that member as the field's value on every record that omitted the field, so validation rejected otherwise valid rows:

```
✗ Found 1 error(s) in ./seed/data/Customer.jsonl
   Expected a string: received function toString() { [native code] }
```

A field named `__proto__` is recorded as a data property rather than assigned, so its value is kept instead of being swallowed by the inherited setter.

A field the data does not carry still lands as an `undefined` key, which is what keeps a column inferred from these records nullable.
