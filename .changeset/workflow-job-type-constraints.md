---
"@tailor-platform/sdk": patch
---

feat: add type constraints to workflow job body functions

- Input type: Must be JSON-compatible (no Date/toJSON objects). Interfaces are now supported.
- Output type: Allows Jsonifiable values (including Date with toJSON), undefined, and void
- Trigger return type: Returns `Jsonify<Output>` - Date becomes string after JSON serialization
- Added `JsonCompatible<T>` helper type to support TypeScript interfaces as input types
- TailorDB timestamp fields now return `Date` objects instead of ISO strings
