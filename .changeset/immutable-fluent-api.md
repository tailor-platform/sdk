---
"@tailor-platform/sdk": minor
---

Make TailorDBField fluent API immutable

Fluent methods (`description()`, `index()`, `unique()`, `hooks()`, `validate()`, `serial()`, `vector()`, `relation()`) now return new instances instead of mutating `this`, preventing shared field corruption when the same field is used across multiple types.
