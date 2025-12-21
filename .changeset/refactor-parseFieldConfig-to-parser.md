---
"@tailor-platform/sdk": patch
---

refactor: move parseFieldConfig and tailorUserMap to parser layer

- Move `TailorDBField.get config()` logic to `parseFieldConfig` in parser layer
- Move `tailorUserMap` constant from configure to parser layer
- Remove `TailorDBTypeConfig` in favor of `TailorDBTypeMetadata` (without fields)
- Update ESLint config to allow type imports from configure in parser module
- Export `DBFieldMetadata` and `Hook` types from tailordb module
