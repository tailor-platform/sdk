---
"@tailor-platform/sdk": patch
---

Add actor field to executor event trigger args

- Added `TailorActor` type to represent actors in event triggers
- Added `actor` field to `EventArgs` interface (nullable)
- Field names are aligned with `TailorUser` for consistency (`attributes`, `attributeList`)
- Added transformation in executor bundler to convert server field names to SDK field names
