---
"@tailor-platform/sdk": major
---

Type a `date` column as a date in generated migration types, matching what the function runtime returns and what the generated table types already declared. Reading a `date` column in `migrate.ts` now yields a `Date` instead of a `string`, and writing accepts either; a migration script that used a selected `date` value as a string needs updating. A `date` or `datetime` array column is also now typed so its values are readable and writable, which a nested column type previously prevented.
