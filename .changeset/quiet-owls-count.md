---
"@tailor-platform/sdk": patch
---

The PGlite schema (`db.pglite.ts`) now reproduces every serial format the platform accepts. A format with `%o` (for example `"%05o"`) used to make generation fail, so `tailordb migration script --with-test` skipped the PGlite schema and test; it now numbers in base eight, and the schema defines a `tailor_to_oct` function for it. A `%%` before or after the specifier now stands for a literal `%`, so `"100%%-%05d"` produces `100%-00001`.
